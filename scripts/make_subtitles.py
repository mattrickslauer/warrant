#!/usr/bin/env python3
"""Build an SRT caption track from Speech-to-Text word offsets.

The interview transcript in `demo-video/bank/03-john/` is written for a human editor and its
timestamps are approximate to a second or two — fine for finding a quote, useless for
subtitles, which are wrong at a quarter of a second. So captions are cut from word-level
offsets returned by Speech-to-Text rather than from the transcript.

    python3 scripts/make_subtitles.py stt_result.json out.srt [--offset SECONDS]

`--offset` shifts every cue later, for when something is prepended to the cut — an intro
recorded separately, say. Without it the captions assume the podcast starts at its first word.
"""
import json, re, sys

# Two lines of about forty characters is the subtitle convention, and roughly seventeen
# characters a second is the fastest an audience reads comfortably.
MAX_CHARS = 84
MAX_LINE = 42
MAX_SECS = 6.0
MIN_SECS = 1.0

# WHY THESE TWO ARE SET SO LOOSE. Both of the obvious cue boundaries lie to you here.
#
# The word offsets are padded: on this recording Speech-to-Text reports 1.7 s between "thank
# you for" and "hopping on this meeting today", which is one continuous breath. Splitting on
# a gap of about a second therefore cuts phrases in half, so the threshold is set past any
# pause that is an artefact rather than a real one.
#
# Auto-punctuation over-inserts full stops — it ended a sentence at "To talk about." — so a
# sentence end only closes a cue once the cue is already substantial. Otherwise every spurious
# period becomes its own two-word flash on screen.
GAP_SPLIT = 2.5
SOFT_FLUSH = 55

# Domain vocabulary the recogniser mishears even with phrase hints. Applied to assembled cue
# text, so a fix may change its length slightly — that is fine, wrapping happens afterwards.
CORRECTIONS = [
    (r"\bCasey[-\s]?135\b", "KC-135"),
    (r"\bKC[-\s]?135's\b", "KC-135s"),
    (r"\bJP[-\s]?8\b", "JP-8"),
    (r"\bAS VAB\b", "ASVAB"),
    (r"\bpencil[-\s]whipping\b", "pencil whipping"),
    # The intro is scripted, so its wording is known exactly and its errors are worth
    # correcting by name rather than hoping a phrase hint catches them.
    (r"\ball things,?\s*agentic hackathon\b", "All Things Agentic Hackathon"),
    (r"\bair,\s*force\b", "Air Force"),
    (r"\bcalled warrant\b", "called Warrant"),
    (r"\bcounty electrical\b", "county electrical"),
]


# Terms the recogniser splits into two words. These MUST be repaired on the word stream
# before cues are grouped: once "Casey" ends one cue and "135" opens the next, no amount of
# per-cue substitution can see the pair. Timing of the merged word spans both originals.
WORD_FIXES = [
    (("casey", "135"), "KC-135"),
    (("casey", "137"), "KC-137"),
    (("case", "c-135"), "KC-135"),
    (("case", "c135"), "KC-135"),
    # "could you go ahead" is heard as "because you go ahead" — the pair only ever
    # occurs here as an error, so it is safe to repair by name.
    (("because", "you", "go", "ahead"), "could you go ahead"),
    (("as", "vab"), "ASVAB"),
    (("jp", "8"), "JP-8"),
]


def merge_terms(ws: list[dict]) -> list[dict]:
    out, i = [], 0
    while i < len(ws):
        hit = None
        for seq, repl in WORD_FIXES:
            n = len(seq)
            if i + n > len(ws):
                continue
            got = [re.sub(r"[^\w'-]", "", ws[i + k]["w"]).lower() for k in range(n)]
            if got == list(seq):
                hit = (n, repl)
                break
        if hit:
            n, repl = hit
            # Keep whatever punctuation trailed the last word of the run.
            tail = re.sub(r"[\w'-]", "", ws[i + n - 1]["w"])
            out.append({"w": repl + tail, "s": ws[i]["s"], "e": ws[i + n - 1]["e"]})
            i += n
        else:
            out.append(ws[i])
            i += 1
    return out


def secs(v: str) -> float:
    """Speech-to-Text returns '12.300s'. Sometimes it returns nothing at all for a word."""
    return float(str(v).rstrip("s")) if v else 0.0


def words(payload: dict) -> list[dict]:
    out = []
    for result in payload.get("response", {}).get("results", []):
        alts = result.get("alternatives") or []
        if not alts:
            continue
        for w in alts[0].get("words", []) or []:
            out.append({"w": w.get("word", ""),
                        "s": secs(w.get("startTime")),
                        "e": secs(w.get("endTime"))})
    return out


def fix(text: str) -> str:
    for pattern, repl in CORRECTIONS:
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
    return text


def wrap(text: str) -> str:
    if len(text) <= MAX_LINE:
        return text
    # Break as near the middle as a word boundary allows, so neither line is a stub.
    mid, best, bestd = len(text) // 2, None, 1e9
    for i, ch in enumerate(text):
        if ch == " " and abs(i - mid) < bestd:
            best, bestd = i, abs(i - mid)
    if best is None:
        return text
    return text[:best] + "\n" + text[best + 1:]


def cues(ws: list[dict]) -> list[tuple[float, float, str]]:
    out, buf = [], []

    def flush():
        if not buf:
            return
        text = fix(" ".join(x["w"] for x in buf).strip())
        if text:
            out.append((buf[0]["s"], buf[-1]["e"], text))
        buf.clear()

    for w in ws:
        if buf:
            run = " ".join(x["w"] for x in buf)
            gap = w["s"] - buf[-1]["e"]
            span = w["e"] - buf[0]["s"]
            ends_sentence = buf[-1]["w"].endswith((".", "?", "!"))
            if (gap >= GAP_SPLIT or len(run) + 1 + len(w["w"]) > MAX_CHARS
                    or span > MAX_SECS or (ends_sentence and len(run) >= SOFT_FLUSH)):
                flush()
        buf.append(w)
    flush()

    # A cue shorter than a second is a flash. Hold it, but never into the next cue.
    for i, (s, e, t) in enumerate(out):
        if e - s < MIN_SECS:
            limit = out[i + 1][0] if i + 1 < len(out) else e + MIN_SECS
            out[i] = (s, min(s + MIN_SECS, max(limit - 0.05, s + 0.3)), t)
    return out


def stamp(t: float) -> str:
    if t < 0:
        t = 0.0
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"



# Burning captions in means libass has to know what resolution the numbers are in. ffmpeg's
# own SRT-to-ASS conversion assumes a 288-line script and then scales to the real frame, so a
# font size chosen for 1080p comes out roughly 3.75x too big and lands across the speaker's
# face. Writing the ASS directly, with PlayRes pinned to the actual frame, makes the sizes mean
# what they say.
ASS_HEAD = """[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{size},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,{outline},{shadow},2,{ml},{mr},{mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def ass_stamp(t: float) -> str:
    if t < 0:
        t = 0.0
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    sec, cs = divmod(cs, 100)
    return f"{h:d}:{m:02d}:{sec:02d}.{cs:02d}"


def write_ass(path, cs, offset, w=1920, h=1080, font="Noto Sans", size=52,
              outline=3, shadow=1.5, ml=150, mr=150, mv=70):
    with open(path, "w", encoding="utf-8") as f:
        f.write(ASS_HEAD.format(w=w, h=h, font=font, size=size, outline=outline,
                                shadow=shadow, ml=ml, mr=mr, mv=mv))
        for s, e, t in cs:
            text = wrap(t).replace("\n", "\\N")
            f.write(f"Dialogue: 0,{ass_stamp(s + offset)},{ass_stamp(e + offset)},"
                    f"Default,,0,0,0,,{text}\n")


def main() -> int:
    argv = sys.argv[1:]
    args = [a for a in argv if not a.startswith("--")]
    offset = 0.0
    for i, a in enumerate(argv):
        if a.startswith("--offset"):
            offset = float(a.split("=", 1)[1]) if "=" in a else float(argv[i + 1])
            if "=" not in a and argv[i + 1] in args:
                args.remove(argv[i + 1])
    if len(args) < 2:
        print(__doc__)
        return 2
    ws = merge_terms(words(json.load(open(args[0]))))
    if not ws:
        print("no words in the result — did the operation actually finish?")
        return 1
    cs = cues(ws)
    if args[1].endswith(".ass"):
        write_ass(args[1], cs, offset)
    else:
        with open(args[1], "w", encoding="utf-8") as f:
            for i, (s, e, t) in enumerate(cs, 1):
                f.write(f"{i}\n{stamp(s + offset)} --> {stamp(e + offset)}\n{wrap(t)}\n\n")
    span = sum(e - s for s, e, _ in cs)
    chars = sum(len(t) for _, _, t in cs)
    print(f"{len(ws)} words -> {len(cs)} cues -> {args[1]}"
          + (f" (offset +{offset}s)" if offset else ""))
    print(f"mean cue {span / len(cs):.1f}s, {chars / len(cs):.0f} chars, "
          f"{chars / span:.1f} chars/sec on screen")
    print(f"last cue ends at {stamp(cs[-1][1] + offset)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
