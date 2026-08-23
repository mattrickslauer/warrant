import "server-only";

// What is on the shelf, for the two agents that are asked about it.
//
// `instructor.py` renders a block headed "What is on the shelf right now" and `foreman.py` one
// headed "Stock and orders". Both were rendered from `case.get("stock")`, and nothing in
// production ever set it — so the Instructor was recommending what a technician should do next
// with no idea whether the part existed, and the Foreman was choosing between CHASE and REORDER
// without being able to look. Those are the two decisions stock actually bears on, and they are
// exactly the two that were being made blind.
//
// This is the read path only. Nothing here consumes stock or decrements a count: a shelf that
// goes down when a job seals is a product feature, and this is the fact the agents were already
// being asked for and not given.
//
// Client-writable on purpose, unlike `readings` or `decisions`. A shop's own count of its own
// shelf is a claim by the shop about the shop, and there is no independent thing for the server
// to check it against — so it is `asserted`, it is theirs to maintain, and no agent treats it
// as more than that.

import { adminDb } from "@/auth/admin";

export interface StockLine {
  part_number: string;
  description: string | null;
  on_hand: number;
  /** Below this the shop considers itself short. Absent means they have not set one. */
  floor: number | null;
  on_order: number;
  expected_at: string | null;
}

/**
 * A tenant's shelf, capped.
 *
 * Thirty because a working shop holds tens of line items and a prompt is not a database — and
 * because an agent handed four hundred rows will reason about the list rather than the job.
 * Ordered so the short lines come first: those are the ones a blocker is ever about.
 */
export async function stockFor(
  tenantId: string,
  db: FirebaseFirestore.Firestore = adminDb(),
  limit = 30,
): Promise<StockLine[] | null> {
  const snap = await db.collection(`tenants/${tenantId}/parts`).limit(200).get();
  if (snap.empty) {
    // NULL, not an empty array, and the distinction is load-bearing. Both agents branch on
    // `is not None`, so an empty list would print a heading with nothing under it — an
    // invitation to conclude the shelf is bare. A shop that keeps no inventory has not told
    // us the shelf is empty; it has told us nothing.
    return null;
  }

  const lines: StockLine[] = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      part_number: String(d.part_number ?? doc.id),
      description: d.description ?? null,
      on_hand: Number(d.on_hand ?? 0),
      floor: typeof d.floor === "number" ? d.floor : null,
      on_order: Number(d.on_order ?? 0),
      expected_at: d.expected_at ?? null,
    };
  });

  const short = (l: StockLine) => l.on_hand <= (l.floor ?? 0);
  lines.sort((a, b) => {
    if (short(a) !== short(b)) return short(a) ? -1 : 1;
    return a.part_number.localeCompare(b.part_number);
  });
  return lines.slice(0, limit);
}
