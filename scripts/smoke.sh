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
#   5. optionally, a real browser drives a procedure through to a sealed record

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

step "1/5  contract — schemas resolve and agent schemas are Vertex-safe"
node contract/check.mjs

step "2/5  design tokens — one source, two stacks"
node design/build-tokens.mjs

step "3/5  fixtures typecheck against the contract"
cd web
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run gen >/dev/null
npx tsc --noEmit
echo "ok — every fixture matches the generated types"

step "4/5  every surface renders from fixtures with no backend"
npm run build >/dev/null
echo "ok — all routes built; the static ones prerendered from FixtureSource alone"

step "5/5  a procedure, end to end, in a real browser"
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
