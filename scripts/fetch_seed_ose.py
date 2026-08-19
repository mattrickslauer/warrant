#!/usr/bin/env python3
"""Download the Open Source Ecology machine catalogue into seed/ose/.

    python3 scripts/fetch_seed_ose.py

Open Source Ecology publishes the Global Village Construction Set -- 50 open
industrial machines -- under CC BY-SA 4.0, with no NonCommercial clause. It
documents on Dozuki, which exposes the same read API as iFixit.

Two things make it the primary seed for type space:

  1. Its hierarchy is already ISO 14224 levels 6-8. A machine contains modules
     and a module contains components: "CEB Press" -> "CEB Press - Modules" ->
     "Frame", "Hopper", "Controller".
  2. Its guides are already step-structured, with tools, parts and per-step
     time, so they import into a Warrant procedure close to one-for-one.

Writes:
    seed/ose/categories.json     the machine -> module -> component tree
    seed/ose/guides_index.json   every guide, summary form
    seed/ose/guides/{id}.json    each guide in full, with steps
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://opensourceecology.dozuki.com/api/2.0"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "seed", "ose")
UA = "warrant-seed/1.0 (hackathon research; contact via repo)"
PAUSE = 0.25


def get(path):
    req = urllib.request.Request(f"{API}/{path}", headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == 3:
                raise
            print(f"    retry {attempt + 1} after {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def write(rel, obj):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=1, sort_keys=True)
    return path


def count_nodes(tree):
    return sum(1 + count_nodes(v) for v in (tree or {}).values() if isinstance(v, dict))


def main():
    os.makedirs(OUT, exist_ok=True)

    print("categories ...")
    cats = get("categories")
    write("categories.json", cats)
    print(f"  {len(cats)} machines, {count_nodes(cats)} nodes total")

    print("guide index ...")
    index, offset = [], 0
    while True:
        page = get(f"guides?limit=200&offset={offset}")
        if not page:
            break
        index.extend(page)
        if len(page) < 200:
            break
        offset += 200
        time.sleep(PAUSE)
    write("guides_index.json", index)
    print(f"  {len(index)} guides")

    print("guides ...")
    ok = 0
    for i, g in enumerate(index, 1):
        gid = g["guideid"]
        dest = os.path.join(OUT, "guides", f"{gid}.json")
        if os.path.exists(dest):
            ok += 1
            continue
        try:
            write(f"guides/{gid}.json", get(f"guides/{gid}"))
            ok += 1
        except Exception as e:  # a single dead guide must not lose the run
            print(f"  ! guide {gid}: {e}", file=sys.stderr)
        if i % 20 == 0:
            print(f"  {i}/{len(index)}")
        time.sleep(PAUSE)

    print(f"done: {ok}/{len(index)} guides in seed/ose/")


if __name__ == "__main__":
    main()
