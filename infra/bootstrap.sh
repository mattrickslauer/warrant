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
  identitytoolkit.googleapis.com \
  firebase.googleapis.com \
  firebaserules.googleapis.com \
  cloudscheduler.googleapis.com \
  --project="$PROJECT"

echo
echo "enabled:"
gcloud services list --enabled --project="$PROJECT" \
  --format='value(config.name)' | sort | sed 's/^/  /'

# --- the adjudicator ------------------------------------------------------------------
#
# Separate from warrant-web ON PURPOSE. warrant-web mints session cookies and reads
# Firestore; nothing that can do that should also be able to run models. Sourcing .env and
# calling Vertex as warrant-web fails with a 403 on aiplatform.endpoints.predict that reads
# exactly like the model not existing — which is the whole reason this account exists.

ADJ="warrant-adjudicator@${PROJECT}.iam.gserviceaccount.com"

if ! gcloud iam service-accounts describe "$ADJ" --project "$PROJECT" >/dev/null 2>&1; then
  echo "creating $ADJ"
  gcloud iam service-accounts create warrant-adjudicator --project "$PROJECT" \
    --display-name "Warrant adjudicator" \
    --description "Calls the agent fleet and writes decisions. Cannot mint sessions."
fi

for ROLE in roles/aiplatform.user roles/datastore.user roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:$ADJ" --role "$ROLE" --condition=None >/dev/null
done

# The Cloud Run runtime identity must be allowed to BECOME the adjudicator. Without this the
# impersonation in web/src/server/fleet.ts fails on generateAccessToken with a 403 that says
# nothing whatever about the wrong service account being configured.
gcloud iam service-accounts add-iam-policy-binding "$ADJ" --project "$PROJECT" \
  --member "serviceAccount:warrant-web@${PROJECT}.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountTokenCreator >/dev/null

# The Cloud Run runtime identity needs to READ evidence — not to serve it, but to put it
# through Model Armor before any model is shown it. Granted on the bucket rather than the
# project, and viewer rather than admin: this identity screens evidence, it never rewrites it.
#
# Without it the download fails, screenEvidence() records NOT_SCREENED, and the record
# honestly says the check did not run — which is the right failure and still the wrong outcome.
EVIDENCE_BUCKET="${FIREBASE_STORAGE_BUCKET:-${PROJECT}-evidence}"
if gcloud storage buckets describe "gs://$EVIDENCE_BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets add-iam-policy-binding "gs://$EVIDENCE_BUCKET" \
    --member "serviceAccount:warrant-web@${PROJECT}.iam.gserviceaccount.com" \
    --role roles/storage.objectViewer >/dev/null
  gcloud storage buckets add-iam-policy-binding "gs://$EVIDENCE_BUCKET" \
    --member "serviceAccount:$ADJ" \
    --role roles/storage.objectViewer >/dev/null
  echo "evidence bucket readable: gs://$EVIDENCE_BUCKET"
else
  echo "note: gs://$EVIDENCE_BUCKET does not exist yet — create it before capturing evidence"
fi

echo "adjudicator ready: $ADJ"

cat <<NOTE

Propagation takes up to a minute. If a deploy still reports SERVICE_DISABLED,
wait and retry rather than debugging IAM — the error is misleading.

Not covered here, because they are not plain API enablements:
  - Firestore needs a database created once:
      gcloud firestore databases create --location=nam5 --project=$PROJECT
  - Model Armor templates must live in the 'us' or 'eu' MULTI-region for image
    modality. A template in us-central1 fails silently. See docs/architecture.md §8.
  - Firestore rules and indexes are published separately:
      ./infra/deploy-rules.sh
  - Sign-in needs Firebase added to the project and a web app registered:
      TOKEN=\$(gcloud auth print-access-token)
      curl -sX POST "https://firebase.googleapis.com/v1beta1/projects/$PROJECT:addFirebase" \\
        -H "Authorization: Bearer \$TOKEN" -H "x-goog-user-project: $PROJECT" -d '{}'
      curl -sX POST "https://firebase.googleapis.com/v1beta1/projects/$PROJECT/webApps" \\
        -H "Authorization: Bearer \$TOKEN" -H "x-goog-user-project: $PROJECT" \\
        -H "Content-Type: application/json" -d '{"displayName":"Warrant Web"}'
    Anonymous sign-in can then be enabled over the API, but the GOOGLE provider cannot:
    it needs an OAuth client, and there is no public API that creates one. Enable it once
    in the console — Authentication -> Sign-in method -> Google — which creates the client
    for you. That is the only manual step in this whole setup.
  - Agent Engine IS confirmed and the fleet is deployed to it:
      ./.venv-deploy/bin/python ./infra/deploy-agents.py          # deploy or update
      ./.venv-deploy/bin/python ./infra/deploy-agents.py --smoke  # ask it for its roster
    Put the resource name it prints into WARRANT_FLEET_ENGINE.
    Agent Registry, Memory Bank, Agent Identity and Agent Gateway remain unconfirmed.
NOTE
