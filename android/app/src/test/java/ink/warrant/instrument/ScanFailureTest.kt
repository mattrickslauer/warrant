package ink.warrant.instrument

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CancellationException

/**
 * Stopping is not failing.
 *
 * `PairScreen` wrapped the scan in `runCatching`, which catches `CancellationException` along
 * with everything else. Tapping a device to connect cancels the scan — ordinary, expected, and
 * the whole point of tapping — and the cancellation was rendered to the technician as a red
 * "Scan failed · The coroutine scope left the composition".
 *
 * Swallowing it is also wrong twice over: a caught `CancellationException` never reaches the
 * parent, so the coroutine that was asked to stop carries on believing it succeeded.
 */
class ScanFailureTest {

    @Test
    fun `cancellation is not a failure and must not be shown`() {
        assertNull(scanFailureMessage(CancellationException("The coroutine scope left the composition")))
        assertNull(scanFailureMessage(kotlinx.coroutines.CancellationException("stopped")))
    }

    @Test
    fun `a real failure keeps its own words`() {
        assertEquals("bluetooth is off", scanFailureMessage(IllegalStateException("bluetooth is off")))
    }

    @Test
    fun `a real failure with nothing to say still says something`() {
        // An empty banner reads as a rendering bug rather than a failure. Whatever we show has
        // to be a sentence a person can act on.
        val message = scanFailureMessage(IOException())
        assertNotNull(message)
        assertEquals(true, message!!.isNotBlank())
    }

    @Test
    fun `a cause that is cancellation is still cancellation`() {
        // Flow collection wraps what it throws. Only checking the outermost type misses it.
        val wrapped = IllegalStateException("collect failed", CancellationException("stopped"))
        assertNull(scanFailureMessage(wrapped))
    }
}
