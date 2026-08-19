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
$ENG build --platform linux/amd64 -f "$ROOT/infra/Dockerfile.web" -t "$IMAGE" "$ROOT"
echo "pushing…"
$ENG push "$IMAGE" >/dev/null

# Scale to zero: no request, no container, no charge. The surfaces are all fixture-backed
# for now, so a cold start costs a second and nothing else.
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
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
echo
echo "live: $URL"
