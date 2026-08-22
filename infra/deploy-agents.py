#!/usr/bin/env python3
"""Deploy the Warrant fleet to Agent Runtime (Vertex AI Agent Engine).

    ./infra/deploy-agents.py              # create, or update the existing engine in place
    ./infra/deploy-agents.py --list       # what is deployed right now
    ./infra/deploy-agents.py --smoke      # ask the deployed engine for its roster

The fleet is uploaded as the `warrant` package on its own — there is no repo out there. Two
things that are free locally therefore have to be arranged here:

  * **the contract.** `warrant/contract.py` reads `contract/agents/*.schema.json`, which sits
    beside the package rather than inside it, because TypeScript and Vertex read the same
    files. A verbatim copy is staged into the package at deploy time. It is copied, never
    written, so there is still exactly one authored statement of the contract.
  * **the SDK.** `requirements` below is the deployed environment; it has to agree with
    `agents/requirements.txt` or the fleet runs against a different library than the one the
    eval suite proved.

Updating in place rather than creating a second engine is deliberate: the sealed record
stamps which agent version made a decision, and a drift of orphaned engines makes that stamp
ambiguous.
"""
from __future__ import annotations

import argparse
import contextlib
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "agents" / "warrant"
CONTRACT = ROOT / "contract"

DISPLAY_NAME = "warrant-fleet"
DESCRIPTION = (
    "Warrant's agent fleet: Foreman, Inspector, Skeptic, Instructor, Scoper, Auditor and "
    "Wright. Holds no job state between calls — Agent Runtime hosts a session, the record "
    "holds the job."
)

#: The first two mirror agents/requirements.txt exactly. The deployed fleet answering under a
#: different SDK than the suite was recorded against would make the cassettes evidence of
#: nothing.
#:
#: The third is not the fleet's dependency, it is the runtime's own: Agent Runtime unpickles
#: the object and builds its HTTP surface using this SDK inside the container, so leaving it
#: out fails at startup with `No module named 'google.cloud.aiplatform'` — an error about the
#: host, in a traceback that looks like it is about our code.
REQUIREMENTS = [
    "google-genai>=2.19",
    "jsonschema>=4.23",
    "google-cloud-aiplatform[agent_engines]>=1.165",
]


#: Deliberately not inherited from .env. That variable points at the `warrant-web` service
#: account key — the RUNTIME identity, deliberately least-privilege: it can mint session
#: cookies and read Firestore and nothing else. Deploying an agent engine is an operator
#: action, not something the running product should ever be able to do, so letting it leak
#: into this script authenticates the deploy as the wrong principal and fails with a 403 on
#: `reasoningEngines.list` that reads exactly like the API being unavailable.
NOT_FROM_ENV = {"GOOGLE_APPLICATION_CREDENTIALS"}


def load_env() -> None:
    """Read .env the same way the shell scripts do, without needing a shell."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key in NOT_FROM_ENV:
            continue
        os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def credentials():
    """Whoever is deploying, as themselves.

    Application Default Credentials first, because that is the right answer in CI. On a
    developer's laptop ADC is frequently absent — `gcloud auth application-default login` is
    a separate step from `gcloud auth login` — so fall back to the same `gcloud` user
    credential every other script in this repo already relies on, rather than making a
    missing second login look like a missing API. `agents/warrant/model.py` does exactly
    this, for exactly this reason.
    """
    try:
        import google.auth
        creds, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"])
        return creds
    except Exception:
        pass
    from google.oauth2.credentials import Credentials
    out = subprocess.run(["gcloud", "auth", "print-access-token"],
                         capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        sys.exit("error: no credential — run `gcloud auth login` "
                 "(or `gcloud auth application-default login`)\n" + out.stderr.strip())
    return Credentials(token=out.stdout.strip())


def project() -> str:
    p = os.environ.get("GCP_PROJECT")
    if p:
        return p
    out = subprocess.run(["gcloud", "config", "get-value", "project"],
                         capture_output=True, text=True, timeout=60)
    p = out.stdout.strip()
    if not p or p == "(unset)":
        sys.exit("error: no project — set GCP_PROJECT or gcloud config set project <id>")
    return p


def stage(tmp: Path) -> Path:
    """A copy of the package with the contract folded in, ready to upload."""
    dest = tmp / "warrant"
    shutil.copytree(PACKAGE, dest,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache"))
    data = dest / "_contract_data"
    for sub in ("agents", "entities"):
        src = CONTRACT / sub
        if not src.is_dir():
            sys.exit(f"error: {src} is missing — the fleet cannot be deployed without it")
        shutil.copytree(src, data / sub)

    schemas = sorted(p.name for p in (data / "agents").glob("*.schema.json"))
    print(f"staged warrant/ + {len(schemas)} agent schemas")
    return dest


def ensure_bucket(bucket: str, region: str, proj: str) -> None:
    check = subprocess.run(["gcloud", "storage", "buckets", "describe", f"gs://{bucket}",
                            "--project", proj, "--format=value(name)"],
                           capture_output=True, text=True, timeout=120)
    if check.returncode == 0:
        return
    print(f"creating staging bucket gs://{bucket}")
    made = subprocess.run(["gcloud", "storage", "buckets", "create", f"gs://{bucket}",
                           "--project", proj, "--location", region],
                          capture_output=True, text=True, timeout=300)
    if made.returncode != 0:
        sys.exit(f"error: could not create gs://{bucket}\n{made.stderr}")


def existing(agent_engines, name: str):
    """The engine we already own, if there is one. Matched on display name."""
    for e in agent_engines.list():
        if getattr(e, "display_name", None) == name:
            return e
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="show deployed engines and exit")
    ap.add_argument("--smoke", action="store_true",
                    help="ask the deployed engine for its roster and exit")
    ap.add_argument("--new", action="store_true",
                    help="create a second engine instead of updating the existing one")
    args = ap.parse_args()

    load_env()
    proj = project()
    region = os.environ.get("GCP_REGION", "us-central1")
    bucket = os.environ.get("AGENT_STAGING_BUCKET", f"{proj}-agents")

    import vertexai
    from vertexai import agent_engines

    if not (args.list or args.smoke):
        ensure_bucket(bucket, region, proj)

    vertexai.init(project=proj, location=region, staging_bucket=f"gs://{bucket}",
                  credentials=credentials())

    if args.list:
        found = list(agent_engines.list())
        if not found:
            print("no agent engines deployed")
            return 0
        for e in found:
            print(f"{e.display_name}\n  {e.resource_name}")
        return 0

    if args.smoke:
        engine = existing(agent_engines, DISPLAY_NAME)
        if engine is None:
            sys.exit(f"error: no engine named {DISPLAY_NAME} — deploy one first")
        print(f"engine   {engine.resource_name}")
        print("roster  ", engine.roster())
        return 0

    # The package is only importable once agents/ is on the path — it is a source tree, not
    # an installed distribution, and deliberately so: the eval harness runs it in place.
    sys.path.insert(0, str(ROOT / "agents"))
    from warrant.runtime import WarrantFleet

    fleet = WarrantFleet(project=proj,
                         model=os.environ.get("GEMINI_MODEL"),
                         gemini_location=os.environ.get("GEMINI_LOCATION", "global"))

    print(f"project  {proj}")
    print(f"region   {region}")
    print(f"staging  gs://{bucket}")
    print()

    with tempfile.TemporaryDirectory() as tmp:
        staged = stage(Path(tmp))
        # `warrant`, not `/tmp/…/warrant`. The SDK tars each extra package with a bare
        # `tar.add(path)`, which stores an absolute path as `tmp/…/warrant/…` — that extracts
        # somewhere the remote's import path never looks, and the engine then dies at startup
        # with `No module named 'warrant'` rather than anything about packaging. Tarring from
        # the staging directory makes the entry `warrant/…`, which lands importable.
        common = dict(requirements=REQUIREMENTS,
                      extra_packages=["warrant"],
                      env_vars={"GCP_PROJECT": proj,
                                "GEMINI_LOCATION": os.environ.get("GEMINI_LOCATION", "global"),
                                "GEMINI_MODEL": os.environ.get("GEMINI_MODEL",
                                                               "gemini-3.5-flash"),
                                "WARRANT_CASSETTES": "/tmp/warrant-cassettes"})

        current = None if args.new else existing(agent_engines, DISPLAY_NAME)
        with contextlib.chdir(staged.parent):
            if current is not None:
                print(f"updating {current.resource_name}")
                engine = agent_engines.update(
                    resource_name=current.resource_name, agent_engine=fleet,
                    display_name=DISPLAY_NAME, description=DESCRIPTION, **common)
            else:
                print("creating a new engine — this takes several minutes")
                engine = agent_engines.create(
                    fleet, display_name=DISPLAY_NAME, description=DESCRIPTION, **common)

    print()
    print(f"deployed {engine.resource_name}")

    # Prove it answers before claiming it is up. A create that returned without raising and
    # an engine that actually serves are not the same fact.
    #
    # A failure here is a failed verification, not a failed deploy — the engine above is real
    # and already serving whatever it registered. Say which, rather than raising a traceback
    # that reads as though nothing was created.
    ops = [o.get("name") for o in (engine.operation_schemas() or [])]
    print(f"exposes  {', '.join(ops) or '(none)'}")
    if "roster" not in ops:
        print("warning: roster is not registered — see register_operations() in runtime.py")
        return 1
    roster = engine.roster()
    names = ", ".join(a["name"] for a in roster["agents"])
    print(f"roster   {len(roster['agents'])} agents — {names}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
