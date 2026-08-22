#!/usr/bin/env bash
# Fetch android/app/google-services.json for whoever is deploying this.
#
#   ./infra/fetch-google-services.sh
#
# The file is not in the tree: it is per-deployer, exactly like .env. It is NOT a secret —
# every value in it ships inside the APK — but committing it pins the repo to one Firebase
# project, and a stale copy is worse than an absent one because the build succeeds and the
# app talks to the wrong place.
#
# Needs the Android apps to exist on the project already. They are created once, in the
# Firebase console or over the same API, one per applicationId — and DEBUG BUILDS USE A
# DIFFERENT ONE (`ink.warrant.debug`, from applicationIdSuffix). A config with only the
# release package builds fine and then fails at runtime with a message about the app not
# being registered.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
[ -n "$PROJECT" ] || { echo "error: no project — gcloud config set project <id>" >&2; exit 1; }

PACKAGE="${1:-ink.warrant}"
TOKEN="$(gcloud auth print-access-token)"

APP="$(curl -sS "https://firebase.googleapis.com/v1beta1/projects/$PROJECT/androidApps" \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" \
  | python3 -c "
import json, sys
want = '$PACKAGE'
apps = json.load(sys.stdin).get('apps', [])
for a in apps:
    if a.get('packageName') == want:
        print(a['name']); break
else:
    sys.exit(f'no Android app for {want}; have ' + ', '.join(a.get('packageName','?') for a in apps))
")"

curl -sS "https://firebase.googleapis.com/v1beta1/$APP/config" \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" \
  | python3 -c "
import base64, json, sys
d = json.load(sys.stdin)
if 'configFileContents' not in d:
    sys.exit('unexpected reply: ' + json.dumps(d)[:400])
raw = base64.b64decode(d['configFileContents']).decode()
open('$ROOT/android/app/google-services.json', 'w').write(raw)
j = json.loads(raw)
print('wrote android/app/google-services.json')
print('  project ', j['project_info']['project_id'])
print('  packages', ', '.join(c['client_info']['android_client_info']['package_name'] for c in j['client']))
"
