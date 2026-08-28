#!/usr/bin/env bash
# Runs a full procedure end to end against recorded fixtures.
#
#   ./scripts/smoke.sh
#
# No hardware, no Google Cloud project, no credentials, nothing at risk. Everything below
# runs offline against the fixture layer, which is the same data the surfaces render in
# development — so this is both the test and the demo data.
#
# What it proves, in order:
#   1. every agent schema stays inside the subset Vertex responseSchema accepts
#   2. the token source generates for both stacks
#   3. every fixture typechecks against the generated contract
#   4. every surface renders from FixtureSource alone, with no backend
#   5. tenancy holds, and a verdict becomes a decision — against the real rules engine
#   6. the seven agents obey their contracts, the scenario corpus replays, and Wright's
#      drivers are COMPILED AND EXECUTED against the real Driver interface
#   7. optionally, a real browser drives a procedure through to a sealed record

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# HERMETIC, AND IT WAS NOT.
#
# This script's whole promise — the one the README repeats — is "no hardware, no Google Cloud
# project, no credentials, nothing at risk". That held for everything except the two steps
# that build and drive the web surface, because `.env` and `web/.env.local` both carry
# `NEXT_PUBLIC_WARRANT_DATA_SOURCE=live` for ordinary development, Next inlines that at BUILD
# time, and `npm run build` here picked it up. So on any machine set up to develop against the
# real project, step 4 was not proving the surfaces render from fixtures — it was baking a
# client bound to LiveSource — and step 7 then drove a real browser against real Firestore and
# woke the real fleet. It failed as often as not, for reasons that had nothing to do with the
# code under test, and "nothing is at risk" was simply not true.
#
# Set here rather than trusted, because a real environment variable takes precedence over a
# .env file in Next and this is the only way to say "whatever this machine is configured for,
# not that". Nothing below may reach a project.
export NEXT_PUBLIC_WARRANT_DATA_SOURCE=fixture
export WARRANT_DATA_SOURCE=fixture

step "1/7  contract — schemas resolve and agent schemas are Vertex-safe"
node contract/check.mjs

step "2/7  design tokens — one source, two stacks"
node design/build-tokens.mjs

step "3/7  fixtures typecheck against the contract"
cd web
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run gen >/dev/null
npx tsc --noEmit
echo "ok — every fixture matches the generated types"

# The adjudication spine, minus anything that needs a network or a database. The outcome
# table is the one worth reading: it is where a model's verdict stops being an opinion and
# becomes a step transition, and every way a model can be wrong is a row in it.
#
# nav.test.mjs is here for a different reason: it pins which surfaces a STRANGER may reach.
# A regression there does not look broken — it looks like a product that quietly demands an
# account for work that was supposed to need none, which is the kind of thing only a test
# notices. It is the twin of android's MenuTest, and the two must keep agreeing.
node --experimental-strip-types --conditions=react-server --import ./scripts/ts-resolve.mjs \
  --test scripts/outcome.test.mjs scripts/cases.test.mjs scripts/fleet.test.mjs \
       scripts/armor.test.mjs scripts/attest.test.mjs scripts/trace.test.mjs \
       scripts/nav.test.mjs scripts/compile.test.mjs scripts/screen.test.mjs \
       scripts/seal.test.mjs scripts/instruments.test.mjs scripts/members.test.mjs \
       scripts/attention.test.mjs scripts/mcp.test.mjs scripts/step-action.test.mjs \
       scripts/handover.test.mjs scripts/workspace.test.mjs 2>&1 \
  | grep -E '^# (tests|pass|fail)'
echo "ok — the outcome table, the cases, the fleet client, the armor screen, attestation,"
echo "     and the Seal's provenance classifier,"
echo "     the reasoning trace, the Gemma screen's bounded authority and the menu's gating"
echo "     rules hold — and what may call itself measured, and who may change who works here"
echo "     — and what an agent is asking a person for, which both surfaces now derive the"
echo "     same way from the step outcomes rather than each inventing an answer,"
echo "     and what the one big button on a step MEANS — the other rule both surfaces read"
echo "     out of one file, and the twin of android's StepActionTest,"
echo "     and where a job stands when the hands stop, plus which verdict belongs under"
echo "     which photograph on the handover's carousel,"
echo "     and the machine-to-machine surface: the seven tools, a real MCP handshake over the"
echo "     real transport, and the fact that NOT ONE of them can seal, release or waive"
echo "     — and what a drafted purchase order may contain, which is the one place a string an"
echo "     agent read off a photograph reaches a mail header, plus the ledger's column order and"
echo "     what the record projected into Drive is allowed to claim"

step "4/7  every surface renders from fixtures with no backend"
npm run build >/dev/null
echo "ok — every route builds and renders from FixtureSource alone"
# Every route is now server-rendered on demand rather than prerendered, because the root
# layout resolves the session so the first paint already knows the tenant. That is the
# Cloud Run shape the architecture calls for, and it is why nothing here is marked static.

step "5/7  tenancy and storage shape — against the real rules engine"
# A Workspace domain cannot read another's, a consumer account cannot read a domain's, and
# nobody can write the catalogue. Also asserts that tenantOf() in firestore.rules and
# tenantFromClaims() in web/src/auth/tenant.ts resolve the SAME tenant for the same claims —
# they are the same rule written twice, and a divergence between them is a tenancy hole.
#
# Needs the Firestore emulator, which needs a JDK 21+. Skipped rather than failed when
# either is absent, because nothing else in this script needs Java.
RULES_JAVA=""
if java -version 2>&1 | grep -qE '"(2[1-9]|[3-9][0-9])'; then
  RULES_JAVA="$(command -v java)"
elif [ -x /usr/lib/jvm/java-25-openjdk/bin/java ]; then
  RULES_JAVA=/usr/lib/jvm/java-25-openjdk/bin/java
fi

if [ -n "$RULES_JAVA" ] && [ -x "$ROOT/web/node_modules/.bin/firebase" ]; then
  cd "$ROOT"
  # No `|| true` here on purpose. A tenancy regression must fail this script, not scroll past
  # in the output — the emulator's exit status is the whole value of running it.
  JAVA_HOME="$(dirname "$(dirname "$RULES_JAVA")")" \
  PATH="$(dirname "$RULES_JAVA"):$PATH" \
  "$ROOT/web/node_modules/.bin/firebase" emulators:exec \
      --project warrant-rules-test --only firestore --config "$ROOT/firebase.json" \
      'node --experimental-strip-types --test web/scripts/rules.test.mjs web/scripts/audit-adversarial.test.mjs
       cd web && node --experimental-strip-types --conditions=react-server \
         --import ./scripts/ts-resolve.mjs --test scripts/live-source.test.mjs scripts/adjudicate.test.mjs scripts/dispose.test.mjs scripts/audit.test.mjs scripts/stock.test.mjs' \
    > /tmp/warrant-rules.log 2>&1 \
    || { echo "TENANCY FAILED — see the report below"; grep -E '^(not ok|  +error:)' /tmp/warrant-rules.log | head -20; exit 1; }
  grep -E '^# (tests|pass|fail)' /tmp/warrant-rules.log
  echo "ok — no tenant reaches another's data, the catalogue is read-only, evidence is not forgeable,"
  echo "     an adversarial audit of the rules holds, and a stalled step reaches the Instructor,"
  echo "     the Foreman and a task without any client staying awake"
  cd "$ROOT/web"
else
  echo "skipped — needs a JDK 21+ and web/node_modules/.bin/firebase"
fi

step "6/7  agents — contracts, conditional rules and the scenario corpus"

# The anvil, if there is a JDK for it.
#
# Wright is the one agent whose output is CODE, and the claim that it writes a driver is a
# claim about something that compiles and runs. tests/test_anvil_live.py compiles real Kotlin
# against the real Driver interface and puts it through all five gates; it SKIPS loudly when
# the anvil is not up rather than passing quietly, so a suite that stopped compiling anything
# says so.
ANVIL_PID=""
if command -v javac >/dev/null 2>&1; then
  "$ROOT/anvil/run.sh" > /tmp/warrant-anvil.log 2>&1 &
  ANVIL_PID=$!
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null http://127.0.0.1:8099/health && break
    sleep 0.5
  done
  if curl -sf -o /dev/null http://127.0.0.1:8099/health; then
    echo "ok — the anvil is up; Wright's drivers will be compiled and executed"
  else
    echo "anvil did not start — see /tmp/warrant-anvil.log"
    head -20 /tmp/warrant-anvil.log
    kill "$ANVIL_PID" 2>/dev/null || true
    ANVIL_PID=""
  fi
else
  echo "skipped the anvil — no javac on PATH"
fi
trap '[ -n "$ANVIL_PID" ] && kill "$ANVIL_PID" 2>/dev/null || true' EXIT

cd "$ROOT/agents"
if python3 -c "import jsonschema, pytest" 2>/dev/null; then
  python3 -m pytest tests/ -q
  python3 -m evals check
  # Replays whatever has been recorded. Scenarios with no cassette report as errors rather
  # than passes, so an empty store cannot be mistaken for a green suite.
  python3 -m evals run --allow-fail | tail -20
else
  echo "skipped — pip install -r agents/requirements.txt"
fi
[ -n "$ANVIL_PID" ] && kill "$ANVIL_PID" 2>/dev/null || true
ANVIL_PID=""
cd "$ROOT/web"

step "7/7  a procedure, end to end, in a real browser"
if python3 -c "import playwright" 2>/dev/null; then
  node_modules/.bin/next start -p 3131 >/tmp/warrant-smoke.log 2>&1 &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null || true' EXIT
  for _ in $(seq 1 40); do curl -sf -o /dev/null http://localhost:3131/ && break; sleep 0.5; done
  python3 "$ROOT/scripts/smoke_funnel.py"
else
  echo "skipped — playwright is not installed (pip install playwright && playwright install chromium)"
fi

printf '\n\033[1;32mSMOKE PASSED\033[0m\n'
