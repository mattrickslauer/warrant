package ink.warrant.instrument

/**
 * How wide a band counts as "the same distance" when ordering the list.
 *
 * Ten dBm. Wide enough that the dBm-to-dBm jitter every advertisement carries cannot swap two
 * rows; narrow enough that a device across the room still sorts below one in your hand.
 */
private const val RSSI_BAND_DB = 10

/**
 * The order the in-range list is shown in — and it is a correctness problem, not a cosmetic one.
 *
 * Ordering strictly by signal strength means rows change places between the moment a technician
 * reads the list and the moment their finger lands, because RSSI moves on every advertisement.
 * That is not a theoretical risk: it connected to the wrong device that way.
 *
 * So, in order:
 *
 * 1. **A device a driver recognises.** It is what the technician opened this screen for, and
 *    burying it under a louder anonymous phone is wrong at any signal strength.
 * 2. **Something connectable**, over a beacon that will refuse.
 * 3. **Roughly how close it is**, in bands rather than exact dBm.
 * 4. **Address**, so the order is total and a redraw never reshuffles it.
 *
 * Jitter straddling a band boundary can still move a row, which is the residual cost of keeping
 * any notion of proximity at all. One row occasionally, rather than the whole list constantly.
 */
fun scanOrder(found: List<InstrumentClient.Found>): List<InstrumentClient.Found> =
    found.sortedWith(
        compareByDescending<InstrumentClient.Found> { it.driver != null }
            .thenByDescending { it.connectable }
            // Integer division truncates toward zero, so -70 and -71 share a band.
            .thenByDescending { it.rssi / RSSI_BAND_DB }
            .thenBy { it.address },
    )
