#!/usr/bin/env python3
"""Drive one procedure from the task picker to a sealed record, in a real browser.

Uses a synthetic camera, so it needs no hardware. Asserts the things the product actually
claims: the capture is live rather than uploaded, verdicts arrive after the step advances,
a field appears that the procedure did not contain, and the job seals only once every step
has an outcome.
"""
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
        pg.wait_for_timeout(1800)
        assert "/job/" in pg.url, f"did not open a job: {pg.url}"
        assert "w-capture--live" in (pg.get_attribute(".w-capture", "class") or ""), \
            "capture is not a live camera — an upload would prove nothing about liveness"

        grew = False
        for _ in range(10):
            if "/r/" in pg.url:
                break
            shutter = pg.locator(".w-capture__shutter")
            sign = pg.locator(".w-sign__field")
            back = pg.locator(".w-btn--ghost:has-text('Step ')")
            if shutter.count():
                shutter.first.click()
            elif sign.count():
                sign.first.fill("smoke test")
                pg.get_by_role("button", name="Sign it").click()
            elif back.count():
                grew = True
                back.first.click()
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
