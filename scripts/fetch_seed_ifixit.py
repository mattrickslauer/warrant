#!/usr/bin/env python3
"""Download the iFixit category taxonomy -- and only the taxonomy -- into
seed/ifixit/.

    python3 scripts/fetch_seed_ifixit.py

iFixit content is licensed CC BY-NC-SA 3.0. The NonCommercial clause is not
comfortably satisfied by a submission competing for a cash prize, so this
script deliberately fetches **no guide content, no step text and no images**.
It takes the category tree only: a nested map of device names.

That is enough for the purpose iFixit serves here, which is not to seed the
catalogue but to demonstrate the promotion flow refusing a document whose
licence forbids it -- see docs/data-model.md section 8. A licence gate you can
watch reject something is worth more than the content would have been.

Writes:
    seed/ifixit/categories.json   the device tree, names only
    seed/ifixit/LICENSE.txt       the terms, kept next to the data
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

URL = "https://www.ifixit.com/api/2.0/categories"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "seed", "ifixit")
UA = "warrant-seed/1.0 (hackathon research; contact via repo)"

TERMS = """iFixit category taxonomy
Source:  https://www.ifixit.com/api/2.0/categories
Licence: Creative Commons BY-NC-SA 3.0
         https://www.ifixit.com/Info/Licensing

NonCommercial. This directory holds the category tree only -- device names and
their nesting. No guide text, no step content, no images were downloaded.

Warrant does not ingest this into the specification catalogue. It is retained
as the worked example of a source the promotion flow refuses on licence
grounds. See docs/data-model.md section 8.
"""


def count_nodes(tree):
    return sum(1 + count_nodes(v) for v in (tree or {}).values() if isinstance(v, dict))


def main():
    os.makedirs(OUT, exist_ok=True)
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                tree = json.load(r)
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == 3:
                print(f"failed: {e}", file=sys.stderr)
                return 1
            time.sleep(2 * (attempt + 1))

    with open(os.path.join(OUT, "categories.json"), "w") as f:
        json.dump(tree, f, indent=1, sort_keys=True)
    with open(os.path.join(OUT, "LICENSE.txt"), "w") as f:
        f.write(TERMS)

    print(f"{len(tree)} top-level categories, {count_nodes(tree)} nodes")
    print("done: seed/ifixit/ (taxonomy only -- no guide content, by licence)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
