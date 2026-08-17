#!/usr/bin/env bash
# Fetch a paper into the research catalog's store.
#
#   ./scripts/fetch_paper.sh 2604.22925
#   ./scripts/fetch_paper.sh https://arxiv.org/abs/2604.22925
#
# Downloads the PDF and (when available) the HTML into docs/research/papers/.
# Writing the catalog entry is a human job — see docs/research/CATALOG.md.

set -euo pipefail

if [ $# -ne 1 ]; then
    echo "usage: $0 <arxiv-id-or-url>" >&2
    exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
store="$repo_root/docs/research/papers"
catalog="$repo_root/docs/research/CATALOG.md"

# Accept a bare ID, or any arxiv.org URL form (abs/pdf/html, with or without version).
id="$1"
id="${id##*arxiv.org/}"
id="${id#abs/}"; id="${id#pdf/}"; id="${id#html/}"
id="${id%.pdf}"

if ! [[ "$id" =~ ^[0-9]{4}\.[0-9]{4,5}(v[0-9]+)?$ ]]; then
    echo "error: '$1' does not look like an arXiv ID (expected e.g. 2604.22925)" >&2
    exit 2
fi

mkdir -p "$store"

if grep -q "$id" "$catalog" 2>/dev/null; then
    echo "note: $id already appears in the catalog — re-fetching source anyway"
fi

fetch() {
    # fetch <url> <destination> <required|optional>
    local url="$1" dest="$2" mode="$3"
    if curl -sfL --max-time 120 -o "$dest" "$url"; then
        echo "  $(basename "$dest")  $(wc -c <"$dest" | tr -d ' ') bytes"
    else
        rm -f "$dest"
        if [ "$mode" = required ]; then
            echo "error: could not fetch $url" >&2
            exit 1
        fi
        echo "  (no HTML rendering available for $id — PDF only)"
    fi
}

echo "fetching $id into docs/research/papers/"
fetch "https://arxiv.org/pdf/$id"  "$store/$id.pdf"  required
fetch "https://arxiv.org/html/$id" "$store/$id.html" optional

if ! head -c 5 "$store/$id.pdf" | grep -q '%PDF'; then
    echo "error: $store/$id.pdf is not a PDF — arXiv may have returned an error page" >&2
    exit 1
fi

cat <<EOF

Downloaded. Next:
  1. Read it.
  2. Add an entry to docs/research/CATALOG.md (template at the bottom of that file)
     and a row to the index table. One catalog — do not start a second index.
EOF
