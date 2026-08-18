#!/usr/bin/env bash
# Deploy the landing page to Cloud Run, scaled to zero.
#
#   ./infra/deploy-site.sh
#
# Builds locally and pushes straight to Artifact Registry. Cloud Build is
# deliberately not used: projects created recently have no Cloud Build service
# account, so `builds submit` fails with an unhelpful PERMISSION_DENIED. Local
# builds are also faster, free, and one less identity to reason about.
# The Cloud Build path is kept in infra/cloudbuild.yaml for CI, where there is
# no local docker — it needs a --service-account and the grants at the bottom
# of this file.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE:-warrant-site}"
HOST="${REGION}-docker.pkg.dev"
IMAGE="${HOST}/${PROJECT}/warrant/site:$(date -u +%Y%m%d-%H%M%S)"

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
echo "engine   $ENG"
echo "image    $IMAGE"
echo

gcloud artifacts repositories create warrant \
  --repository-format=docker --location="$REGION" --project="$PROJECT" \
  --description="Warrant images" 2>/dev/null || true

gcloud auth configure-docker "$HOST" --quiet --project="$PROJECT" >/dev/null 2>&1

echo "building…"
$ENG build --platform linux/amd64 -f "$ROOT/infra/Dockerfile" -t "$IMAGE" "$ROOT" >/dev/null
echo "pushing…"
$ENG push "$IMAGE" >/dev/null

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

# ---------------------------------------------------------------------------
# If you ever need the Cloud Build path (CI, no local docker), grant the
# compute default service account what a build needs and pass it explicitly:
#
#   N=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
#   SA="${N}-compute@developer.gserviceaccount.com"
#   for r in roles/logging.logWriter roles/artifactregistry.writer roles/storage.objectAdmin; do
#     gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$r"
#   done
#   gcloud builds submit "$ROOT" --config "$ROOT/infra/cloudbuild.yaml" \
#     --substitutions="_IMAGE=$IMAGE" --service-account="projects/$PROJECT/serviceAccounts/$SA"
# ---------------------------------------------------------------------------
