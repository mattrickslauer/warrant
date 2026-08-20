package ink.warrant.instrument

import ink.warrant.instrument.InstrumentClient.Found
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A device is not one advertisement. It is a stream of them, and they do not all say the same
 * thing.
 *
 * The name almost never rides in the first packet: a peripheral advertises, the phone sends a
 * scan request, and the name comes back in the scan RESPONSE — a second, separate `ScanResult`.
 * The scan deduplicated on address and returned early on every sighting after the first, so the
 * one carrying the name was discarded and virtually every device rendered as "(unnamed)".
 */
class FoundMergeTest {

    private fun found(
        name: String? = null,
        rssi: Int = -50,
        driver: Driver? = null,
        connectable: Boolean = false,
    ) = Found("AA:BB:CC:DD:EE:FF", name, rssi, driver, connectable)

    @Test
    fun `a later sighting carrying a name fills in one we did not have`() {
        val merged = found(name = null).merge(found(name = "Warrant Ref 01"))
        assertEquals("Warrant Ref 01", merged.name)
    }

    @Test
    fun `a later sighting without a name does not erase the one we have`() {
        // The reverse order happens just as often, and losing the name again would make the
        // list flicker between named and unnamed.
        val merged = found(name = "Warrant Ref 01").merge(found(name = null))
        assertEquals("Warrant Ref 01", merged.name)
    }

    @Test
    fun `signal strength always takes the newest reading`() {
        assertEquals(-31, found(rssi = -80).merge(found(rssi = -31)).rssi)
        assertEquals(-80, found(rssi = -31).merge(found(rssi = -80)).rssi)
    }

    @Test
    fun `a driver identified on either sighting is kept`() {
        assertEquals(Esp32ReferenceDriver, found().merge(found(driver = Esp32ReferenceDriver)).driver)
        assertEquals(Esp32ReferenceDriver, found(driver = Esp32ReferenceDriver).merge(found()).driver)
    }

    @Test
    fun `connectable is sticky, because a scan response does not repeat the claim`() {
        // Only the connectable advertisement carries the flag; the scan response that follows
        // reports false on several stacks. Taking the newest value would make a perfectly
        // pairable device look like a beacon.
        assertTrue(found(connectable = false).merge(found(connectable = true)).connectable)
        assertTrue(found(connectable = true).merge(found(connectable = false)).connectable)
        assertFalse(found(connectable = false).merge(found(connectable = false)).connectable)
    }
}
