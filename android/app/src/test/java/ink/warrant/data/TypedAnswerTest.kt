package ink.warrant.data

import ink.warrant.contract.CaptureKind
import ink.warrant.contract.CaptureMode
import ink.warrant.contract.CaptureSurface
import ink.warrant.contract.Tier
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.elementNames
import kotlinx.serialization.serializer
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The one kind of evidence with nothing behind it.
 *
 * A typed answer — a signature, a choice, a sentence only the technician can supply — used to
 * travel as `scan`, because the contract had no kind for it and `scan` was the closest thing
 * on the list. Everything downstream then treated it as a photograph: the client tried to
 * upload the string "Anthony" as a `.jpg`, swallowed the failure, wrote the capture anyway,
 * and the server built a `gs://` URI for it. Gemini was asked for a file nobody had uploaded,
 * answered 404, and the technician was shown "the fleet could not be reached" — a sentence
 * about the network, for a signature that never left the phone.
 *
 * The photographs on that job were judged correctly. It was the one field a camera is not
 * involved in that broke.
 */
class TypedAnswerTest {

    @Test
    fun `text is the only kind with no object behind it`() {
        assertFalse("a typed answer has nothing in storage", CaptureKind.TEXT.hasObject)
        CaptureKind.entries.filter { it != CaptureKind.TEXT }.forEach {
            assertTrue("$it is media and must have an object", it.hasObject)
        }
    }

    /**
     * The wire spelling, pinned.
     *
     * `web/src/server/adjudicate/run.ts` decides whether to build a media URI by comparing
     * `capture.kind !== "text"` — a string literal, against a value this enum serialises. The
     * guard was written before the contract had the member, so it could never fire. Renaming
     * the member here without touching that literal would quietly restore the bug.
     */
    @OptIn(ExperimentalSerializationApi::class)
    @Test
    fun `text serialises as the literal the server guards on`() {
        val names = serializer<CaptureKind>().descriptor.elementNames.toList()
        assertEquals("text", names[CaptureKind.TEXT.ordinal])
    }

    @Test
    fun `a typed answer is recorded as the answer, not as a pointer to a file`() = runTest {
        val src = FixtureSource(parent = this)
        val job = src.startJob("proc_banana_v1", "anon", Tier.OPEN)

        src.capture(
            CaptureInput(
                jobId = job.id, stepId = "s3", fieldKey = "knife_stored",
                kind = CaptureKind.TEXT, mediaRef = "Anthony",
                surface = CaptureSurface.APP, mode = CaptureMode.LIVE, redacted = true,
            ),
        )
        advanceUntilIdle()

        val field = src.getJob(job.id)!!.steps.first { it.stepId == "s3" }.fields.single()

        assertEquals("what the technician said is what the record keeps", "Anthony", field.valueText)
        assertNull("there is no object, so there is nothing to point at", field.mediaRef)
        // The failure this guards is quiet: a signature stored only in mediaRef reads as an
        // empty field, and the step never completes however many times it is answered.
        assertTrue("a signature that was given is a field that is filled", field.isFilled)
    }
}
