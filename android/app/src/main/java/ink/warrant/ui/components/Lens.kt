package ink.warrant.ui.components

import androidx.camera.core.CameraSelector

/**
 * Which way the camera is pointed.
 *
 * Two states rather than a list of every physical camera the phone has, because "the one facing
 * the work" and "the one facing me" are the only two a person standing in a bay is choosing
 * between — a picker naming four lenses by focal length is a camera app's problem, not a
 * maintenance record's. They toggle on a tap, like [FlashMode] beside them, for the same reason:
 * [ink.warrant.ui.job.StepPage] does not scroll and will not grow a popup over a page whose
 * whole promise is that the shutter is always in the same place.
 *
 * This is deliberately the technician's choice and not the procedure's. A
 * [FieldDef][ink.warrant.contract.FieldDef] declares what a step must *produce* — the prompt,
 * the acceptance rule, what good looks like — and says nothing about which piece of glass
 * produces it. Which camera you reach for is a property of where you are standing and what you
 * are pointing at, not of the work, so it stays off the contract entirely: no schema field, no
 * generated type, nothing for a procedure author to get wrong about somebody else's garage.
 *
 * [Default] is [Back], which is exactly what the controller did before this existed. What did
 * NOT exist before it is any way to reach the front camera at all: `cameraSelector` was pinned
 * to `DEFAULT_BACK_CAMERA` at construction, so a task whose subject is the person holding the
 * phone — `proc_smile_v1` is the bundled one — could not be performed on either surface. The
 * browser twin is `Lens` in web/src/components/CameraLayer.tsx.
 */
enum class Lens {
    Back,
    Front,
    ;

    /** The other one. Wraps, so two taps are a no-op. */
    fun next(): Lens = if (this == Back) Front else Back

    /**
     * What the chip says.
     *
     * Names the lens you are ON, not the one a tap would get, because the chip is a statement
     * of state before it is a button — and at arm's length in bad light those two read very
     * differently. Spelled out rather than an icon alone for the same reason [FlashMode.label]
     * is.
     */
    val label: String
        get() = when (this) {
            Back -> "Back camera"
            Front -> "Front camera"
        }

    /**
     * The CameraX selector this state means.
     *
     * `DEFAULT_BACK_CAMERA` and `DEFAULT_FRONT_CAMERA` are constructed constants rather than
     * compile-time ints, so unlike [FlashMode.imageCaptureMode] this one cannot be asserted on
     * the JVM without loading an Android class — which is why `LensTest` pins [next] and
     * [label] and leaves this mapping to the two lines below it.
     */
    val cameraSelector: CameraSelector
        get() = when (this) {
            Back -> CameraSelector.DEFAULT_BACK_CAMERA
            Front -> CameraSelector.DEFAULT_FRONT_CAMERA
        }

    companion object {
        /** What a step uses until somebody says otherwise. */
        val Default = Back
    }
}
