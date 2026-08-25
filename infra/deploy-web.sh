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
  --set-env-vars "GCP_PROJECT=${PROJECT},WARRANT_REGION=${WARRANT_REGION:-us},GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID:-},WARRANT_FLEET_ENGINE=${WARRANT_FLEET_ENGINE:-},WARRANT_ADJUDICATOR_SA=${WARRANT_ADJUDICATOR_SA:-warrant-adjudicator@${PROJECT}.iam.gserviceaccount.com},NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:-},WARRANT_SWEEP_SECRET=${WARRANT_SWEEP_SECRET:-}" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
echo
echo "live: $URL"

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
