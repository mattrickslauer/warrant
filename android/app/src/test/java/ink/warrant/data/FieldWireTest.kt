package ink.warrant.data

import ink.warrant.contract.AcceptanceRule
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What the client keeps of a field the procedure declared.
 *
 * The failure this pins cost a whole job and looked like a procedure bug from every angle.
 * `proc_segway_xyber_brake_pad_replacement` v4 carries a CHOICE field offering three answers.
 * On the handset it presented as a question with NO answers — "this step accepts one of a
 * fixed set of answers and the procedure lists none" — and the step could not be completed.
 *
 * Nothing was wrong with the procedure. `fieldDefOf` simply never read the `choices` key, so
 * every choice field in the product arrived with an empty answer list whatever the shop had
 * authored. Four more keys were missing beside it, all of them values somebody had stated and
 * this reader dropped.
 *
 * The lesson worth keeping is about where the bug could be SEEN. The contract test passes: the
 * Kotlin type has a `choices` property. The step page test passes: given choices, it draws
 * them. The publish test passes: the field is refused if its answers are missing. Every layer
 * was individually correct and the product was broken, because the omission lived in the one
 * seam nothing could reach — which is why these readers are now top level and `internal`
 * rather than private methods behind a Firebase connection.
 */
class FieldWireTest {

    /** A field exactly as Firestore hands it over: a map of the JSON, nothing typed. */
    private val choiceOnTheWire = mapOf(
        "key" to "test_ride_performance",
        "kind" to "choice",
        "prompt" to "How do the brakes perform?",
        "source" to "human",
        "required_at_strictness" to 1L,
        "choices" to listOf("Responsive and quiet", "Scraping or noisy", "Unresponsive or soft"),
        "acceptance_rule" to "matches",
        "acceptance_target" to "the shop's road test",
        "guidance" to "Ride it at walking pace and stop hard once.",
    )

    @Test
    fun `a choice field keeps the answers the procedure stated`() {
        val f = fieldDefOf(choiceOnTheWire)
        assertEquals(
            listOf("Responsive and quiet", "Scraping or noisy", "Unresponsive or soft"),
            f.choices,
        )
        assertEquals(FieldKind.CHOICE, f.kind)
        assertEquals(FieldSource.HUMAN, f.source)
        assertEquals(AcceptanceRule.MATCHES, f.acceptanceRule)
        assertEquals("the shop's road test", f.acceptanceTarget)
        assertEquals(1, f.requiredAtStrictness)
    }

    @Test
    fun `a choice field with no answers on the wire is still empty here`() {
        // The mapper reports what is there. Deciding that an empty list is unanswerable is
        // the step page's job — see `FieldDef.unanswerable` — and inventing an answer to
        // paper over a bad procedure would be far worse than the bug this file exists for.
        val f = fieldDefOf(choiceOnTheWire - "choices")
        assertEquals(emptyList<String>(), f.choices)
    }

    @Test
    fun `a band survives whether its ends are whole or not`() {
        // Firestore types a whole number as Long and everything else as Double, so a bound of
        // 7 and a bound of 7.5 arrive as different classes. `as? Double` would keep 7.5 and
        // silently drop 7 — a band that loses one end judges every reading against half a
        // rule, and does it without saying so.
        val f = fieldDefOf(
            mapOf(
                "key" to "pad_thickness",
                "kind" to "measurement",
                "prompt" to "Measure the pad",
                "source" to "instrument",
                "required_at_strictness" to 0L,
                "acceptance_rule" to "within",
                "acceptance_min" to 7L,
                "acceptance_max" to 8.5,
                "acceptance_unit" to "mm",
                "guidance" to "Measure at the thinnest point.",
            ),
        )
        assertEquals(7.0, f.acceptanceMin!!, 1e-9)
        assertEquals(8.5, f.acceptanceMax!!, 1e-9)
        assertEquals("mm", f.acceptanceUnit)
    }

    @Test
    fun `an absent band is null rather than zero`() {
        // Zero is a figure. A field with no stated bound that reported 0.0 would be judged
        // against a bound nobody wrote, which is the fault `faults()` refuses at publish.
        val f = fieldDefOf(choiceOnTheWire)
        assertNull(f.acceptanceMin)
        assertNull(f.acceptanceMax)
        assertNull(f.acceptanceUnit)
    }

    @Test
    fun `every kind on the wire maps to itself`() {
        // A kind that fell through to PHOTO would send somebody to the camera for a signature.
        assertEquals(FieldKind.MEASUREMENT, kindOf("measurement"))
        assertEquals(FieldKind.PHOTO, kindOf("photo"))
        assertEquals(FieldKind.VIDEO, kindOf("video"))
        assertEquals(FieldKind.SCAN, kindOf("scan"))
        assertEquals(FieldKind.CHOICE, kindOf("choice"))
        assertEquals(FieldKind.TEXT, kindOf("text"))
        assertEquals(FieldKind.SIGNATURE, kindOf("signature"))
        assertEquals(FieldKind.LOCATION, kindOf("location"))
    }
}
