#!/usr/bin/env bash
# Build and start the anvil.
#
#   ./anvil/run.sh              # foreground, port 8099
#   ANVIL_PORT=9000 ./anvil/run.sh
#
# Needs a JDK and nothing else. The Kotlin compiler and stdlib are resolved at startup from
# the Gradle cache the Android build already populated, so there is no download and no build
# step of its own — set ANVIL_KOTLIN_CP to override that for a container that ships them.
#
# Must run from the repo root, or with ANVIL_DRIVER_KT pointing at Driver.kt: the anvil derives
# its compile prelude from that file rather than carrying a copy of the interface.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${ANVIL_BUILD:-$ROOT/anvil/build}"
mkdir -p "$OUT"
javac -d "$OUT" anvil/Anvil.java
exec java -cp "$OUT" Anvil
