#!/usr/bin/env python3
"""The paper-form fixture, written as a PDF.

    python3 agents/evals/gen_form.py

Every other file under `evals/media/` is a photograph and has to be — see `evals/manifest.py`. This one
is generated, and the distinction is not a loophole. Those images are EVIDENCE: an agent that
judges a workshop photograph must be tested on workshop photographs, and a generated
instrument display would be a fabricated reading in a corpus whose whole claim is that records
are evidence.

A shop's daily check sheet is not evidence. It is a document somebody typed, printed and
photocopied, and a document somebody typed is exactly what this is. Nothing in it is measured,
nothing in it is claimed to have happened, and no record will ever point at it. What it has to
be is *ambiguous in the way real forms are ambiguous* — a tick box that never states its own
acceptance rule, a column headed with a unit and no bound — because that ambiguity is the
thing the Scoper is being tested on refusing to inherit.

Stdlib only, and deliberately: `model.py` keeps the property that a judge can clone this repo
and replay the entire recorded suite without installing anything. A fixture generator that
needed reportlab would spend that for a page of text.
"""
from __future__ import annotations

from pathlib import Path

OUT = Path(__file__).resolve().parent / "media" / "form" / "hire-check-sheet.pdf"

#: The sheet, as photocopied. Ruled lines are drawn; everything else is set in Helvetica.
LINES = [
    (72, 760, 16, "DAILY HIRE CHECK"),
    (72, 738, 10, "Cycle Hire - workshop copy - keep 90 days"),
    (72, 706, 11, "Bike no. ______________     Date ______________     Checked by ______________"),
    (72, 668, 11, "BRAKES"),
    (86, 648, 10, "[ ]  Front brake OK"),
    (86, 630, 10, "[ ]  Rear brake OK"),
    (86, 612, 10, "[ ]  Pads ______ mm"),
    (72, 578, 11, "WHEELS AND TYRES"),
    (86, 558, 10, "[ ]  Wheels secure"),
    (86, 540, 10, "[ ]  Tyres OK          front PSI ______     rear PSI ______"),
    (86, 522, 10, "[ ]  Spokes / rim true"),
    (72, 488, 11, "DRIVE"),
    (86, 468, 10, "[ ]  Chain lubed"),
    (86, 450, 10, "[ ]  Chain wear ______ mm"),
    (72, 416, 11, "E-BIKES ONLY"),
    (86, 396, 10, "[ ]  Battery charged ______ %"),
    (86, 378, 10, "[ ]  Motor cuts out on brake"),
    (72, 344, 11, "FAULTS FOUND / ACTION TAKEN"),
    (72, 300, 10, "_______________________________________________________________"),
    (72, 282, 10, "_______________________________________________________________"),
    (72, 236, 10, "Signed ____________________________   Time out ______________"),
    (72, 200, 8, "If in doubt DO NOT HIRE OUT - see the manager"),
]

#: Where a photocopied form gets its ruled lines. (x1, y1, x2, y2)
RULES = [(72, 726, 523, 726), (72, 686, 523, 686), (72, 264, 523, 264)]


def escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def content() -> bytes:
    out = ["0.5 w"]
    out += [f"{x1} {y1} m {x2} {y2} l S" for x1, y1, x2, y2 in RULES]
    for x, y, size, text in LINES:
        out.append(f"BT /F1 {size} Tf {x} {y} Td ({escape(text)}) Tj ET")
    return "\n".join(out).encode("latin-1")


def pdf() -> bytes:
    """A four-object PDF, assembled by hand.

    The xref table needs the byte offset of every object, so the objects are serialised first
    and the table is built from where they actually landed. Guessing those offsets is how a
    hand-written PDF opens in one reader and not in another."""
    stream = content()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]

    body, offsets = b"%PDF-1.4\n", []
    for n, obj in enumerate(objects, start=1):
        offsets.append(len(body))
        body += f"{n} 0 obj\n".encode() + obj + b"\nendobj\n"

    start = len(body)
    xref = f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    xref += b"".join(f"{off:010d} 00000 n \n".encode() for off in offsets)
    trailer = (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
               f"startxref\n{start}\n%%EOF\n").encode()
    return body + xref + trailer


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(pdf())
    print(f"{OUT.relative_to(Path(__file__).resolve().parents[2])} — {OUT.stat().st_size} bytes")
