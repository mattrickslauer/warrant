package ink.warrant.ui.components

import androidx.camera.core.ImageCapture

/**
 * What the lamp does when the shutter fires.
 *
 * Three states rather than a boolean, because "let the phone decide" is a genuinely different
 * answer from "off" and the workshop is full of light a technician cannot predict from the
 * doorway. They cycle on a tap — see [next] — instead of opening a menu: [ink.warrant.ui.job.StepPage]
 * does not scroll and will not grow a popup over a page whose whole promise is that the shutter
 * is always in the same place.
 *
 * This is deliberately the technician's choice and not the procedure's. A [FieldDef][ink.warrant.contract.FieldDef]
 * declares what a step must *produce* — the prompt, the acceptance rule, what good looks like —
 * and says nothing about how the lens is set to produce it. Lighting is a property of the bay
 * the person is standing in, not of the work, so it stays off the contract entirely: no schema
 * field, no generated type, nothing for a procedure author to get wrong about somebody else's
 * garage.
 *
 * [Default] is [Off], which is exactly what the controller did before this existed. The feature
 * is opt-in per step and changes nothing for a step nobody touches.
 */
enum class FlashMode {
    Off,
    Auto,
    On,
    ;

    /** The next state a tap lands on. Wraps, so three taps are a no-op. */
    fun next(): FlashMode = when (this) {
        Off -> Auto
        Auto -> On
        On -> Off
    }

    /** What the chip says. Spelled out rather than an icon alone — see [FlashChip]. */
    val label: String
        get() = when (this) {
            Off -> "Flash off"
            Auto -> "Flash auto"
            On -> "Flash on"
        }

    /**
     * The CameraX constant this state means.
     *
     * These are compile-time `static final int`s, so this mapping inlines and `FlashModeTest`
     * can assert it on the JVM without loading an Android class.
     */
    val imageCaptureMode: Int
        get() = when (this) {
            Off -> ImageCapture.FLASH_MODE_OFF
            Auto -> ImageCapture.FLASH_MODE_AUTO
            On -> ImageCapture.FLASH_MODE_ON
        }

    companion object {
        /** What a step uses until somebody says otherwise. */
        val Default = Off
    }
}
