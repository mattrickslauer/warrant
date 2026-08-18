#!/usr/bin/env bash
# Deploy the landing page to Cloud Run, scaled to zero.
#
#   ./infra/deploy-site.sh
#
# Nothing bills while nobody is looking at it: min-instances=0 means no idle
# container, and CPU is only allocated during a request.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE:-warrant-site}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/warrant/site:$(date -u +%Y%m%d-%H%M%S)"

[ -n "$PROJECT" ] || { echo "error: no project set — gcloud config set project <id>" >&2; exit 1; }

for api in cloudbuild run artifactregistry; do
  gcloud services list --enabled --project="$PROJECT" --format='value(config.name)' 2>/dev/null \
    | grep -q "^${api}.googleapis.com$" || {
      echo "error: ${api}.googleapis.com is not enabled on $PROJECT" >&2
      echo "       run ./infra/bootstrap.sh first" >&2
      exit 1
    }
done

echo "project  $PROJECT"
echo "region   $REGION"
echo "image    $IMAGE"
echo

# Artifact Registry repo, created once. Ignore the error if it already exists.
gcloud artifacts repositories create warrant \
  --repository-format=docker --location="$REGION" --project="$PROJECT" \
  --description="Warrant images" 2>/dev/null || true

gcloud builds submit "$ROOT" \
  --config "$ROOT/infra/cloudbuild.yaml" \
  --substitutions="_IMAGE=${IMAGE}" \
  --project "$PROJECT"

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
  --memory 256Mi \
  --cpu-throttling \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
echo
echo "live: $URL"
