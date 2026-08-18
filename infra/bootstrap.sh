#!/usr/bin/env bash
# Enable every API Warrant needs, once, so no deploy dies on SERVICE_DISABLED.
#
#   ./infra/bootstrap.sh
#
# Safe to re-run. Enabling an already-enabled API is a no-op.

set -euo pipefail

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
[ -n "$PROJECT" ] || { echo "error: no project set — gcloud config set project <id>" >&2; exit 1; }

echo "enabling APIs on $PROJECT — this takes a minute"

gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  pubsub.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  logging.googleapis.com \
  cloudtrace.googleapis.com \
  iamcredentials.googleapis.com \
  modelarmor.googleapis.com \
  --project="$PROJECT"

echo
echo "enabled:"
gcloud services list --enabled --project="$PROJECT" \
  --format='value(config.name)' | sort | sed 's/^/  /'

cat <<NOTE

Propagation takes up to a minute. If a deploy still reports SERVICE_DISABLED,
wait and retry rather than debugging IAM — the error is misleading.

Not covered here, because they are not plain API enablements:
  - Firestore needs a database created once:
      gcloud firestore databases create --location=nam5 --project=$PROJECT
  - Model Armor templates must live in the 'us' or 'eu' MULTI-region for image
    modality. A template in us-central1 fails silently. See docs/architecture.md §8.
  - Agent Engine, Agent Registry, Memory Bank, Agent Identity and Agent Gateway
    are unconfirmed in this project. Check them before building against them.
NOTE
