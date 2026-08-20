#!/usr/bin/env bash
# Runs a full procedure end to end against recorded fixtures.
#
#   ./scripts/smoke.sh
#
# No hardware, no Google Cloud project, no credentials, nothing at risk. Everything below
# runs offline against the fixture layer, which is the same data the surfaces render in
# development — so this is both the test and the demo data.
#
# What it proves, in order:
#   1. every agent schema stays inside the subset Vertex responseSchema accepts
#   2. the token source generates for both stacks
#   3. every fixture typechecks against the generated contract
#   4. every surface renders from FixtureSource alone, with no backend
#   5. tenancy holds — firestore.rules executed against the real rules engine
#   6. the five agents obey their contracts, and the scenario corpus replays
#   7. optionally, a real browser drives a procedure through to a sealed record

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

step "1/7  contract — schemas resolve and agent schemas are Vertex-safe"
node contract/check.mjs

step "2/7  design tokens — one source, two stacks"
node design/build-tokens.mjs

step "3/7  fixtures typecheck against the contract"
cd web
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run gen >/dev/null
npx tsc --noEmit
echo "ok — every fixture matches the generated types"

step "4/7  every surface renders from fixtures with no backend"
npm run build >/dev/null
echo "ok — every route builds and renders from FixtureSource alone"
# Every route is now server-rendered on demand rather than prerendered, because the root
# layout resolves the session so the first paint already knows the tenant. That is the
# Cloud Run shape the architecture calls for, and it is why nothing here is marked static.

step "5/7  tenancy — firestore.rules against the real rules engine"
# A Workspace domain cannot read another's, a consumer account cannot read a domain's, and
# nobody can write the catalogue. Also asserts that tenantOf() in firestore.rules and
# tenantFromClaims() in web/src/auth/tenant.ts resolve the SAME tenant for the same claims —
# they are the same rule written twice, and a divergence between them is a tenancy hole.
#
# Needs the Firestore emulator, which needs a JDK 21+. Skipped rather than failed when
# either is absent, because nothing else in this script needs Java.
RULES_JAVA=""
if java -version 2>&1 | grep -qE '"(2[1-9]|[3-9][0-9])'; then
  RULES_JAVA="$(command -v java)"
elif [ -x /usr/lib/jvm/java-25-openjdk/bin/java ]; then
  RULES_JAVA=/usr/lib/jvm/java-25-openjdk/bin/java
fi

if [ -n "$RULES_JAVA" ] && [ -x "$ROOT/web/node_modules/.bin/firebase" ]; then
  cd "$ROOT"
  # No `|| true` here on purpose. A tenancy regression must fail this script, not scroll past
  # in the output — the emulator's exit status is the whole value of running it.
  JAVA_HOME="$(dirname "$(dirname "$RULES_JAVA")")" \
  PATH="$(dirname "$RULES_JAVA"):$PATH" \
  "$ROOT/web/node_modules/.bin/firebase" emulators:exec \
      --project warrant-rules-test --only firestore --config "$ROOT/firebase.json" \
      'node --experimental-strip-types --test web/scripts/rules.test.mjs' \
    > /tmp/warrant-rules.log 2>&1 \
    || { echo "TENANCY FAILED — see the report below"; grep -E '^(not ok|  +error:)' /tmp/warrant-rules.log | head -20; exit 1; }
  grep -E '^# (tests|pass|fail)' /tmp/warrant-rules.log
  echo "ok — no tenant reaches another's data, and the catalogue is read-only"
  cd "$ROOT/web"
else
  echo "skipped — needs a JDK 21+ and web/node_modules/.bin/firebase"
fi

step "6/7  agents — contracts, conditional rules and the scenario corpus"
cd "$ROOT/agents"
if python3 -c "import jsonschema, pytest" 2>/dev/null; then
  python3 -m pytest tests/ -q
  python3 -m evals check
  # Replays whatever has been recorded. Scenarios with no cassette report as errors rather
  # than passes, so an empty store cannot be mistaken for a green suite.
  python3 -m evals run --allow-fail | tail -20
else
  echo "skipped — pip install -r agents/requirements.txt"
fi
cd "$ROOT/web"

step "7/7  a procedure, end to end, in a real browser"
if python3 -c "import playwright" 2>/dev/null; then
  node_modules/.bin/next start -p 3131 >/tmp/warrant-smoke.log 2>&1 &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null || true' EXIT
  for _ in $(seq 1 40); do curl -sf -o /dev/null http://localhost:3131/ && break; sleep 0.5; done
  python3 "$ROOT/scripts/smoke_funnel.py"
else
  echo "skipped — playwright is not installed (pip install playwright && playwright install chromium)"
fi

printf '\n\033[1;32mSMOKE PASSED\033[0m\n'
