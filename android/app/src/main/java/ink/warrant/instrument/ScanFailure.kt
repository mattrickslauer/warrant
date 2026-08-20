package ink.warrant.instrument

import java.util.concurrent.CancellationException

/** A cause chain deep enough for any real wrapping, shallow enough not to loop on a cycle. */
private const val MAX_CAUSE_DEPTH = 8

/**
 * What to show a technician when the scan stops, or null when there is nothing to say.
 *
 * **Stopping is not failing.** Tapping a device to connect cancels the scan, which is the whole
 * point of tapping; so does leaving the screen. Both arrive here as a `CancellationException`
 * and neither is a fault. Showing one reads as "the thing you just did broke", which is the
 * opposite of what happened.
 *
 * The caller must re-throw when this returns null. A swallowed `CancellationException` never
 * reaches the parent job, so a coroutine that was asked to stop goes on believing it succeeded
 * — which is why `runCatching` is the wrong tool for anything that collects a flow.
 */
fun scanFailureMessage(t: Throwable): String? {
    if (t.isCancellation()) return null
    return t.message?.takeIf { it.isNotBlank() }
        ?: "the scan stopped and did not say why"
}

/**
 * Cancellation anywhere in the cause chain, not just at the top.
 *
 * Flow collection wraps what it throws, so the outermost type is routinely not the one that
 * matters.
 */
private fun Throwable.isCancellation(): Boolean {
    var current: Throwable? = this
    var depth = 0
    while (current != null && depth++ < MAX_CAUSE_DEPTH) {
        if (current is CancellationException) return true
        val next = current.cause
        if (next === current) return false
        current = next
    }
    return false
}

/**
 * Why a GATT connection failed, in words a technician can act on and with the number a bug
 * report needs.
 *
 * **133 is the one that matters.** It is Android's catch-all GATT error, it is by a distance
 * the most common BLE failure on the platform, and it is usually transient — so the message
 * says to try again rather than implying the device is unsuitable.
 */
fun connectionFailureMessage(status: Int): String {
    val detail = when (status) {
        8 -> "the device went out of range or fell asleep before the connection finished"
        19 -> "the device ended the connection itself"
        22 -> "this phone ended the connection"
        34 -> "the Bluetooth link timed out"
        62 -> "the connection could never be established"
        133 -> "the device did not accept the connection. This is Android's generic Bluetooth " +
            "error and it is usually transient - try again, and wake the device first if it sleeps"
        257 -> "the Bluetooth stack failed"
        else -> "the Bluetooth stack refused the connection and did not say why"
    }
    return "$detail (status $status)."
}
