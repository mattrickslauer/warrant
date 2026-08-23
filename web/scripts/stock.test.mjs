// The shelf, as the two agents that ask about it actually see it.
//
// instructor.py renders "What is on the shelf right now" and foreman.py renders "Stock and
// orders", and until this existed nothing set either. The Instructor was recommending a next
// action without being able to tell "fit the new pad" from "there is no pad", and the Foreman
// was choosing between CHASE and REORDER without being able to look.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/stock.test.mjs
//
// Requires the Firestore emulator; scripts/smoke.sh starts it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCP_PROJECT = "warrant-rules-test";

const { stockFor } = await import("../src/server/stock.ts");
const { adminDb } = await import("../src/auth/admin.ts");

const db = adminDb();

async function seedParts(tenant, parts) {
  for (const p of parts) {
    await db.doc(`tenants/${tenant}/parts/${p.part_number}`).set(p);
  }
}

describe("stockFor", () => {
  test("a shop that keeps no inventory gets NULL, not an empty shelf", async () => {
    // The distinction is load-bearing. Both agents branch on presence, so an empty list would
    // print a heading with nothing under it — and "the shelf is bare" is a very different
    // thing to tell a Foreman than "we do not know what is on the shelf".
    assert.equal(await stockFor("nobody.example", db), null);
  });

  test("what is short comes first, because that is what a blocker is ever about", async () => {
    await seedParts("stock-a.example", [
      { part_number: "ZZZ-999", description: "Cable tie", on_hand: 500, floor: 50, on_order: 0 },
      { part_number: "45105-MEE-006", description: "Caliper bolt", on_hand: 0, floor: 2,
        on_order: 10, expected_at: "2026-08-28T00:00:00Z" },
      { part_number: "AAA-111", description: "Sump washer", on_hand: 40, floor: 10, on_order: 0 },
    ]);
    const shelf = await stockFor("stock-a.example", db);
    assert.equal(shelf[0].part_number, "45105-MEE-006");
    assert.equal(shelf[0].on_hand, 0);
    assert.equal(shelf[0].on_order, 10);
    assert.equal(shelf[0].expected_at, "2026-08-28T00:00:00Z");
  });

  test("a line at exactly its floor counts as short", async () => {
    await seedParts("stock-b.example", [
      { part_number: "BBB", on_hand: 2, floor: 2 },
      { part_number: "AAA", on_hand: 90, floor: 1 },
    ]);
    const shelf = await stockFor("stock-b.example", db);
    // BBB sorts first despite the alphabet, because it is on its floor.
    assert.equal(shelf[0].part_number, "BBB");
  });

  test("a part with no floor set is not treated as having a floor of nothing", async () => {
    // A shop that never set a floor has not said "zero is fine". on_hand 0 with no floor is
    // still short; on_hand 5 with no floor is not.
    await seedParts("stock-c.example", [
      { part_number: "HAVE", on_hand: 5 },
      { part_number: "NONE", on_hand: 0 },
    ]);
    const shelf = await stockFor("stock-c.example", db);
    assert.equal(shelf[0].part_number, "NONE");
  });

  test("missing counts read as zero rather than undefined", async () => {
    await seedParts("stock-d.example", [{ part_number: "SPARSE" }]);
    const [line] = await stockFor("stock-d.example", db);
    assert.equal(line.on_hand, 0);
    assert.equal(line.on_order, 0);
    assert.equal(line.description, null);
    assert.equal(line.floor, null);
  });

  test("the shelf is capped, because a prompt is not a database", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      part_number: `P${String(i).padStart(3, "0")}`, on_hand: 10, floor: 1,
    }));
    await seedParts("stock-e.example", many);
    const shelf = await stockFor("stock-e.example", db, 30);
    assert.equal(shelf.length, 30);
  });
});
