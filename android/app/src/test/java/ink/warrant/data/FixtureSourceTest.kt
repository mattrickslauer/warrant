package ink.warrant.data

import ink.warrant.contract.CaptureKind
import ink.warrant.contract.CaptureMode
import ink.warrant.contract.CaptureSurface
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
import org.junit.Assert.assertTrue
import org.junit.Test

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
                value = 28.4, unit = "Nm", toolId = "esp32-A19",
            ),
        )
        advanceUntilIdle()

        assertEquals("esp32-A19", reading.toolId)

        val field = src.getJob(job.id)!!.steps.first { it.stepId == "b3" }.fields.single()
        assertEquals(28.4, field.valueNumber!!, 0.0001)
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
                by = "tech_01",
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
}
