package ink.warrant.instrument

import ink.warrant.instrument.InstrumentClient.Found
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The order of the in-range list, which is a correctness problem rather than a cosmetic one.
 *
 * Sorting on live RSSI means rows swap places between the moment a technician sees the list and
 * the moment their finger lands — observed connecting to the wrong device for exactly this
 * reason. Signal strength moves by a dBm or two on every single advertisement.
 */
class ScanOrderTest {

    private fun found(
        address: String,
        name: String? = null,
        rssi: Int = -70,
        driver: Driver? = null,
        connectable: Boolean = true,
    ) = Found(address, name, rssi, driver, connectable)

    @Test
    fun `a recognised instrument outranks anything else, however faint`() {
        // The whole reason the technician opened this screen. Burying it under a stronger
        // anonymous phone is the wrong answer at any signal strength.
        val ours = found("AA", "Warrant Ref 01", rssi = -92, driver = Esp32ReferenceDriver)
        val loud = found("BB", rssi = -20)
        assertEquals(listOf("AA", "BB"), scanOrder(listOf(loud, ours)).map { it.address })
    }

    @Test
    fun `something that can be connected to outranks something that cannot`() {
        val beacon = found("AA", rssi = -20, connectable = false)
        val real = found("BB", rssi = -90, connectable = true)
        assertEquals(listOf("BB", "AA"), scanOrder(listOf(beacon, real)).map { it.address })
    }

    @Test
    fun `a dbm of jitter does not reorder the list`() {
        // -70 and -71 are the same distance for a person choosing from a list, and they arrive
        // alternately. Ordering strictly by rssi makes the two rows trade places continuously.
        val a = found("AA", rssi = -70)
        val b = found("BB", rssi = -71)
        assertEquals(
            scanOrder(listOf(a, b)).map { it.address },
            scanOrder(listOf(a.copy(rssi = -71), b.copy(rssi = -70))).map { it.address },
        )
    }

    @Test
    fun `a genuinely closer device still comes first`() {
        // Stability must not cost the useful part: across bands, nearer still wins.
        val near = found("ZZ", rssi = -35)
        val far = found("AA", rssi = -88)
        assertEquals(listOf("ZZ", "AA"), scanOrder(listOf(far, near)).map { it.address })
    }

    @Test
    fun `ordering is total, so the list never shuffles on a redraw`() {
        val all = listOf(found("CC"), found("AA"), found("BB"))
        assertEquals(scanOrder(all).map { it.address }, scanOrder(all.reversed()).map { it.address })
    }
}
