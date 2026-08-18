#!/usr/bin/env bash
# Deploy the landing page to Cloud Run, scaled to zero.
#
#   ./scripts/deploy-site.sh
#
# Costs nothing when nobody is looking at it: min-instances=0 means no idle
# container, and CPU is only allocated during a request.

set -euo pipefail

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE:-warrant-site}"

[ -n "$PROJECT" ] || { echo "error: no project set. gcloud config set project <id>" >&2; exit 1; }

echo "deploying $SERVICE to $PROJECT / $REGION"

gcloud run deploy "$SERVICE" \
  --source "$(dirname "$0")/../site" \
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
echo
echo "next, if you want it on your own domain:"
echo "  gcloud beta run domain-mappings create --service $SERVICE --domain fillitin.ink --region $REGION"
