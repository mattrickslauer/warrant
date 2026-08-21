package ink.warrant.ui.job

import ink.warrant.contract.AcceptanceRule
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The one big button's rules, tested without a device.
 *
 * The step page is a layout, and a layout is checked by looking at it. This is the part that
 * cannot be checked by looking: a bar reading "Next step" on a step that is not finished, or
 * offering a keyboard on a measurement, is wrong in a way a screenshot shows as perfectly
 * fine. So the decision lives in [primaryActionFor] as plain Kotlin and gets asserted here.
 */
class StepActionTest {

    private fun field(
        key: String,
        kind: FieldKind,
        source: FieldSource,
        rule: AcceptanceRule = AcceptanceRule.MUST_SHOW,
        requiredAt: Int = 0,
    ) = FieldDef(
        key = key,
        kind = kind,
        prompt = "Do the thing",
        source = source,
        requiredAtStrictness = requiredAt,
        acceptanceRule = rule,
        guidance = "What good looks like",
    )

    private val photo = field("front_plate", FieldKind.PHOTO, FieldSource.CAMERA)
    private val torque = field(
        "torque", FieldKind.MEASUREMENT, FieldSource.INSTRUMENT, AcceptanceRule.WITHIN,
    )
    private val signature = field(
        "stored", FieldKind.SIGNATURE, FieldSource.HUMAN, AcceptanceRule.SIGNED_BY,
    )
    private val note = field("note", FieldKind.TEXT, FieldSource.HUMAN)

    private fun action(
        field: FieldDef?,
        filled: Boolean = false,
        lastStep: Boolean = false,
        connected: Boolean = false,
        hasReading: Boolean = false,
        inputReady: Boolean = false,
    ) = primaryActionFor(field, filled, lastStep, connected, hasReading, inputReady)

    // ------------------------------------------------------------------- the way out of a step

    @Test
    fun `no outstanding field means the bar is the way forward`() {
        val a = action(field = null)
        assertEquals(ActionKind.ADVANCE, a.kind)
        assertEquals("Next step", a.label)
        assertTrue(a.enabled)
    }

    @Test
    fun `the last step finishes rather than advancing`() {
        assertEquals(ActionKind.FINISH, action(field = null, lastStep = true).kind)
    }

    // ------------------------------------------------------------------------------ the lens

    @Test
    fun `a camera field offers the shutter`() {
        val a = action(photo)
        assertEquals(ActionKind.CAPTURE, a.kind)
        assertEquals("Capture", a.label)
    }

    @Test
    fun `a frame under review offers a retake instead`() {
        assertEquals("Retake", action(photo, filled = true).label)
    }

    @Test
    fun `camera is decided by source as well as kind`() {
        // A scan is not a PHOTO, but it is answered through the lens, so it gets the shutter.
        val scan = field("vin", FieldKind.SCAN, FieldSource.CAMERA)
        assertEquals(ActionKind.CAPTURE, action(scan).kind)
        assertTrue(scan.usesCamera())
        assertFalse(note.usesCamera())
    }

    // ----------------------------------------------------------------------- the measurement

    @Test
    fun `a measurement never reaches a keyboard`() {
        // Every state a measurement field can be in, including the one where nothing is
        // attached. None of them is RECORD, and that is the whole thesis.
        val states = listOf(
            action(torque, connected = false, hasReading = false),
            action(torque, connected = true, hasReading = false),
            action(torque, connected = true, hasReading = true),
            action(torque, connected = true, hasReading = true, filled = true),
        )
        states.forEach { a ->
            assertFalse(
                "a measurement offered ${a.kind}, which is a typed path",
                a.kind == ActionKind.RECORD || a.kind == ActionKind.SIGN,
            )
        }
    }

    @Test
    fun `an unpaired measurement sends you to pair rather than pretending`() {
        val a = action(torque, connected = false)
        assertEquals(ActionKind.PAIR, a.kind)
        assertTrue(a.enabled)
    }

    @Test
    fun `a paired instrument with nothing to say leaves the bar dead`() {
        val a = action(torque, connected = true, hasReading = false)
        assertEquals(ActionKind.TAKE_READING, a.kind)
        assertFalse(a.enabled)
    }

    @Test
    fun `a reading can be taken onto the form`() {
        val a = action(torque, connected = true, hasReading = true)
        assertEquals(ActionKind.TAKE_READING, a.kind)
        assertTrue(a.enabled)
        assertEquals("Take this reading", a.label)
    }

    // ----------------------------------------------------------------- typed and signed work

    @Test
    fun `a signature stays dead until a name is there`() {
        assertFalse(action(signature, inputReady = false).enabled)
        assertTrue(action(signature, inputReady = true).enabled)
        assertEquals(ActionKind.SIGN, action(signature, inputReady = true).kind)
    }

    @Test
    fun `text records once something has been typed`() {
        assertEquals(ActionKind.RECORD, action(note, inputReady = true).kind)
        assertFalse(action(note, inputReady = false).enabled)
    }

    // ---------------------------------------------------------------- which field is in front

    @Test
    fun `the active field is the first required one still empty`() {
        val fields = listOf(photo, torque, signature)
        val active = activeFieldFor(fields, strictness = 1, selected = null) { it == "front_plate" }
        assertEquals("torque", active?.key)
    }

    @Test
    fun `an optional field does not hold the step open`() {
        val optional = field("extra", FieldKind.PHOTO, FieldSource.CAMERA, requiredAt = 3)
        val fields = listOf(photo, optional)
        // Strictness 1 does not require `extra`, so with the photo filled nothing is
        // outstanding and the bar becomes the way forward.
        assertNull(activeFieldFor(fields, strictness = 1, selected = null) { it == "front_plate" })
        // At strictness 3 it is required, and the page points at it.
        val strict = activeFieldFor(fields, strictness = 3, selected = null) { it == "front_plate" }
        assertEquals("extra", strict?.key)
    }

    @Test
    fun `tapping the strip overrides the walk-forward order`() {
        val fields = listOf(photo, torque)
        val active = activeFieldFor(fields, strictness = 1, selected = "front_plate") { false }
        assertEquals("front_plate", active?.key)
    }

    @Test
    fun `a selection naming nothing falls back to the outstanding field`() {
        val fields = listOf(photo, torque)
        val active = activeFieldFor(fields, strictness = 1, selected = "gone") { false }
        assertEquals("front_plate", active?.key)
    }
}
