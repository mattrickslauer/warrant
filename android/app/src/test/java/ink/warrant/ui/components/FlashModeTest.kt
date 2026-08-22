package ink.warrant.ui.components

import androidx.camera.core.ImageCapture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * The lamp's three states, tested without a device.
 *
 * Flash is chrome, and chrome is normally checked by looking at it. Two things here cannot be:
 * the order the tap walks through, and which CameraX constant each state actually means. A
 * chip that reads "Flash on" while the controller is holding FLASH_MODE_OFF looks perfectly
 * correct in a screenshot and produces a dark photograph on the one step that needed light —
 * on somebody else's phone, hours later, with the machine already reassembled.
 *
 * The constants are compile-time `static final int`s, so asserting against them inlines the
 * number and never loads an Android class. That is why this is a JVM test and not an
 * instrumented one.
 */
class FlashModeTest {

    @Test
    fun `starts off, so nothing changes for a step nobody touches`() {
        assertEquals(FlashMode.Off, FlashMode.Default)
    }

    @Test
    fun `a tap walks off to auto to on and back to off`() {
        assertEquals(FlashMode.Auto, FlashMode.Off.next())
        assertEquals(FlashMode.On, FlashMode.Auto.next())
        assertEquals(FlashMode.Off, FlashMode.On.next())
    }

    @Test
    fun `three taps return to where they started`() {
        FlashMode.entries.forEach { start ->
            assertEquals(start, start.next().next().next())
        }
    }

    @Test
    fun `every state maps to the CameraX constant that carries its name`() {
        assertEquals(ImageCapture.FLASH_MODE_OFF, FlashMode.Off.imageCaptureMode)
        assertEquals(ImageCapture.FLASH_MODE_AUTO, FlashMode.Auto.imageCaptureMode)
        assertEquals(ImageCapture.FLASH_MODE_ON, FlashMode.On.imageCaptureMode)
    }

    @Test
    fun `no two states share a capture mode or a label`() {
        val modes = FlashMode.entries.map { it.imageCaptureMode }
        assertEquals(modes.size, modes.toSet().size)

        val labels = FlashMode.entries.map { it.label }
        assertEquals(labels.size, labels.toSet().size)
        labels.forEach { assertNotEquals("", it.trim()) }
    }
}
