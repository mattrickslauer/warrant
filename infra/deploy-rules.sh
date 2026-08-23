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

# Publish a ruleset to a release track, and SAY SO ONLY IF IT WORKED.
#
# This used to be a bare `curl -X PATCH … >/dev/null` followed by an unconditional success
# line. PATCH cannot create a release that does not exist yet, so on a project where the
# release had never been made it returned 404, the body went to /dev/null, and the script
# printed "released" — while firestore.rules governed nothing at all. Every server path kept
# working, because the Admin SDK bypasses rules, so nothing looked wrong until a phone tried
# to read its own tenant and was refused.
#
# So: POST to create, PATCH to update, and check the reply either way.
release() {
  local track="$1" ruleset="$2" out
  local name="projects/$PROJECT/releases/$track"
  local body="{\"name\":\"$name\",\"rulesetName\":\"$ruleset\"}"

  out="$(curl -sS -X POST "https://firebaserules.googleapis.com/v1/projects/$PROJECT/releases" \
    "${API[@]}" -d "$body")"

  # Already there: update it instead.
  if printf '%s' "$out" | grep -q '"code": *409'; then
    out="$(curl -sS -X PATCH "https://firebaserules.googleapis.com/v1/$name" \
      "${API[@]}" -d "{\"release\":$body}")"
  fi

  if printf '%s' "$out" | grep -q '"error"'; then
    echo "error: $track was NOT released" >&2
    printf '%s\n' "$out" >&2
    exit 1
  fi
  echo "  released to $track"
}

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

release cloud.firestore "$RULESET"

# Storage rules go to a different release track (firebase.storage) but through the same API.
# There were no storage rules at all until 2026-08-20 while storageBucket was already
# configured, so this step is not optional — an unpublished storage ruleset is an open bucket.
echo
echo "publishing storage.rules to $PROJECT"

STORAGE_PAYLOAD="$(python3 - "$ROOT/storage.rules" <<'PY'
import json, sys
source = open(sys.argv[1]).read()
print(json.dumps({"source": {"files": [{"name": "storage.rules", "content": source}]}}))
PY
)"

STORAGE_RULESET="$(curl -sS -X POST "https://firebaserules.googleapis.com/v1/projects/$PROJECT/rulesets" \
  "${API[@]}" -d "$STORAGE_PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("name") or json.dumps(d))')"

case "$STORAGE_RULESET" in
  projects/*) ;;
  *) echo "error: storage ruleset was not created: $STORAGE_RULESET" >&2; exit 1 ;;
esac
echo "  ruleset $STORAGE_RULESET"

# The release name embeds the bucket, URL-escaped. Getting this wrong publishes a valid
# ruleset that governs nothing, which looks exactly like success.
# The evidence bucket, which is NOT the Firebase default name. `${PROJECT}.firebasestorage.app`
# is what google-services.json advertises and it has never existed in this project — so until
# 2026-08-21 this script released a valid ruleset to a bucket that was not there, which is
# precisely the "governs nothing and looks like success" failure the comment above warns about.
BUCKET="${FIREBASE_STORAGE_BUCKET:-${PROJECT}-evidence}"
RELEASE="projects/$PROJECT/releases/firebase.storage%2F$BUCKET"

release "firebase.storage/$BUCKET" "$STORAGE_RULESET"

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

# The sweep, across every tenant. COLLECTION_GROUP is load-bearing: /tenants/{t}/tasks is a
# subcollection, so a COLLECTION-scoped index serves one tenant at a time and the cross-tenant
# sweep does not run at all.
create_index COLLECTION_GROUP tasks \
  --field-config=field-path=status,order=ascending \
  --field-config=field-path=notify_after,order=ascending

create_index COLLECTION tasks \
  --field-config=field-path=assignee_uid,order=ascending \
  --field-config=field-path=status,order=ascending \
  --field-config=field-path=due_at,order=ascending

create_index COLLECTION tasks \
  --field-config=field-path=assignee_role,order=ascending \
  --field-config=field-path=status,order=ascending \
  --field-config=field-path=due_at,order=ascending

create_index COLLECTION readings \
  --field-config=field-path=component_id,order=ascending \
  --field-config=field-path=key,order=ascending \
  --field-config=field-path=at,order=descending

create_index COLLECTION procedures \
  --field-config=field-path=status,order=ascending \
  --field-config=field-path=updated_at,order=descending

create_index COLLECTION members \
  --field-config=field-path=role,order=ascending \
  --field-config=field-path=display_name,order=ascending

# The sweep's net: captures nobody adjudicated, across every job in every tenant. Without
# this the sweep returns a 500 naming the missing index rather than a clean sweep that
# adjudicated nothing — see undecidedCaptures() in web/src/server/tasks.ts.
create_index COLLECTION_GROUP captures \
  --field-config=field-path=adjudicated,order=ascending \
  --field-config=field-path=created_at,order=ascending

# --- single-field indexes ---------------------------------------------------------------
#
# A COLLECTION GROUP query that merely ORDERS BY one field still needs an index, and it is a
# field-level exemption rather than a composite — `indexes composite create` cannot express it
# and returns an error that sounds like the query is malformed.
#
# The operator view at /fleet reads every decision across every tenant, newest first. Without
# this it fails with FAILED_PRECONDITION, which is why that page distinguishes "the query
# failed" from "the fleet has decided nothing" instead of rendering an empty state.
#
# `gcloud firestore indexes fields update` cannot express queryScope — its --index flag takes
# only `order` — so this goes through the REST API. The write REPLACES indexConfig, which is
# why the two collection-scope indexes are restated here: omitting them deletes them.
echo
echo "creating single-field indexes"
FIELD="https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/collectionGroups/decisions/fields/at"
curl -sS -X PATCH "$FIELD?updateMask=indexConfig" "${API[@]}" -d '{"indexConfig":{"indexes":[
  {"fields":[{"fieldPath":"at","order":"ASCENDING"}],"queryScope":"COLLECTION"},
  {"fields":[{"fieldPath":"at","order":"DESCENDING"}],"queryScope":"COLLECTION"},
  {"fields":[{"fieldPath":"at","order":"DESCENDING"}],"queryScope":"COLLECTION_GROUP"}
]}}' >/dev/null
echo "  decisions.at (COLLECTION_GROUP desc) — requested"

# The sweep's Foreman leg: steps a technician gave a reason for, newest first, across every
# tenant. stalledSteps() in web/src/server/tasks.ts orders by `reason_at` on a COLLECTION GROUP,
# so without this it fails with FAILED_PRECONDITION and the Instructor and the Foreman are never
# reached — the sweep reports a clean run while nobody is raised for a stalled step.
#
# The COLLECTION entries are restated deliberately: this write REPLACES indexConfig, so leaving
# them out deletes the automatic ones.
FIELD="https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/collectionGroups/step_outcomes/fields/reason_at"
curl -sS -X PATCH "$FIELD?updateMask=indexConfig" "${API[@]}" -d '{"indexConfig":{"indexes":[
  {"fields":[{"fieldPath":"reason_at","order":"ASCENDING"}],"queryScope":"COLLECTION"},
  {"fields":[{"fieldPath":"reason_at","order":"DESCENDING"}],"queryScope":"COLLECTION"},
  {"fields":[{"fieldPath":"reason_at","order":"DESCENDING"}],"queryScope":"COLLECTION_GROUP"}
]}}' >/dev/null
echo "  step_outcomes.reason_at (COLLECTION_GROUP desc) — requested"

# The sweep's Auditor leg: every sealed job in every tenant, to find which procedures have
# enough finished work behind them to be worth reading. proceduresDueAnAudit() queries
# `status == "sealed"` on a COLLECTION GROUP.
FIELD="https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/collectionGroups/jobs/fields/status"
curl -sS -X PATCH "$FIELD?updateMask=indexConfig" "${API[@]}" -d '{"indexConfig":{"indexes":[
  {"fields":[{"fieldPath":"status","order":"ASCENDING"}],"queryScope":"COLLECTION"},
  {"fields":[{"fieldPath":"status","order":"DESCENDING"}],"queryScope":"COLLECTION"},
  {"fields":[{"fieldPath":"status","order":"ASCENDING"}],"queryScope":"COLLECTION_GROUP"}
]}}' >/dev/null
echo "  jobs.status (COLLECTION_GROUP asc) — requested"

echo
echo "done."
echo
echo "NOTE: the create_index calls above are HAND-MAINTAINED and are what actually runs."
echo "firestore.indexes.json states the same set for the emulator and for review. Adding an"
echo "index to that file alone deploys nothing — add it here too, or the query fails in"
echo "production with a link telling you to create it by hand."
