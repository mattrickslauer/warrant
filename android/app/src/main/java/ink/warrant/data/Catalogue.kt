package ink.warrant.data

/**
 * The three tasks that are bundled into every tenant, and are nobody's own work.
 *
 * `/api/procedures/seed` copies these into whichever tenant is asking, so a stranger can run
 * one without an account. That copy is what makes them indistinguishable from authored
 * procedures once they are in Firestore: same collection, same shape, same tenant id. The
 * difference is not in the documents, it is in who put them there — and only this list
 * remembers that.
 *
 * So `Your procedures` subtracts this set. Without it the screen answers "what have I
 * written?" with three tasks the product wrote, which is how a shop that authored something
 * real concluded the authoring had failed.
 *
 * The TypeScript twin is `PUBLIC_CATALOGUE` in `web/src/data/catalogue.ts`, and the ids must
 * match it exactly — they are the document ids the seed route writes, not names either
 * surface chose. A procedure that is bundled on one surface and personal on the other would
 * be worse than either answer alone.
 */
val PUBLIC_CATALOGUE_IDS: Set<String> = setOf(
    "proc_banana_v1",
    "proc_pickup_v1",
    "proc_front_brake_v3",
)

/**
 * Whether this document is one of the bundled three rather than something this tenant made.
 *
 * Compares on the bare document id, because a scoped id is `tenant/doc` and the tenant half is
 * exactly the part that differs between two copies of the same bundled task.
 */
fun isBundled(procedureId: String): Boolean =
    procedureId.substringAfterLast('/') in PUBLIC_CATALOGUE_IDS
