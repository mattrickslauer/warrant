// The menu's rules, tested without rendering anything.
//
// These are the rules that decide what a stranger is allowed to do, so they are worth more than
// a visual check: a regression here does not look broken, it looks like a product that quietly
// demands an account for work that was supposed to need none.
//
// The Kotlin twin is android/…/ui/shell/MenuTest.kt, and the assertions are deliberately the
// same ones. Where the two surfaces legitimately differ — the web has a fleet page and the
// phone does not — the difference is pinned by a rule rather than by a hardcoded expectation:
// `soon` iff there is no page behind the route.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/nav.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEST, accountMenu, activeDest, enabled, menu, quickActions, reachNote,
} from "../src/app/shell/nav.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");

const itemFor = (signedIn, id) =>
  menu(signedIn).flatMap((s) => s.items).find((i) => i.dest.id === id);

/** Does the app router have a page behind this route? */
function hasPage(route) {
  if (route === "/") return existsSync(join(APP, "page.tsx"));
  return existsSync(join(APP, route.replace(/^\//, ""), "page.tsx"));
}

describe("the menu", () => {
  test("running work never asks for an account", () => {
    for (const id of ["procedures", "records", "instruments"]) {
      assert.equal(itemFor(false, id).reach, "open", `${id} must stay open to a stranger`);
    }
  });

  test("authoring asks for an account until there is one", () => {
    assert.equal(itemFor(false, "create").reach, "needs-account");
    assert.equal(itemFor(true, "create").reach, "open");
  });

  test("a gated row is still clickable — it leads to the gate", () => {
    assert.equal(enabled(itemFor(false, "create")), true);
  });

  test("the menu does not change shape when you sign in", () => {
    const out = menu(false);
    const inn = menu(true);
    assert.deepEqual(out.map((s) => s.title), inn.map((s) => s.title));
    assert.deepEqual(
      out.map((s) => s.items.map((i) => i.dest.id)),
      inn.map((s) => s.items.map((i) => i.dest.id)),
    );
  });

  test("account rows appear only once there is an account", () => {
    assert.deepEqual(accountMenu(false), []);
    assert.deepEqual(accountMenu(true).map((i) => i.dest.id), ["account", "settings"]);
  });

  test("every row that is not `soon` has a page behind it", () => {
    // The rule that makes the web's disagreement with android legitimate. Android marks the
    // fleet `soon` because the phone has no fleet screen; the web must not, because it does.
    for (const section of menu(true)) {
      for (const item of section.items) {
        if (item.reach === "soon") continue;
        assert.equal(hasPage(item.dest.route), true, `${item.dest.route} has no page.tsx`);
      }
    }
    for (const item of accountMenu(true)) {
      assert.equal(hasPage(item.dest.route), true, `${item.dest.route} has no page.tsx`);
    }
  });

  test("what is not built is inert rather than a dead end", () => {
    for (const section of menu(true)) {
      for (const item of section.items) {
        if (item.reach !== "soon") continue;
        assert.equal(enabled(item), false, "a row that goes nowhere must not be clickable");
        assert.equal(hasPage(item.dest.route), false, "a `soon` row must not have a page");
      }
    }
  });

  test("routes are unique", () => {
    const routes = Object.values(DEST).map((d) => d.route);
    assert.equal(routes.length, new Set(routes).size);
  });

  test("a row that cannot simply be opened says why", () => {
    assert.equal(reachNote("open"), null);
    assert.equal(reachNote("needs-account"), "sign in");
    assert.equal(reachNote("soon"), "soon");
  });
});

describe("the quick actions", () => {
  test("they agree with the menu about what needs an account", () => {
    for (const signedIn of [false, true]) {
      for (const action of quickActions(signedIn)) {
        const row = itemFor(signedIn, action.dest.id);
        // `account` is not a menu row; it is the drawer's CTA.
        if (!row) continue;
        assert.equal(
          action.reach, row.reach,
          `${action.dest.id} must be reachable the same way from both surfaces`,
        );
      }
    }
  });

  test("authoring is offered but priced when signed out", () => {
    const out = quickActions(false).find((a) => a.dest.id === "create");
    assert.equal(out.reach, "needs-account");
    assert.equal(enabled(out), true, "a gated action still leads to the gate");
    assert.equal(quickActions(true).find((a) => a.dest.id === "create").reach, "open");
  });

  test("signing out adds the invitation rather than removing the work", () => {
    const out = quickActions(false).map((a) => a.dest.id);
    const inn = quickActions(true).map((a) => a.dest.id);
    assert.deepEqual(out, [...inn, "account"], "no row may disappear when signed out");
    assert.equal(inn.includes("account"), false, "the sign-in row is pointless once signed in");
  });

  test("running work never asks for an account from the home screen either", () => {
    for (const id of ["records", "instruments"]) {
      assert.equal(quickActions(false).find((a) => a.dest.id === id).reach, "open");
    }
  });

  test("every quick action says something a menu row does not", () => {
    for (const action of quickActions(false)) {
      assert.notEqual(action.hint.trim(), "", `${action.dest.id} needs a hint`);
      assert.equal(
        action.label !== action.dest.label || action.dest.id === "create", true,
        `${action.dest.id} should name the deed, not the place`,
      );
    }
  });
});

describe("which row is lit", () => {
  test("the longest match wins, so a detail page lights its list", () => {
    assert.equal(activeDest("/"), "procedures");
    assert.equal(activeDest("/records"), "records");
    // `/` is a prefix of everything, so a naive match would light Procedures here.
    assert.equal(activeDest("/records/abc"), "records");
    assert.equal(activeDest("/model-tests/inspector/1"), "modelTests");
    assert.equal(activeDest("/account"), "account");
  });

  test("a page with no menu row lights nothing rather than the wrong thing", () => {
    assert.equal(activeDest("/job/xyz"), null);
    assert.equal(activeDest("/r/rec_1"), null);
  });
});
