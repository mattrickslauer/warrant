#!/usr/bin/env bash
# Publish firestore.rules and the composite indexes.
#
#   ./infra/deploy-rules.sh
#
# Uses the Firebase Rules REST API and gcloud rather than the firebase CLI, so the only
# credential involved is the gcloud login you already have. Safe to re-run: publishing an
# identical ruleset is harmless, and an index that already exists reports so and is skipped.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
[ -n "$PROJECT" ] || { echo "error: no project set — gcloud config set project <id>" >&2; exit 1; }

TOKEN="$(gcloud auth print-access-token)"
API=(-H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" -H "Content-Type: application/json")

echo "publishing firestore.rules to $PROJECT"

# The API takes the source inline, so the file is embedded as a JSON string.
PAYLOAD="$(python3 - "$ROOT/firestore.rules" <<'PY'
import json, sys
source = open(sys.argv[1]).read()
print(json.dumps({"source": {"files": [{"name": "firestore.rules", "content": source}]}}))
PY
)"

RULESET="$(curl -sS -X POST "https://firebaserules.googleapis.com/v1/projects/$PROJECT/rulesets" \
  "${API[@]}" -d "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("name") or json.dumps(d))')"

case "$RULESET" in
  projects/*) ;;
  *) echo "error: ruleset was not created: $RULESET" >&2; exit 1 ;;
esac
echo "  ruleset $RULESET"

curl -sS -X PATCH "https://firebaserules.googleapis.com/v1/projects/$PROJECT/releases/cloud.firestore" \
  "${API[@]}" -d "{\"release\":{\"name\":\"projects/$PROJECT/releases/cloud.firestore\",\"rulesetName\":\"$RULESET\"}}" \
  >/dev/null
echo "  released to cloud.firestore"

echo
echo "creating composite indexes — already-existing ones are skipped"

# Indexes build asynchronously and can take minutes on a populated collection. On an empty
# one they are near-instant, which is the case on a fresh project.
create_index() {
  local scope="$1"; shift
  local group="$1"; shift
  local out status
  out="$(gcloud firestore indexes composite create \
    --project="$PROJECT" --collection-group="$group" --query-scope="$scope" \
    "$@" --async 2>&1)" && status=0 || status=$?

  if [ "$status" -eq 0 ]; then
    echo "  $group ($scope) — created"
  elif printf '%s' "$out" | grep -qiE 'already exists'; then
    echo "  $group ($scope) — exists"
  else
    # A genuine failure must not be reported as success. An index that silently never got
    # created is a query that fails in production with a link to go and create it by hand.
    echo "  $group ($scope) — FAILED" >&2
    printf '%s\n' "$out" >&2
    return 1
  fi
}

create_index COLLECTION spec_chunks \
  --field-config=field-path=node_urns,array-config=CONTAINS \
  --field-config=field-path=embedding,vector-config='{"dimension":"1536","flat":"{}"}'

create_index COLLECTION spec_nodes \
  --field-config=field-path=path,array-config=CONTAINS \
  --field-config=field-path=iso14224_level,order=ascending

create_index COLLECTION nodes \
  --field-config=field-path=path,array-config=CONTAINS \
  --field-config=field-path=iso14224_level,order=ascending

create_index COLLECTION readings \
  --field-config=field-path=key,order=ascending \
  --field-config=field-path=at,order=descending

create_index COLLECTION_GROUP readings \
  --field-config=field-path=key,order=ascending \
  --field-config=field-path=at,order=descending

create_index COLLECTION_GROUP placements \
  --field-config=field-path=position_urn,order=ascending \
  --field-config=field-path=to,order=ascending

create_index COLLECTION jobs \
  --field-config=field-path=status,order=ascending \
  --field-config=field-path=started_at,order=descending

echo
echo "done. firestore.indexes.json is the source of truth for what should exist here."
