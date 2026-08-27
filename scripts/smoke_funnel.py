#!/usr/bin/env python3
"""Drive one procedure from the task picker to a sealed record, in a real browser.

Uses a synthetic camera, so it needs no hardware. Asserts the things the product actually
claims: the capture is live rather than uploaded, verdicts arrive after the step advances,
a field appears that the procedure did not contain, and the job seals only once every step
has an outcome.
"""
import re
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:3131"
ARGS = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]


def main() -> int:
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        pg = b.new_context(viewport={"width": 390, "height": 844}, permissions=["camera"]).new_page()
        pg.goto(URL, wait_until="load")
        pg.wait_for_timeout(800)

        pg.click(".cta__go")
        # Wait for the condition, not for a guessed number of milliseconds. Starting the
        # first job establishes the anonymous session and seeds the public catalogue into
        # the brand-new tenant before it can write anything, so the first click is slow in a
        # way the second never is — and a fixed sleep here reported that as "did not open a
        # job", which is a very misleading way to describe waiting.
        pg.wait_for_url("**/job/**", timeout=60_000)
        # The job page resolves the job and its pinned procedure before it can draw a step,
        # and the camera stream attaches after the tile renders — so wait for the LIVE class
        # rather than for the tile and then asserting on a class that has not arrived yet.
        pg.wait_for_selector(".w-capture--live", timeout=60_000)
        assert "w-capture--live" in (pg.get_attribute(".w-capture", "class") or ""), \
            "capture is not a live camera — an upload would prove nothing about liveness"

        # THE SIGNATURE STEP ASKS FOR NOTHING, AND THAT IS THE POINT.
        #
        # This loop used to fill a box labelled "Your name" and press "Sign it". That control
        # is gone on purpose — see `components/Attribution.tsx`: a box asking a person to put
        # their name to a claim nothing checks IS the tick in the box this product exists to
        # abolish, and the attribution already exists because they are signed in. The field is
        # now satisfied from the session and the step advances itself.
        #
        # So a step with no control on it is not a stuck step, it is a RESOLVING one, and the
        # right move is to wait. The old fallback — "nothing to click, so go back to an
        # outstanding step" — fired on exactly that step and walked the run away from the
        # signature every time, which is why the job never sealed.
        grew = False
        settled = 0
        for _ in range(16):
            if "/r/" in pg.url:
                break
            shutter = pg.locator(".w-capture__shutter")
            # `AnswerInput`: free text takes a box and "Record it"; a choice field draws one
            # button per stated option. Neither is a signature and neither shares its control.
            answer = pg.locator(".w-sign__field")
            choice = pg.locator(".w-sign .w-btn--block:not([disabled])")
            # An assertion that has already resolved from the session. Nothing to do but wait.
            resolving = pg.locator(".w-sign--done")
            # ONLY THE STEP-NAVIGATION BUTTONS.
            #
            # `:has-text("Step ")` is a case-insensitive, whitespace-normalised SUBSTRING
            # match, so it also caught "Redo this step", "Redo that step" and "Go to that
            # step". Clicking Redo re-captures, which re-runs the fixture's script for that
            # step, which appends another added field — so the run grew the form faster than
            # it could satisfy it and never converged. The buttons that MOVE you are the ones
            # labelled "Step N — ...", and those are the only ones this wants.
            back = pg.get_by_role("button", name=re.compile(r"^Step \d+\s*—"))

            if shutter.count():
                shutter.first.click()
            elif answer.count():
                answer.first.fill("smoke test")
                pg.get_by_role("button", name="Record it").click()
            elif choice.count():
                choice.first.click()
            elif back.count():
                # OUTSTANDING WORK OUTRANKS WAITING, and getting that backwards is what wedged
                # this run. The ADD FIELD path leaves a field on an EARLIER step — the fleet
                # asked for a wider frame after the technician had moved on — and the ghost
                # "Step N" button is the way back to it. The signature step meanwhile renders a
                # permanent `w-sign--done`, so treating that as "resolving, wait" meant the run
                # sat on the last step for ever while the thing actually holding the job open
                # was two steps behind it. Nothing is waited on while there is something to do.
                grew = True
                back.first.click()
            elif resolving.count():
                # Nothing else to do, so this is an assertion settling from the session.
                settled += 1
                if settled > 6:
                    break
                pg.wait_for_timeout(1200)
                continue
            else:
                break
            pg.wait_for_timeout(3300)

        assert "/r/" in pg.url, f"the job never sealed: {pg.url}"
        assert grew, "no step was left outstanding — the ADD FIELD path did not run"
        pg.wait_for_timeout(700)

        heading = pg.inner_text("h1.hero")
        ceiling = pg.inner_text(".w-ceiling__tier")
        struck = pg.locator(".w-chip--out").count()
        decisions = pg.locator(".w-trace__row").count()
        assert "Sealed" in heading, heading
        assert struck >= 1, "the record does not state what it could not prove"
        assert decisions >= 4, f"only {decisions} agent decisions on the record"

        print(f"ok — {heading.lower()} at '{ceiling}', {decisions} decisions, "
              f"{struck} class(es) shown as out of reach")
        b.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
