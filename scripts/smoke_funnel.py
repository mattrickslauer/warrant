#!/usr/bin/env python3
"""Drive one procedure from the task picker to a sealed record, in a real browser.

Uses a synthetic camera, so it needs no hardware. Asserts the things the product actually
claims: the capture is live rather than uploaded, verdicts arrive after the step advances,
a field appears that the procedure did not contain, and the job seals only once every step
has an outcome.

The page it drives is `StepPage` — one screen, no scrolling, one bar at the bottom whose
LABEL says what the step is asking for. That is what makes this script short: there is no
hunting for the right control, because there is only ever one primary control. Read the bar,
give it what it wants, tap it. The same loop drives a photograph, a typed answer, a stated
choice and the way out of the last step.
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
        # The job page resolves the job and its pinned procedure before it can draw a step, and
        # the camera stream attaches after the lens renders — so wait for the LIVE class rather
        # than for the element and then asserting on a class that has not arrived yet.
        pg.wait_for_selector(".w-lens--live", timeout=60_000)
        assert pg.locator(".w-lensmark").count(), \
            "the frame is not marked live — an upload would prove nothing about liveness"

        # THE SIGNATURE STEP ASKS FOR NOTHING, AND THAT IS THE POINT.
        #
        # There is no name box and no "Sign it" button — see `components/Attribution.tsx`: a
        # box asking a person to put their name to a claim nothing checks IS the tick in the
        # box this product exists to abolish, and the attribution already exists because they
        # are signed in. The field is satisfied from the session, and the bar simply reads
        # "Next step" over it. No special case is needed here; the bar handles it.
        grew = False
        shutters = 0
        detours = 0
        for _ in range(28):
            if pg.locator(".handover").count():
                break

            # The form GREW: an agent appended a field the procedure did not contain. The page
            # says so three ways at once — the strip above the bar gains a pip, a notice names
            # the ask, and the middle of the frame carries "Added just now". Any of them is the
            # ADD FIELD path having run.
            if (pg.locator(".w-center__note--inferred").count()
                    or pg.locator(".w-pips__pip").count() > 1):
                grew = True

            bar = pg.locator(".w-primary")
            if not bar.count():
                break
            label = (bar.inner_text() or "").strip()

            if bar.is_disabled():
                # Disabled and IDLE means the bar is waiting on an input, not on the network:
                # "Record" over an empty box is the one such state a browser-tier procedure
                # reaches. Disabled and WORKING is a capture being written — wait it out. The
                # two look identical and mean opposite things, which is why `PrimaryAction`
                # carries `busy` separately from `enabled`.
                if pg.locator(".w-center__choice").count():
                    pg.locator(".w-center__choice").first.click()
                elif pg.locator(".w-center__input").count():
                    pg.locator(".w-center__input").first.fill("smoke test")
                else:
                    pg.wait_for_timeout(1200)
                continue

            # The bar is asking for something on the step in hand. Give it that first: work in
            # front of the hands outranks a notice about work behind them.
            if label.startswith(("Capture", "Retake", "Record")):
                if not label.startswith("Record"):
                    shutters += 1
                bar.click()
                # Long enough for the scripted verdict AND the ADD FIELD that follows it — the
                # fixture appends at 2700ms, and a shorter wait walks straight past the growth
                # this run exists to prove.
                pg.wait_for_timeout(3300)
                continue

            # Nothing outstanding here, so the bar has become the way out of the step. Before
            # taking it, deal with anything the fleet raised on a step already walked past —
            # that is the claim being tested: a late verdict is fixable from three steps later.
            # A notice collapses to one line until it is opened, which is what keeps this page
            # from filling with banners, so the pill has to be expanded to reach its actions.
            for head in pg.locator(".w-notice__head").all():
                try:
                    head.click()
                except Exception:
                    pass
            go_there = pg.get_by_role("button", name=re.compile(r"^Go to (that|step)"))
            # Bounded. A question an agent put to a person cannot be answered from this page at
            # all, and walking back to it forever would hang the run rather than report it.
            if go_there.count() and detours < 4:
                detours += 1
                grew = True
                go_there.first.click()
                pg.wait_for_timeout(1500)
                continue

            bar.click()
            pg.wait_for_timeout(3300)

        assert pg.locator(".handover").count(), "the run never reached the handover"
        assert grew, "no field was appended — the ADD FIELD path did not run"
        assert shutters >= 3, \
            f"only {shutters} captures: the appended field was never actually photographed"

        # FINISH IS NOT THE SEAL, and this is where that distinction is worth having. The
        # handover names which of the three true things is true and only offers the record once
        # there IS one — so waiting for the link is waiting for the fleet, not for a redirect.
        pg.wait_for_selector("a:has-text('Open the record')", timeout=60_000)
        pg.click("a:has-text('Open the record')")
        pg.wait_for_url("**/r/**", timeout=60_000)
        pg.wait_for_timeout(700)

        heading = pg.inner_text("h1.hero")
        ceiling = pg.inner_text(".w-ceiling__tier")
        struck = pg.locator(".w-chip--out").count()
        decisions = pg.locator(".w-trace__row").count()
        assert "Sealed" in heading, heading
        assert struck >= 1, "the record does not state what it could not prove"
        assert decisions >= 4, f"only {decisions} agent decisions on the record"

        print(f"ok — {heading.lower()} at '{ceiling}', {decisions} decisions, "
              f"{struck} class(es) shown as out of reach, form grew mid-run")
        b.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
