package ink.warrant.data

import ink.warrant.contract.CaptureKind
import ink.warrant.contract.FieldKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The path is a contract with two things that cannot import it.
 *
 * `storage.rules` allows exactly `tenants/{t}/captures/{jobId}/{file}` and nothing else, and
 * `mediaUri` in `web/src/server/adjudicate/cases.ts` builds the same string on the other
 * surface. The adjudicator reads what this app wrote, so a disagreement here does not fail
 * loudly — it produces a 404 that reaches a technician as "your photograph was unusable".
 *
 * These are the cheapest possible guard against that: the spelling, written out by hand.
 */
class MediaTest {

    @Test
    fun `the object path is the one storage rules allows`() {
        assertEquals(
            "tenants/acme/captures/job_7/cap_3.jpg",
            Media.path("acme", "job_7", "cap_3", "jpg"),
        )
    }

    @Test
    fun `extensions agree with the web builder`() {
        assertEquals("jpg", Media.extension(CaptureKind.PHOTO))
        assertEquals("jpg", Media.extension(CaptureKind.SCAN))
        assertEquals("mp4", Media.extension(CaptureKind.VIDEO))
        assertEquals("m4a", Media.extension(CaptureKind.AUDIO))

        assertEquals("jpg", Media.extension(FieldKind.PHOTO))
        assertEquals("jpg", Media.extension(FieldKind.SCAN))
        assertEquals("mp4", Media.extension(FieldKind.VIDEO))
    }

    /**
     * Null, not a default extension. A kind with no object gets no path at all — the
     * alternative is a `.bin` under `captures/` that nothing ever wrote, which reads on a
     * record as evidence that failed to load rather than as evidence that never existed.
     */
    @Test
    fun `a kind with no object behind it has no extension`() {
        assertNull(Media.extension(CaptureKind.TEXT))

        assertNull(Media.extension(FieldKind.TEXT))
        assertNull(Media.extension(FieldKind.MEASUREMENT))
        assertNull(Media.extension(FieldKind.CHOICE))
        assertNull(Media.extension(FieldKind.SIGNATURE))
        assertNull(Media.extension(FieldKind.LOCATION))
    }

    /** Every kind the contract has is classified. A new one must not default into a path. */
    @Test
    fun `every kind is decided one way or the other`() {
        CaptureKind.entries.forEach { Media.extension(it) }
        FieldKind.entries.forEach { Media.extension(it) }
    }
}
