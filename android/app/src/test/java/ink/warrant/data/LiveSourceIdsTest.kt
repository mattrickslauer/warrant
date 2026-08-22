package ink.warrant.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The two id rules LiveSource depends on, which are easy to get subtly wrong and impossible
 * to notice when you do.
 *
 * A job id carries its tenant — `acme.com/job_9` — so that no screen has to hold a tenant and
 * no call can accidentally read across one. If [LiveSource.split] silently accepted a bare id
 * the app would read `tenants//jobs/job_9`, which is not an error in Firestore: it is a path
 * to a different place that happens to be empty.
 */
class LiveSourceIdsTest {

    @Test
    fun `a scoped job id splits into tenant and job`() {
        val (tenant, job) = LiveSource.split("acme.com/job_9")
        assertEquals("acme.com", tenant)
        assertEquals("job_9", job)
    }

    @Test
    fun `a personal tenant scopes exactly the same way`() {
        val (tenant, job) = LiveSource.split("u:abc123/job_9")
        assertEquals("u:abc123", tenant)
        assertEquals("job_9", job)
    }

    @Test
    fun `an unscoped id is refused rather than read from nowhere`() {
        assertThrows(IllegalArgumentException::class.java) { LiveSource.split("job_9") }
    }

    @Test
    fun `a leading slash is refused — the tenant would be empty`() {
        assertThrows(IllegalArgumentException::class.java) { LiveSource.split("/job_9") }
    }

    @Test
    fun `a field id is derived from the step and the key`() {
        // Derived rather than random, so re-capturing REPLACES the current answer instead of
        // appending. Every attempt still exists in `captures`, which storage.rules makes
        // append-only; this collection holds the current answer, and history lives where
        // history belongs.
        assertEquals("s3__pad_photo", LiveSource.fieldId("s3", "pad_photo"))
    }

    @Test
    fun `a field id round-trips the way the sweep parses it`() {
        // web/src/server/tasks.ts splits on the FIRST `__` to recover the step and the field.
        // A key containing an underscore must survive that, or the sweep re-adjudicates a
        // capture against a field that does not exist.
        val id = LiveSource.fieldId("s3", "pad_photo_left")
        val split = id.indexOf("__")
        assertEquals("s3", id.substring(0, split))
        assertEquals("pad_photo_left", id.substring(split + 2))
    }
}
