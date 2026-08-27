package ink.warrant.ui.job

import ink.warrant.contract.AcceptanceRule
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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

    // THE TICK IN THE BOX, REMOVED.
    //
    // This used to assert the opposite: the bar stayed grey until a name had been typed, and
    // then read "Sign". That is the practice this product exists to replace, reproduced inside
    // it — nothing checks the claim, so the keystroke proved nothing, and the attribution it
    // collected already existed as the caller's own uid on every write.
    //
    // A signature is now satisfied from the signed-in account the moment the step is shown
    // (JobViewModel.attributeSignatures), so the bar must never demand a keystroke for one.
    @Test
    fun `a signature never demands a keystroke, whatever has been typed`() {
        val untouched = action(signature, inputReady = false)
        assertTrue(
            "the bar is grey on a signature, so the only way on is to type a name",
            untouched.enabled,
        )
        assertNotEquals(
            "the bar still asks the technician to sign",
            ActionKind.SIGN,
            untouched.kind,
        )
        assertEquals(ActionKind.ADVANCE, untouched.kind)
        // And it is the same bar whether or not anything happens to be in the text field.
        assertEquals(untouched.kind, action(signature, inputReady = true).kind)
    }

    @Test
    fun `a signature on the last step finishes rather than advancing`() {
        val a = action(signature, inputReady = false, lastStep = true)
        assertEquals(ActionKind.FINISH, a.kind)
        assertTrue(a.enabled)
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
    ).copy(choices = listOf("Responsive and quiet", "Grabs", "Squeals under load"))

    /**
     * The same field as it actually shipped: a fixed set of answers, and the set is empty.
     *
     * Not a hypothetical. `proc_segway_xyber_brake_pad_replacement` carried exactly this, and
     * what it produced was not a bad answer but no answer at all — the run stopped on the step
     * and every step behind it became unreachable.
     */
    private val choiceWithNoAnswers = field(
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

    // ------------------------------------------------- the question that has no answers

    @Test
    fun `a choice with answers is answerable`() {
        assertNull(choice.unanswerable())
    }

    @Test
    fun `a choice with no answers names the fault`() {
        val why = choiceWithNoAnswers.unanswerable()
        assertNotNull("an empty choice must be reported as unanswerable", why)
        assertTrue("the sentence must say what is wrong: $why", why!!.contains("lists none"))
    }

    @Test
    fun `effort is not the same as impossibility`() {
        // The distinction the whole mechanism rests on. A measurement with no instrument in
        // the room is HARD — the bar says "Pair an instrument" and somebody goes and does it.
        // Routing it through exit two instead would hand the technician an excuse for every
        // torque they could not be bothered to take, which is the opposite of the point.
        assertNull(torque.unanswerable())
        assertEquals(ActionKind.PAIR, action(torque, connected = false).kind)
        assertNull(photo.unanswerable())
        assertNull(signature.unanswerable())
        assertNull(note.unanswerable())
    }

    @Test
    fun `an unanswerable field gets a live bar, never a dead one`() {
        // The bug, stated as an assertion. Before this the bar fell through to RECORD, which
        // is enabled only when something has been typed — and nothing can be typed at a
        // question with no answers and no keyboard. So it was permanently grey, and the bar
        // is the only way forward on a step: the job could not be finished or abandoned, only
        // force-quit, which loses every capture already made.
        val a = action(choiceWithNoAnswers, inputReady = false)
        assertEquals(ActionKind.DECLARE, a.kind)
        assertTrue("the way out must always be tappable", a.enabled)
        assertEquals("This can't be answered", a.label)
    }

    @Test
    fun `the way out is offered on the last step too`() {
        // Nothing about being last makes a question answerable, and a job that cannot reach
        // its own handover is stuck just as badly as one that cannot reach step seven.
        assertEquals(ActionKind.DECLARE, action(choiceWithNoAnswers, lastStep = true).kind)
    }

    @Test
    fun `an unanswerable field holds the step until a reason is given`() {
        assertTrue(
            "before a reason it is still owed",
            choiceWithNoAnswers.holdsStep(strictness = 1, reasoned = false, filled = false),
        )
        assertFalse(
            "after a reason it is the fleet's problem, not the technician's",
            choiceWithNoAnswers.holdsStep(strictness = 1, reasoned = true, filled = false),
        )
    }

    @Test
    fun `a reason does not release a field that could have been answered`() {
        // The refusal that keeps exit two from becoming a skip. Saying "I could not do it"
        // retires a question nobody could answer; it does not retire the photograph you were
        // asked for and did not take. That one is still owed, and the page still points at it.
        assertTrue(photo.holdsStep(strictness = 1, reasoned = true, filled = false))
        assertTrue(torque.holdsStep(strictness = 1, reasoned = true, filled = false))
    }

    @Test
    fun `an optional field never holds the step whatever else is true`() {
        val optional = field("nice_to_have", FieldKind.TEXT, FieldSource.HUMAN, requiredAt = 4)
        assertFalse(optional.holdsStep(strictness = 3, reasoned = false, filled = false))
    }

    @Test
    fun `the page walks past an unanswerable field once it has been explained`() {
        val fields = listOf(choiceWithNoAnswers, photo)

        // Before: the page points at the question, so the technician can see what is being
        // asked and say why they cannot answer it.
        assertEquals(
            "test_ride_performance",
            activeFieldFor(fields, strictness = 1, selected = null, reasoned = false) { false }?.key,
        )

        // After: it moves on to the work that can still be done. This is the difference
        // between a run that continues and a run that ends here.
        assertEquals(
            "front_plate",
            activeFieldFor(fields, strictness = 1, selected = null, reasoned = true) { false }?.key,
        )
    }

    @Test
    fun `a step whose only field was unanswerable becomes the way forward`() {
        // Nothing left to point at, so the bar becomes ADVANCE and the job carries on. Note
        // what has NOT happened: no capture was invented, no field was marked filled, and the
        // step's status is still whatever the fleet last said it was.
        val fields = listOf(choiceWithNoAnswers)
        val active =
            activeFieldFor(fields, strictness = 1, selected = null, reasoned = true) { false }
        assertNull(active)
        assertEquals(ActionKind.ADVANCE, action(active).kind)
    }

    @Test
    fun `the field strip can still point back at an explained question`() {
        // Selection wins over the walk-forward rule, as it does everywhere else. Somebody who
        // taps the pip wants to look at the question again — perhaps to say something better
        // about why it could not be answered — and must not be bounced off it.
        val fields = listOf(choiceWithNoAnswers, photo)
        assertEquals(
            "test_ride_performance",
            activeFieldFor(
                fields, strictness = 1, selected = "test_ride_performance", reasoned = true,
            ) { false }?.key,
        )
    }
}
