package ink.warrant.data

import ink.warrant.contract.CaptureKind
import ink.warrant.contract.CaptureMode
import ink.warrant.contract.CaptureSurface
import ink.warrant.contract.FieldKind
import ink.warrant.contract.JobStatus
import ink.warrant.contract.ProvenanceClass
import ink.warrant.contract.ReasonKind
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * These tests exist to pin the behaviours the product is ABOUT, not to cover the class.
 *
 * Every one of them would still pass against a fixture layer that returned settled answers —
 * except the ones that would not, and those are the ones that matter: capture returns before
 * any verdict exists, and the form grows a field mid-job. Building the screens against a
 * source that could not do those two things is the trap the seam exists to avoid.
 *
 * `runTest` gives a virtual clock, so the demo timeline runs at full fidelity and instantly.
 *
 * Two mechanics of kotlinx-coroutines-test that are easy to get wrong here:
 *
 *  - Everything runs in the FOREGROUND TestScope, and the event collector is cancelled by
 *    hand at the end of each test. `advanceUntilIdle` deliberately does not drive
 *    `backgroundScope` work, so a timeline launched there sits on its first `delay` forever
 *    and every async assertion reads as "nothing happened" — which is indistinguishable from
 *    the bug these tests exist to catch.
 *  - `emit` hands off; the collector appends on its own turn of the dispatcher. So a
 *    `runCurrent()` is needed before asserting on what has arrived "immediately".
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FixtureSourceTest {

    private fun photo(jobId: String, stepId: String, key: String) = CaptureInput(
        jobId = jobId, stepId = stepId, fieldKey = key,
        kind = CaptureKind.PHOTO, mediaRef = "file://test.jpg",
        surface = CaptureSurface.APP, mode = CaptureMode.LIVE, redacted = true,
    )

    @Test
    fun `capture returns before any verdict exists`() = runTest {
        val src = FixtureSource(parent = this)
        val job = src.startJob("proc_banana_v1", "anon", Tier.OPEN)

        val events = mutableListOf<JobEvent>()
        val sub = launch { src.subscribe(job.id).collect { events += it } }
        runCurrent()

        src.capture(photo(job.id, "s1", "banana_before"))
        runCurrent()

        // The technician's hands are free again. Nothing has judged the photograph yet.
        assertEquals(1, events.size)
        assertTrue(events.single() is JobEvent.CaptureAccepted)

        advanceUntilIdle()

        // And now, behind them, it has.
        assertTrue(
            "a decision must arrive after the capture, not with it",
            events.any { it is JobEvent.DecisionMade },
        )
        assertTrue(events.any { it is JobEvent.StepStatusChanged })

        sub.cancel()
    }

    @Test
    fun `the form grows a field when evidence is insufficient but recoverable`() = runTest {
        val src = FixtureSource(parent = this)
        val job = src.startJob("proc_banana_v1", "anon", Tier.OPEN)

        val events = mutableListOf<JobEvent>()
        val sub = launch { src.subscribe(job.id).collect { events += it } }
        runCurrent()

        // First attempt at the slices: the Inspector cannot confirm the cuts run through.
        src.capture(photo(job.id, "s2", "slices"))
        advanceUntilIdle()

        val added = events.filterIsInstance<JobEvent.FieldAdded>()
        assertEquals("the first attempt must append exactly one field", 1, added.size)
        assertEquals("slices_reframed", added.single().field.key)

        // The step is NOT performed — a grown field is an open request, not a pass.
        assertFalse(
            events.filterIsInstance<JobEvent.StepStatusChanged>()
                .any { it.status == StepStatus.PERFORMED },
        )

        // Second attempt satisfies it.
        events.clear()
        src.capture(photo(job.id, "s2", "slices_reframed"))
        advanceUntilIdle()

        assertTrue(
            events.filterIsInstance<JobEvent.StepStatusChanged>()
                .any { it.status == StepStatus.PERFORMED },
        )

        sub.cancel()
    }

    @Test
    fun `a measured field carries the tool id that makes it measured`() = runTest {
        val src = FixtureSource(parent = this)
        val job = src.startJob("proc_front_brake_v3", "demo.warrant.ink", Tier.INSTRUMENTED)

        val reading = src.submitReading(
            ReadingInput(
                jobId = job.id, stepId = "b3", fieldKey = "pad_torque",
                value = 7.4, unit = "Nm", toolId = "esp32-A19",
            ),
        )
        advanceUntilIdle()

        assertEquals("esp32-A19", reading.toolId)

        val field = src.getJob(job.id)!!.steps.first { it.stepId == "b3" }.fields.single()
        assertEquals(7.4, field.valueNumber!!, 0.0001)
        assertNotNull(
            "without a tool id the value is typed, not measured",
            field.toolId,
        )
    }

    @Test
    fun `a procedure needing an instrument is refused on a surface without one`() = runTest {
        val src = FixtureSource(parent = this)
        val failure = runCatching {
            src.startJob("proc_front_brake_v3", "demo.warrant.ink", Tier.OPEN)
        }.exceptionOrNull()

        assertNotNull("an instrumented procedure must not start on the open tier", failure)
        assertTrue(failure is IllegalArgumentException)
    }

    @Test
    fun `the gate holds the machine when a step was explained rather than performed`() = runTest {
        val src = FixtureSource(parent = this)
        val job = src.startJob("proc_banana_v1", "anon", Tier.OPEN)

        val events = mutableListOf<JobEvent>()
        val sub = launch { src.subscribe(job.id).collect { events += it } }
        runCurrent()

        src.capture(photo(job.id, "s1", "banana_before"))
        advanceUntilIdle()

        // The second exit. Never a skip — this produces a recorded, attributed outcome.
        src.declareBlocked(
            BlockedInput(
                jobId = job.id, stepId = "s2", reasonKind = ReasonKind.VOICE,
                transcript = "The knife is locked in the other workshop and nobody has the key.",
            ),
        )
        advanceUntilIdle()
        src.capture(photo(job.id, "s3", "knife_stored"))
        advanceUntilIdle()

        val sealed = src.getJob(job.id)!!
        assertEquals(JobStatus.SEALED, sealed.status)

        val deferred = sealed.steps.first { it.stepId == "s2" }
        assertEquals(StepStatus.DEFERRED, deferred.status)
        assertEquals(
            "a stated reason is always asserted — a human said it",
            ProvenanceClass.ASSERTED, deferred.provenanceClass,
        )

        assertTrue("the hold must be announced", events.any { it is JobEvent.Held })

        val recordId = events.filterIsInstance<JobEvent.Sealed>().last().recordId
        val record = src.getRecord(recordId)!!
        assertFalse(
            "a deferred step must not release the machine",
            record.machineReleased,
        )
        assertEquals(1, record.deficiencies.size)
        assertEquals("s2", record.deficiencies.single().stepId)

        sub.cancel()
    }

    @Test
    fun `an unsealed job can be thrown away and a sealed one cannot`() = runTest {
        val src = FixtureSource(parent = this)

        // An attempt. Nothing has been sealed, so nothing anybody has been shown is at stake.
        val abandoned = src.startJob("proc_banana_v1", "anon", Tier.OPEN)
        assertEquals(JobStatus.OPEN, src.getJob(abandoned.id)!!.status)
        src.deleteJob(abandoned.id)
        assertNull("an abandoned job is gone", src.getJob(abandoned.id))
        assertTrue(
            "and gone from the list the records screen renders",
            src.listJobs("*").none { it.id == abandoned.id },
        )

        // Deleting it twice is not an error. Two taps on a slow list must not report a failure
        // for work that succeeded.
        src.deleteJob(abandoned.id)

        // A job that ran to completion. This is the line the whole feature rests on.
        val finished = src.startJob("proc_banana_v1", "anon", Tier.OPEN)
        src.capture(photo(finished.id, "s1", "banana_before"))
        advanceUntilIdle()
        // Two captures on s2: the Inspector cannot confirm the cuts run through on the first,
        // and appends a field rather than failing the step. Same path a real run takes.
        src.capture(photo(finished.id, "s2", "slices"))
        advanceUntilIdle()
        src.capture(photo(finished.id, "s2", "slices_reframed"))
        advanceUntilIdle()
        src.capture(photo(finished.id, "s3", "knife_stored"))
        advanceUntilIdle()
        assertEquals(JobStatus.SEALED, src.getJob(finished.id)!!.status)

        val refused = runCatching { src.deleteJob(finished.id) }
        assertTrue(
            "A SEALED JOB CANNOT BE DELETED — this is the product, not a validation rule",
            refused.isFailure,
        )
        assertNotNull("and it is still there afterwards", src.getJob(finished.id))
    }

    @Test
    fun `the ceiling names what this tier could not have proven`() = runTest {
        val open = verificationCeiling(Tier.OPEN)
        assertEquals(listOf(ProvenanceClass.INFERRED, ProvenanceClass.ASSERTED), open.reachable)
        assertEquals(
            setOf(ProvenanceClass.MEASURED, ProvenanceClass.SPECIFIED),
            open.unreachable.map { it.cls }.toSet(),
        )
        assertEquals(
            "requires a paired instrument",
            open.unreachable.first { it.cls == ProvenanceClass.MEASURED }.reason,
        )

        // The app's reason to exist: everything is in reach.
        assertTrue(verificationCeiling(Tier.INSTRUMENTED).unreachable.isEmpty())
    }

    /**
     * The bug this guards is silent, and it shipped: a record showed "Evidence stored, not
     * reachable from here" over photographs that were sitting in storage the whole time.
     *
     * The cause was two different things named `media_ref`. On a FIELD it is a capture id; on
     * a CAPTURE it is where the bytes are. The record screen read the first and passed it to
     * the source as though it were the second, which resolved to null every time — and null
     * is a legitimate answer here, so nothing anywhere raised its voice.
     *
     * So this asserts the hop rather than the rendering: what the field carries must not be a
     * path, and handing exactly that to [DataSource.mediaUrl] must reach the bytes.
     */
    @Test
    fun `a photo resolves from the capture id its field carries`() = runTest {
        val bytes = File.createTempFile("warrant-evidence", ".jpg").apply {
            writeBytes(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()))
            deleteOnExit()
        }

        val src = FixtureSource(parent = this)
        val job = src.startJob("proc_banana_v1", "anon", Tier.OPEN)
        src.capture(
            CaptureInput(
                jobId = job.id, stepId = "s1", fieldKey = "banana_before",
                kind = CaptureKind.PHOTO, mediaRef = bytes.absolutePath,
                surface = CaptureSurface.APP, mode = CaptureMode.LIVE, redacted = true,
            ),
        )
        advanceUntilIdle()

        val field = src.getJob(job.id)!!.steps
            .flatMap { it.fields }
            .first { it.key == "banana_before" }

        assertEquals(FieldKind.PHOTO, field.kind)
        assertNotNull("a captured photo must leave a filled field", field.mediaRef)
        assertFalse(
            "a field points at a capture, never at bytes — if this is a path the two " +
                "meanings of media_ref have been confused again",
            File(field.mediaRef!!).exists(),
        )

        assertEquals(
            "the capture id the field carries must reach the stored bytes",
            bytes.absolutePath,
            src.mediaUrl(job.id, field.mediaRef!!, field.kind),
        )
    }

    /** A kind with nothing behind it resolves to null rather than to a path made of prose. */
    @Test
    fun `a kind with no object behind it reaches for nothing`() = runTest {
        val src = FixtureSource(parent = this)
        val job = src.startJob("proc_banana_v1", "anon", Tier.OPEN)
        assertNull(src.mediaUrl(job.id, "cap_1", FieldKind.TEXT))
        assertNull(src.mediaUrl(job.id, "cap_1", FieldKind.MEASUREMENT))
        assertNull(src.mediaUrl(job.id, "cap_1", FieldKind.SIGNATURE))
    }
}
