package ink.warrant.instrument

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A connection that failed must not be reported as a connection that ended.
 *
 * `onConnectionStateChange` ignored its `status` argument, so a device that refused outright
 * arrived at the technician as an ordinary disconnect: the pair screen returned to "No
 * instrument paired" and said nothing about why. On a product whose whole claim is that a
 * record says what actually happened, silently discarding a failure is the wrong default.
 *
 * 133 is the one that matters. It is Android's generic GATT error, it is overwhelmingly the
 * most common BLE failure on the platform, and it is usually transient — so the message has to
 * tell a person the useful thing, which is to try again.
 */
class ConnectionFailureTest {

    @Test
    fun `the generic gatt error says what to actually do about it`() {
        val m = connectionFailureMessage(133)
        assertTrue(m, m.contains("133"))
        assertTrue(m, m.contains("again", ignoreCase = true))
    }

    @Test
    fun `a timeout says the device was not reachable rather than that it refused`() {
        val m = connectionFailureMessage(8)
        assertTrue(m, m.contains("8"))
        assertTrue(m, m.contains("range", ignoreCase = true) || m.contains("asleep", ignoreCase = true))
    }

    @Test
    fun `the remote ending it is attributed to the remote`() {
        val m = connectionFailureMessage(19)
        assertTrue(m, m.contains("device", ignoreCase = true))
    }

    @Test
    fun `an unrecognised code is still a usable sentence carrying the number`() {
        // Every status must produce something a person can report. An unknown code that
        // renders as an empty banner is indistinguishable from a UI bug.
        val m = connectionFailureMessage(4242)
        assertTrue(m, m.contains("4242"))
        assertTrue(m, m.length > 20)
    }

    @Test
    fun `every message names its own status code`() {
        // So a bug report carries the number without the technician knowing to look for it.
        for (status in listOf(8, 19, 22, 62, 133, 257, 1)) {
            assertTrue("$status", connectionFailureMessage(status).contains(status.toString()))
        }
    }
}
