"""What the corpus needs photographed, and why each shot exists.

These are **photographs, not renders.** An agent that verifies real-world evidence has to be
tested on real-world evidence: generated imagery is uniformly lit, uniformly sharp, and wrong
in none of the ways a workshop phone is wrong. More pointedly, a generated instrument display
is a fabricated reading, and this is a product whose entire claim is that records are evidence.

`evals/media/SHOTS.md` is the same list written for someone holding a phone in a workshop.
"""
from __future__ import annotations

from pathlib import Path

MEDIA = Path(__file__).resolve().parent / "media"

#: path -> (what to photograph, which scenario needs it)
MANIFEST: dict[str, tuple[str, str]] = {
    # --- the torque wrench. There is no display, and that is the point. -------------
    #
    # The wrench in this workshop is a mechanical click type: you SET a bound on the barrel
    # and pull until it clicks. It never reports what the bolt received. So a photograph of
    # it evidences the tool's CONFIGURATION, not a measurement, and the corpus is built to
    # test that the Inspector refuses to launder the one into the other.
    #
    # The only `measured` torque-like value in this system comes off a paired instrument
    # over BLE — see firmware/README.md. That scenario needs no photograph at all.
    "torque/wrench-setting-in-spec.jpg": (
        "The barrel of the click wrench set to the middle of the accepted band, square on, "
        "the number and the scale it sits on both legible. This is a SETTING, not a reading.",
        "inspector/wrench-setting-photo-passes, wrench-setting-is-not-a-reading"),
    "torque/wrench-setting-over-spec.jpg": (
        "The same barrel wound well above the upper bound. Back it off afterwards — a click "
        "wrench left wound up loses its calibration, and the photograph is of the barrel.",
        "inspector/wrench-set-over-spec-refused"),
    "torque/wrench-setting-wrong-scale.jpg": (
        "The barrel set on the wrench's SECONDARY scale — lb-ft or kgf-m, whichever yours "
        "carries — to a number that looks in-spec if you do not notice which scale it is. "
        "This is the trap, and it is the same trap a dual-scale wrench sets for a tired "
        "technician at the end of a shift.",
        "inspector/wrench-wrong-scale-refused"),
    "torque/wrench-on-fastener.jpg": (
        "The wrench engaged on a caliper bolt, wide enough to show it is the right fastener. "
        "Evidence that the tool was applied; still not evidence of what the bolt received.",
        "inspector/wrench-setting-photo-passes"),
    "torque/photo-of-a-screen.jpg": (
        "Photograph a monitor or second phone that is displaying one of the shots above. "
        "Staged fraud, deliberately: bezel, moire and room reflection all visible.",
        "inspector/photo-of-a-screen-refused"),

    # --- brake evidence -------------------------------------------------------------
    "brake/pads-seated-sharp.jpg": (
        "New pads seated in the front caliper before the wheel goes back on. Close, sharp, "
        "both pad faces visible.",
        "inspector/pads-seated-clean-passes"),
    "brake/pads-seated-blurred.jpg": (
        "The same shot taken while your hand is still moving. Genuinely out of focus — do "
        "not blur a sharp one afterwards, the artefacts are different.",
        "inspector/blurred-photo-asks-for-a-specific-retake"),
    "brake/pads-worn-to-backing.jpg": (
        "A set of scrap pads worn to or near the backing plate, in a caliper if possible.",
        "inspector/worn-to-backing-plate-fails-the-wear-check"),
    "brake/caliper-rear-not-front.jpg": (
        "The REAR caliper, sharp and well lit, with the swingarm or chain in frame so it is "
        "unmistakably the rear.",
        "inspector/wrong-component-photographed"),
    "brake/disc-contaminated-fluid.jpg": (
        "A wet run of fluid down a disc face. A scrap disc and a squirt of brake fluid or "
        "degreaser on the bench is fine — this is a condition, not a reading.",
        "inspector/contaminated-disc-is-a-disqualifier"),

    # --- part labels ----------------------------------------------------------------
    "label/part-number-legible.jpg": (
        "The printed part code on a pad box, readable in the photograph.",
        "inspector/label-lost-to-glare-is-recoverable (the control)"),
    "label/part-number-glare.jpg": (
        "The same label with the overhead light reflecting straight off it. Label obviously "
        "present, code unreadable.",
        "inspector/label-lost-to-glare-is-recoverable, add-field-budget-exhausted"),

    # --- tyre tread -----------------------------------------------------------------
    "tyre/tread-coin-deep.jpg": (
        "A coin stood upright in the main groove of a good tyre, most of its edge swallowed.",
        "inspector/tread-depth-passes"),
    "tyre/tread-coin-shallow.jpg": (
        "The same, on a worn tyre — the coin stands proud and the surrounding rubber is smooth.",
        "inspector/tread-worn-refused"),

    # --- the Skeptic's identity problem ---------------------------------------------
    "asset/bike-a-fork.jpg": (
        "The left fork lower and yoke of one bike, framed on whatever actually marks it out "
        "— a scuff, a chip, a sticker, a cable tie.",
        "skeptic/same-asset-belongs, reused-capture"),
    "asset/bike-a-fork-later.jpg": (
        "The SAME fork on the same bike, later in the day or the next day: different angle, "
        "different light, a bit more grime. The identity must still be establishable.",
        "skeptic/same-asset-belongs, capture-predates-the-job"),
    "asset/bike-b-fork.jpg": (
        "The same part of a DIFFERENT bike of the same model and colour, framed identically, "
        "without bike A's marks. The hardest case in the corpus.",
        "skeptic/different-machine-same-model-dissents"),
    "scene/workshop-interior.jpg": (
        "A bike on a stand in the workshop, wide enough to place the scene — bench, tools, "
        "floor.",
        "skeptic/scene-contradicts-the-stated-location, ambiguous-evidence"),
    "scene/outdoors-away-from-workshop.jpg": (
        "A bike outdoors somewhere that is obviously not the workshop — roadside, gravel, "
        "weather, no building.",
        "skeptic/scene-contradicts-the-stated-location"),
}

#: Already in the repo. The editorial caliper still-life was generated for the landing page,
#: and that is exactly why it earns its place here: a lifted stock image is what it looks
#: like. It is the thing being rejected, never evidence being judged.
SUPPLIED = {
    "brake/caliper-editorial-stockish.webp":
        "generated for the landing page; stands in for a stock photograph passed off as evidence",
}


def status() -> tuple[list[str], list[str]]:
    present = [k for k in MANIFEST if (MEDIA / k).exists()]
    missing = [k for k in MANIFEST if not (MEDIA / k).exists()]
    return present, missing
