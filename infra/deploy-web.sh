#!/usr/bin/env bash
# Deploy the Warrant web app to Cloud Run.
#
#   ./infra/deploy-web.sh
#
# Builds locally and pushes to Artifact Registry. Cloud Build is deliberately not used:
# projects created recently have no Cloud Build service account and `builds submit` fails
# with an unhelpful PERMISSION_DENIED. Local builds are faster, free, and one less identity.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE:-warrant}"
HOST="${REGION}-docker.pkg.dev"
IMAGE="${HOST}/${PROJECT}/warrant/web:$(date -u +%Y%m%d-%H%M%S)"

# The runtime identity. Least privilege: firebaseauth.admin to mint session cookies, write
# the `hd` custom claim and check revocation; datastore.user for Firestore. Attaching it here
# is what makes the Admin SDK work on Cloud Run with NO KEY ANYWHERE — the metadata server
# hands the container short-lived credentials, so there is no long-lived secret to leak,
# rotate, or accidentally commit.
RUN_SA="${RUN_SA:-warrant-web@${PROJECT}.iam.gserviceaccount.com}"

# Load .env if present, so the public Firebase config reaches the build without being typed
# out. Nothing secret lives there — see the note in Dockerfile.web.
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi

[ -n "$PROJECT" ] || { echo "error: no project set — gcloud config set project <id>" >&2; exit 1; }

if docker info >/dev/null 2>&1; then ENG=docker
elif podman info >/dev/null 2>&1; then ENG=podman
else echo "error: no working docker or podman" >&2; exit 1; fi

for api in run artifactregistry; do
  gcloud services list --enabled --project="$PROJECT" --format='value(config.name)' 2>/dev/null \
    | grep -q "^${api}.googleapis.com$" || {
      echo "error: ${api}.googleapis.com is not enabled — run ./infra/bootstrap.sh" >&2; exit 1; }
done

echo "project  $PROJECT"
echo "region   $REGION"
echo "service  $SERVICE"
echo "image    $IMAGE"
echo

gcloud artifacts repositories create warrant \
  --repository-format=docker --location="$REGION" --project="$PROJECT" \
  --description="Warrant images" 2>/dev/null || true

gcloud auth configure-docker "$HOST" --quiet --project="$PROJECT" >/dev/null 2>&1

echo "building…"
$ENG build --platform linux/amd64 -f "$ROOT/infra/Dockerfile.web" -t "$IMAGE" \
  --build-arg "NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY:-}" \
  --build-arg "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:-}" \
  --build-arg "NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-}" \
  --build-arg "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:-}" \
  --build-arg "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:-}" \
  --build-arg "NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID:-}" \
  --build-arg "NEXT_PUBLIC_WARRANT_DATA_SOURCE=${NEXT_PUBLIC_WARRANT_DATA_SOURCE:-fixture}" \
  --build-arg "NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL:-}" \
  "$ROOT"
echo "pushing…"
$ENG push "$IMAGE" >/dev/null

# WARRANT_FLEET_ENGINE and WARRANT_ADJUDICATOR_SA are runtime, not build-time. Without the
# first, POST /api/adjudicate refuses every call rather than guessing at an engine. Without the
# second the route runs as warrant-web, which is DELIBERATELY unable to call Vertex and returns
# a 403 that reads exactly like the model not existing.
#
# NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is passed at runtime as well as at build: the client
# bundle has it inlined, but the adjudicator reads it on the server to work out where a
# capture's bytes live.
#
# WARRANT_SWEEP_SECRET has to be listed HERE, not set once by hand, because --set-env-vars
# REPLACES the whole set rather than merging into it. Setting the secret on the service and
# then deploying again would silently drop it, and a dropped secret does not fail loudly: the
# route falls back to `NODE_ENV !== "production"`, which is false here, so every sweep would
# 401 and the seal/adjudicate/task legs would simply stop running with nothing in the logs
# saying why. It comes from .env, which is gitignored — an empty value is the same 401, which
# is the right way round.
#
# MODEL_ARMOR_LOCATION and MODEL_ARMOR_TEMPLATE were missing, and their absence was silent in
# the worst possible way. `armor.ts:endpoint()` returns null when either is unset, every capture
# records NOT_SCREENED, and NOT_SCREENED is deliberately not a pass — so `classify()` could never
# reach `inferred`. Combined with the instrument keys below being absent too (no `measured`), the
# whole provenance ladder collapsed to its floor: every field on every record sealed by the
# deployed service came out `asserted`, while the taxonomy sat on screen claiming four rungs.
# The ladder was built and tested; the deploy simply never provisioned the inputs that let a
# field climb it.
#
# WARRANT_INSTRUMENT_KEYS is `tenant|toolId|secret` — the tenant is not optional, see
# web/src/server/instruments.ts. Absent, no reading can ever be attested and `measured` is
# unreachable; that is an honest state rather than a broken one, but it should be a CHOSEN state.
#
# GOOGLE_OAUTH_CLIENT_SECRET is what the calendar callback exchanges the code with. Without it
# /api/auth/calendar/callback returns 503 and linking a calendar silently cannot work.
#
# A CUSTOM DELIMITER, and it is not decoration. `--set-env-vars` splits on commas, and
# WARRANT_INSTRUMENT_KEYS is itself a comma-separated list — so the default parsing would tear a
# two-instrument registry into fragments and set garbage. `;;` is used rather than `@` or `|`
# because both of those appear inside real values here: `@` in the adjudicator service account,
# `|` inside every instrument key.
#
# WHAT IS NOT SET, SAID OUT LOUD. Each of these fails silently and identically — the feature
# simply never happens — and the deployed build ran for weeks with the first two absent.
# Every variable below is passed to `gcloud run deploy` unconditionally, so one that is unset
# HERE is not merely skipped — it is written as empty over whatever the running service has.
# That is how a deploy silently downgrades production: the build is fine, the revision is
# healthy, and a capability just stops existing. `WARRANT_INSTRUMENT_KEYS` is the one that
# matters most, because without it no reading can be attested and the central claim of the
# product quietly becomes untrue on the live site.
#
# So: read what the service currently has, and refuse to blank it. Same posture as the sweep
# schedule below — refused rather than deployed broken. `KEEP_MISSING_ENV=1` overrides, for
# the deliberate case where a capability is genuinely being turned off.
# Names only, and only those that actually carry a value — a variable can be declared on the
# revision and be empty, which is not something worth protecting. No value is ever printed.
DEPLOYED_ENV="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format=json 2>/dev/null | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)                      # no service yet: nothing to protect, first deploy
env = d.get("spec", {}).get("template", {}).get("spec", {}).get("containers", [{}])[0].get("env", [])
print(";".join(e["name"] for e in env if e.get("value") or e.get("valueFrom")))
' 2>/dev/null || true)"
WOULD_BLANK=""
for v in MODEL_ARMOR_LOCATION MODEL_ARMOR_TEMPLATE WARRANT_INSTRUMENT_KEYS \
         GOOGLE_OAUTH_CLIENT_SECRET WARRANT_SWEEP_SECRET; do
  if [ -z "${!v:-}" ]; then
    case "$v" in
      MODEL_ARMOR_*)  echo "note: $v unset — evidence records NOT_SCREENED, so no field can reach 'inferred'." ;;
      WARRANT_INSTRUMENT_KEYS) echo "note: $v unset — no reading can be attested, so no field can reach 'measured'." ;;
      GOOGLE_OAUTH_CLIENT_SECRET) echo "note: $v unset — linking a calendar will return 503." ;;
      WARRANT_SWEEP_SECRET) echo "note: $v unset — every sweep will 401 and nothing scheduled will run." ;;
    esac
    case ";${DEPLOYED_ENV};" in *";$v;"*) WOULD_BLANK="$WOULD_BLANK $v" ;; esac
  fi
done
if [ -n "$WOULD_BLANK" ] && [ -z "${KEEP_MISSING_ENV:-}" ]; then
  echo >&2
  echo "error: these are set on the running service and empty here, so this deploy would" >&2
  echo "       erase them from $SERVICE:" >&2
  for v in $WOULD_BLANK; do echo "         $v" >&2; done
  echo >&2
  echo "       Put them back in .env and re-run. To turn a capability off on purpose:" >&2
  echo "         KEEP_MISSING_ENV=1 ./infra/deploy-web.sh" >&2
  exit 1
fi

# Scale to zero: no request, no container, no charge.
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 0 \
  --max-instances 4 \
  --concurrency 80 \
  --cpu 1 \
  --memory 512Mi \
  --service-account "$RUN_SA" \
  --set-env-vars "^;;^GCP_PROJECT=${PROJECT};;WARRANT_REGION=${WARRANT_REGION:-us};;GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID:-};;GOOGLE_OAUTH_CLIENT_SECRET=${GOOGLE_OAUTH_CLIENT_SECRET:-};;WARRANT_FLEET_ENGINE=${WARRANT_FLEET_ENGINE:-};;WARRANT_ADJUDICATOR_SA=${WARRANT_ADJUDICATOR_SA:-warrant-adjudicator@${PROJECT}.iam.gserviceaccount.com};;NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:-};;WARRANT_SWEEP_SECRET=${WARRANT_SWEEP_SECRET:-};;MODEL_ARMOR_LOCATION=${MODEL_ARMOR_LOCATION:-};;MODEL_ARMOR_TEMPLATE=${MODEL_ARMOR_TEMPLATE:-};;WARRANT_INSTRUMENT_KEYS=${WARRANT_INSTRUMENT_KEYS:-}" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
echo
echo "live: $URL"

# --- the sweep, on a clock ---------------------------------------------------------------
#
# THE ASYNCHRONOUS HALF OF THIS SYSTEM DOES NOT EXIST WITHOUT THIS.
#
# `/api/tasks/sweep` is what makes the fleet run unattended: it adjudicates captures a dying
# client never triggered, rules on steps a technician walked away from, seals jobs whose last
# step passed after everyone went home, re-notifies escalations nobody claimed, and audits
# procedures against the records behind them. Every one of those is a promise the README makes
# about days, not about clicks.
#
# It was documented in `docs/architecture.md`, referenced by the route, described in the spec —
# and created by NOTHING. A judge following the spin-up instructions got a system that never
# swept, and the failure is invisible: no error, no empty screen, just a fleet that quietly
# never wakes. So it is created here, next to the service it calls, and it is idempotent.
#
# Once a minute, which is what specs/2026-08-20-firestore-design.md section 8 says and what the
# two-minute undecided-capture net assumes. The route takes a LEASE, so a sweep running long
# does not stack: an overlapping call returns 200 with `skipped`, because Cloud Scheduler
# retries a non-2xx and a retry here would be another overlapping sweep.
SWEEP_CRON="${WARRANT_SWEEP_CRON:-* * * * *}"
SWEEP_JOB="${WARRANT_SWEEP_JOB:-warrant-sweep}"

if [ -z "${WARRANT_SWEEP_SECRET:-}" ]; then
  # Refused rather than created broken. The sweep authorises on this header and would 401 on
  # every single firing, which looks exactly like a scheduler that is working.
  echo
  echo "skipping the sweep schedule — WARRANT_SWEEP_SECRET is unset, so every firing would 401."
  echo "  set it in .env and re-run, or the fleet will never wake on its own."
else
  echo
  echo "scheduling the sweep — $SWEEP_CRON"
  gcloud services enable cloudscheduler.googleapis.com --project "$PROJECT" --quiet >/dev/null 2>&1 || true

  # create-or-update, because a redeploy must not fail on an existing job and must not leave a
  # stale URL behind when the service hostname changes.
  # `create` spells it --headers and `update` spells it --update-headers. Same field, two
  # names, and using the wrong one fails with "unrecognized arguments" rather than anything
  # about scheduling.
  if gcloud scheduler jobs describe "$SWEEP_JOB" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
    SCHED_VERB=update
    SCHED_HEADER_FLAG=--update-headers
  else
    SCHED_VERB=create
    SCHED_HEADER_FLAG=--headers
  fi

  gcloud scheduler jobs "$SCHED_VERB" http "$SWEEP_JOB" \
    --location "$REGION" \
    --project "$PROJECT" \
    --schedule "$SWEEP_CRON" \
    --time-zone "Etc/UTC" \
    --uri "$URL/api/tasks/sweep" \
    --http-method POST \
    "$SCHED_HEADER_FLAG" "x-warrant-sweep=${WARRANT_SWEEP_SECRET}" \
    --attempt-deadline 320s \
    --max-retry-attempts 0 \
    --quiet
  # No retries ON PURPOSE. The sweep is idempotent and self-healing — anything it misses is
  # picked up by the next firing sixty seconds later — so a retry buys nothing and costs an
  # overlapping run against the lease.

  echo "  ok — $SWEEP_JOB fires $SWEEP_CRON at $URL/api/tasks/sweep"
  echo "  watch it:  gcloud scheduler jobs describe $SWEEP_JOB --location $REGION"
  echo "  run it now: gcloud scheduler jobs run $SWEEP_JOB --location $REGION"
fi

# The sign-in popup is refused from any origin Identity Platform does not know about, and a
# Cloud Run hostname is generated rather than chosen — so it cannot be authorised in advance.
# Doing it here means a fresh project reaches working sign-in without a console visit.
RUN_HOST="${URL#https://}"
echo
echo "authorising $RUN_HOST for sign-in"
AT="$(gcloud auth print-access-token)"
curl -sS "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/config" \
  -H "Authorization: Bearer $AT" -H "x-goog-user-project: $PROJECT" \
  > "$ROOT/.warrant-idp-config.json"

python3 "$ROOT/infra/authorize-domain.py" "$ROOT/.warrant-idp-config.json" "$RUN_HOST" \
  > "$ROOT/.warrant-domains.json"

curl -sS -X PATCH \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/config?updateMask=authorizedDomains" \
  -H "Authorization: Bearer $AT" -H "x-goog-user-project: $PROJECT" \
  -H "Content-Type: application/json" -d @"$ROOT/.warrant-domains.json" >/dev/null
rm -f "$ROOT/.warrant-idp-config.json" "$ROOT/.warrant-domains.json"
echo "  ok"
