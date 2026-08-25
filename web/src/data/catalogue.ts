// The three tasks that are bundled into every tenant, and are nobody's own work.
//
// `/api/procedures/seed` copies these into whichever tenant is asking, so that a stranger can
// run one without an account. That copy is what makes them indistinguishable from authored
// procedures once they are in Firestore: same collection, same shape, same tenant id. The
// difference is not in the documents, it is in who put them there — and only this list
// remembers that.
//
// So `Your procedures` subtracts this set. Without it the page answers "what have I written?"
// with three tasks the product wrote, which is how a shop that authored something real
// concluded the authoring had failed.
//
// The Kotlin twin is `PUBLIC_CATALOGUE_IDS` in android/…/data/Catalogue.kt. Two surfaces, one
// list, and a procedure that is bundled on one and personal on the other would be worse than
// either answer alone.

import { cutABanana, pickUpAnObject, frontBrakeService } from "@/data/fixtures/procedures";
import type { Procedure } from "@/generated/types";

/** The catalogue, by the document id the seed writes it to. Nothing else may be seeded. */
export const PUBLIC_CATALOGUE: Record<string, Procedure> = {
  proc_banana_v1: cutABanana,
  proc_pickup_v1: pickUpAnObject,
  proc_front_brake_v3: frontBrakeService,
};

export const PUBLIC_CATALOGUE_IDS: ReadonlySet<string> = new Set(Object.keys(PUBLIC_CATALOGUE));

/**
 * Whether this document is one of the bundled three rather than something this tenant made.
 *
 * Compares on the bare document id, because a scoped id is `tenant/doc` and the tenant half is
 * exactly the part that differs between two copies of the same bundled task.
 */
export function isBundled(procedureId: string): boolean {
  return PUBLIC_CATALOGUE_IDS.has(procedureId.split("/").pop() ?? procedureId);
}
