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

    // --------------------------------------------------------------- what redo would throw away

    private val rear = field("rear_plate", FieldKind.PHOTO, FieldSource.CAMERA)

    @Test
    fun `the frame on screen belongs to the field in front of you`() {
        val fields = listOf(photo, rear)
        val framed = framedFieldFor(fields, active = rear) { it == "rear_plate" }
        assertEquals("rear_plate", framed?.key)
    }

    @Test
    fun `a lens field with nothing taken yet has no frame to redo`() {
        assertNull(framedFieldFor(listOf(photo), active = photo) { false })
    }

    @Test
    fun `a field answered another way never offers redo`() {
        // The photo was taken, but the page has moved on to the torque. Redo on this step
        // would mean redoing a measurement, which is not a thing the lens can do.
        val fields = listOf(photo, torque)
        val framed = framedFieldFor(fields, active = torque) { it == "front_plate" }
        assertNull(framed)
    }

    @Test
    fun `a finished step still offers redo on the frame it is resting on`() {
        // Nothing outstanding, so the bar reads "Next step" and cannot offer a retake. This is
        // the case redo exists for: the last frame is still on screen and still replaceable.
        val fields = listOf(photo, torque)
        val framed = framedFieldFor(fields, active = null) { it == "front_plate" }
        assertEquals("front_plate", framed?.key)
    }

    @Test
    fun `a finished step with no camera field has nothing to redo`() {
        assertNull(framedFieldFor(listOf(torque, note), active = null) { true })
    }

    @Test
    fun `redo stays on one field when the step has several lenses`() {
        // Both frames exist; the one being decided about is the one redo can throw away.
        val fields = listOf(photo, rear)
        assertEquals("front_plate", framedFieldFor(fields, active = photo) { true }?.key)
        assertEquals("rear_plate", framedFieldFor(fields, active = rear) { true }?.key)
    }

    // ------------------------------------------------------------------- what takes a keyboard

    private val choice = field(
        "test_ride_performance", FieldKind.CHOICE, FieldSource.HUMAN, AcceptanceRule.MATCHES,
    )

    @Test
    fun `a choice field never reaches a keyboard`() {
        // The regression this rule exists for. `test_ride_performance` shipped as a CHOICE
        // carrying three stated answers, the step page had no branch for it, and it fell
        // through to the generic text box — where it was answered with a technician's name and
        // judged against "Responsive and quiet". The options were in the field the whole time.
        assertFalse(choice.usesKeyboard())
    }

    @Test
    fun `the keyboard rule excludes a measurement too`() {
        // Same rule, older reason: a typed number wearing the measured chip is not a
        // measurement. The bar already refuses it in every state (above); this asserts the
        // page-level rule agrees, so the two cannot drift apart.
        assertFalse(torque.usesKeyboard())
    }

    @Test
    fun `text and signature are what the keyboard is for`() {
        assertTrue(note.usesKeyboard())
        assertTrue(signature.usesKeyboard())
    }

    @Test
    fun `a field answered through the lens is not answered by typing`() {
        assertFalse(photo.usesKeyboard())
    }

    @Test
    fun `a bar with work behind it says so and cannot be fired again`() {
        // The complaint this answers: between the shutter and the frame being accepted the
        // device does a second and a half of real work — take the picture, mask the faces on
        // device — and the page said nothing about it. The bar went grey, which is what a dead
        // button looks like, and a second tap on the shutter would have taken a second
        // photograph into a slot that already held one under review.
        val capture = action(photo)
        assertEquals("Capture", capture.label)
        assertFalse(capture.busy)

        val busy = capture.working("Masking faces…")
        assertEquals("Masking faces…", busy.label)
        assertTrue(busy.busy)
        assertFalse(busy.enabled)
        // The KIND is untouched: this is the same decision, still in flight. Rewriting it
        // would change what the tap after it does.
        assertEquals(ActionKind.CAPTURE, busy.kind)
    }

    @Test
    fun `nothing in flight leaves the bar exactly as it was`() {
        // Null is the ordinary case — the overwhelming majority of frames this bar is drawn
        // in — and it must not cost the bar its label, its kind or its tap.
        val capture = action(photo)
        assertEquals(capture, capture.working(null))
    }

    @Test
    fun `a choice bar commits only once something has been chosen`() {
        // `inputReady` carries the selection rather than the contents of a text box, so the
        // bar is dead until an option is tapped and reads "Record" when one is.
        assertFalse(action(choice, inputReady = false).enabled)
        val ready = action(choice, inputReady = true)
        assertTrue(ready.enabled)
        assertEquals(ActionKind.RECORD, ready.kind)
        assertEquals("Record", ready.label)
    }
}
