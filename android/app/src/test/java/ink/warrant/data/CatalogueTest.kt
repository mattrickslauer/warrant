package ink.warrant.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What counts as your own work.
 *
 * The seed copies the bundled catalogue into every tenant, so after that copy the only thing
 * separating "the product wrote this" from "I wrote this" is the id. `Your procedures` reads
 * this rule, and when it was absent the screen told a shop it had authored three tasks it had
 * never seen before.
 */
class CatalogueTest {

    @Test
    fun `the bundled three are not yours`() {
        PUBLIC_CATALOGUE_IDS.forEach {
            assertTrue("$it is seeded into every tenant", isBundled(it))
        }
    }

    @Test
    fun `an authored procedure is yours`() {
        assertFalse(isBundled("proc_gearbox_oil_v1"))
        assertFalse(isBundled("proc_banana_v2"))
    }

    /**
     * A scoped id is `tenant/doc`, and the tenant half is exactly what differs between two
     * copies of the same bundled task — so it must not be part of the comparison.
     */
    @Test
    fun `a tenant-scoped id is judged on the document half`() {
        assertTrue(isBundled("acme.com/proc_front_brake_v3"))
        assertTrue(isBundled("u:abc123/proc_banana_v1"))
        assertFalse(isBundled("acme.com/proc_gearbox_oil_v1"))
    }
}
