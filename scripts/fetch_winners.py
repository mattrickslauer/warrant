#!/usr/bin/env python3
"""Download the previous Google Cloud ADK Hackathon winners for study.

    python3 scripts/fetch_winners.py

Saves raw HTML to docs/winners/raw/ and readable markdown to
docs/winners/projects/. Re-running overwrites; the raw copies are the record.

These are the eight winners of the Agent Development Kit Hackathon with Google
Cloud (476 submissions, 10,352 participants). That contest used different
judging weights than ours -- Technical Implementation 50 / Innovation 30 /
Demo & Documentation 20, against our 40 / 30 / 30 -- so read them for what the
judges rewarded in practice, not as a rubric.
"""

import os
import subprocess
import sys
import time

from bs4 import BeautifulSoup

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

WINNERS = [
    ("salesshortcut", "SalesShortcut",
     "A comprehensive AI-powered Sales Development Representative (SDR) system"),
    ("bleach-7tqdmo", "Bleach",
     "Visual AI agent builder for Google ADK"),
    ("particle-physics-agent", "Particle Physics Agent",
     "A physics AI agent that converts natural language into validated Feynman diagrams"),
    ("tradesage-ai", "TradeSage AI",
     "Intelligent multi-agent financial analysis platform built using ADK"),
    ("energy-agent-ai", "Energy Agent AI",
     "Multi-agent AI transforming energy customer management"),
    ("edu-ai-multi-agent-educational-system-for-brazil", "Edu.AI",
     "Democratizes Brazil's education with autonomous AI agents"),
    ("greenops-gzp4aj", "GreenOps",
     "Optimize Every Dollar, Reduce Every Emission"),
    ("teachai-upzofa", "Nexora-AI",
     "Next Gen Personalized Education with interactive lessons"),
]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "docs", "winners", "raw")
OUT = os.path.join(ROOT, "docs", "winners", "projects")


def fetch(url, dest):
    r = subprocess.run(["curl", "-sfL", "-A", UA, "--max-time", "60", "-o", dest, url])
    return r.returncode == 0


def to_markdown(html_path, url, name, tagline):
    soup = BeautifulSoup(open(html_path, encoding="utf-8"), "html.parser")
    main = (soup.select_one("#app-details-left")
            or soup.select_one("div.app-details")
            or soup.select_one("#software-content")
            or soup.body)
    for bad in main.select("script,style,nav,form,.share-buttons,#comments,.comment"):
        bad.decompose()

    md = subprocess.run(["html2text", "--ignore-images", "--body-width=0"],
                        input=str(main), capture_output=True, text=True).stdout

    out, blank = [], 0
    for line in md.split("\n"):
        line = line.rstrip()
        if not line:
            blank += 1
            if blank > 1:
                continue
        else:
            blank = 0
        out.append(line)

    header = (f"# {name}\n\n"
              f"> **{tagline}**\n>\n"
              f"> Winner, Agent Development Kit Hackathon with Google Cloud.\n"
              f"> Source: {url}\n"
              f"> Archived {time.strftime('%Y-%m-%d')}. Raw HTML: `../raw/{os.path.basename(html_path)}`\n\n"
              f"---\n\n")
    return header + "\n".join(out).strip() + "\n"


def main():
    for d in (RAW, OUT):
        os.makedirs(d, exist_ok=True)

    failures = []
    for slug, name, tagline in WINNERS:
        url = f"https://devpost.com/software/{slug}"
        raw_path = os.path.join(RAW, f"{slug}.html")
        if not fetch(url, raw_path):
            print(f"FAIL  {name} ({url})", file=sys.stderr)
            failures.append(name)
            continue
        md = to_markdown(raw_path, url, name, tagline)
        with open(os.path.join(OUT, f"{slug}.md"), "w", encoding="utf-8") as fh:
            fh.write(md)
        print(f"ok    {name:26} {len(md):>7} chars")

    if failures:
        print(f"\n{len(failures)} failed: {', '.join(failures)}", file=sys.stderr)
        return 1
    print(f"\n{len(WINNERS)} winners archived to docs/winners/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
