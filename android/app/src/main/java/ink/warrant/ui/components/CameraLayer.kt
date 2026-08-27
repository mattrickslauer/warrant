package ink.warrant.ui.components

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Cameraswitch
import androidx.compose.material.icons.rounded.FlashAuto
import androidx.compose.material.icons.rounded.FlashOff
import androidx.compose.material.icons.rounded.FlashOn
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import ink.warrant.design.WarrantTheme
import java.io.File
import java.util.concurrent.Executor

/** What the lens is doing right now. */
enum class CameraStatus { AskingPermission, Denied, Live }

/**
 * A handle on the camera, held by whoever owns the shutter.
 *
 * This exists because the shutter is no longer *on* the camera. The step page puts one big
 * button at the bottom of the screen and that button means something different on every field
 * kind — so the preview cannot own the control, and the control has to be able to reach the
 * preview from the other end of the layout. The handle is that reach, and it is deliberately
 * the only one: nothing else can make this camera take a picture.
 */
@Stable
class CameraHandle internal constructor(initial: CameraStatus) {
    var status by mutableStateOf(initial)
        internal set

    /** True between the tap and the file landing on disk. Keeps the bar from double-firing. */
    var busy by mutableStateOf(false)
        internal set

    internal var shoot: (((File?) -> Unit) -> Unit)? = null

    val ready: Boolean get() = status == CameraStatus.Live && shoot != null && !busy

    fun capture(onDone: (File?) -> Unit) {
        val take = shoot
        if (take == null || busy) {
            onDone(null)
            return
        }
        take(onDone)
    }
}

@Composable
fun rememberCameraHandle(): CameraHandle {
    val context = LocalContext.current
    return remember {
        CameraHandle(
            if (granted(context)) CameraStatus.Live else CameraStatus.AskingPermission,
        )
    }
}

/**
 * The lens, full bleed, behind everything.
 *
 * What you are being asked for and what the lens can see are the same question, so the frame
 * gets the whole screen rather than a 4:3 tile with prose stacked above it. The prompt, the
 * step number and the exits are drawn *over* it — see [ink.warrant.ui.job.StepPage].
 *
 * The preview is only bound while [handle] says Live, and it is unbound the moment this leaves
 * the composition. A step that does not need the lens does not open it.
 *
 * [flash] and [lens] are the technician's choices for the step in hand, owned by the job's
 * state and passed down rather than held here — see
 * [ink.warrant.ui.job.JobViewModel.UiState.flash] and [ink.warrant.ui.job.JobViewModel.UiState.lens].
 * One owner means the chip and the hardware cannot disagree, which is the whole failure worth
 * preventing.
 */
@Composable
fun CameraLayer(
    handle: CameraHandle,
    flash: FlashMode = FlashMode.Default,
    lens: Lens = Lens.Default,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { ok -> handle.status = if (ok) CameraStatus.Live else CameraStatus.Denied }

    LaunchedEffect(Unit) {
        if (handle.status == CameraStatus.AskingPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    val controller = remember {
        LifecycleCameraController(context).apply {
            cameraSelector = Lens.Default.cameraSelector
            setEnabledUseCases(LifecycleCameraController.IMAGE_CAPTURE)
        }
    }

    // Set on the controller for the same reason the lamp is, and separately from it: CameraX
    // rebinds the preview when the selector changes, so writing it here rather than at the
    // moment of capture is what makes the viewfinder actually turn around. Pinned at
    // construction — which is what this was — meant the front camera could not be reached at
    // all, and `proc_smile_v1` asks for exactly that.
    LaunchedEffect(controller, lens) {
        controller.cameraSelector = lens.cameraSelector
    }

    // Set on the controller rather than passed at the moment of capture: the lamp is part of
    // how the lens is configured, and a mode applied only inside takePhoto would be a setting
    // the preview never reflects.
    LaunchedEffect(controller, flash) {
        controller.imageCaptureFlashMode = flash.imageCaptureMode
    }

    DisposableEffect(lifecycleOwner, handle.status) {
        if (handle.status == CameraStatus.Live) controller.bindToLifecycle(lifecycleOwner)
        onDispose { controller.unbind() }
    }

    // The handle is wired for exactly as long as this layer is on screen. When the active
    // field stops being a camera field the layer leaves, the wire is cut, and a stale tap on
    // a bar that has since changed meaning cannot reach a controller that is no longer bound.
    DisposableEffect(controller) {
        handle.shoot = { onDone ->
            handle.busy = true
            takePhoto(context, controller) { file ->
                handle.busy = false
                onDone(file)
            }
        }
        onDispose { handle.shoot = null }
    }

    Box(modifier.fillMaxSize().background(Color.Black)) {
        when (handle.status) {
            CameraStatus.Live -> AndroidView(
                factory = { ctx ->
                    PreviewView(ctx).apply {
                        scaleType = PreviewView.ScaleType.FILL_CENTER
                        // COMPATIBLE backs the preview with a TextureView. PERFORMANCE uses a
                        // SurfaceView, which Compose does not clip — it painted straight over
                        // the overlay chrome, which is how this was found.
                        implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                        this.controller = controller
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )

            CameraStatus.AskingPermission -> Hint("Waiting for camera permission…")

            CameraStatus.Denied -> Hint(
                "No camera permission. This step can still be answered by saying why — it " +
                    "will be an assertion, not a photograph.",
            )
        }
    }
}

/**
 * "Live" is a claim about provenance, not a decoration: a frame grabbed from an open stream
 * here and now is a different thing from an uploaded file, and the record records which.
 */
@Composable
fun LiveMark(modifier: Modifier = Modifier) {
    Row(
        modifier
            .background(Color(0xB8202124), CircleShape)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(Modifier.size(8.dp).background(WarrantTheme.colors.measured, CircleShape))
        Text("Live", style = WarrantTheme.type.label.copy(color = Color.White))
    }
}

/**
 * The lamp, and the one control that changes it.
 *
 * Sits opposite [LiveMark] at the foot of the frame: both are statements about the lens rather
 * than about the work, and both come and go with it. Nothing above the primary bar moves to
 * make room, because [ink.warrant.ui.job.StepPage]'s second rule is that the bar never moves —
 * a technician with dirty hands should never have to aim, and a shutter that shifts because a
 * chip appeared is a shutter you have to look for.
 *
 * A tap cycles rather than opening a menu. Three states is few enough to walk through, and the
 * page has nowhere to put a popup: it does not scroll, and a sheet over the lens would hide
 * the thing you are pointing it at. The label is spelled out beside the icon because a flash
 * glyph alone does not say which of three states it is currently in — the icon is the state,
 * not a button, and the two read differently at arm's length in bad light.
 */
@Composable
fun FlashChip(mode: FlashMode, onCycle: () -> Unit, modifier: Modifier = Modifier) {
    val tint = if (mode == FlashMode.Off) Color.White.copy(alpha = 0.55f) else Color.White
    val icon = when (mode) {
        FlashMode.Off -> Icons.Rounded.FlashOff
        FlashMode.Auto -> Icons.Rounded.FlashAuto
        FlashMode.On -> Icons.Rounded.FlashOn
    }

    Row(
        modifier
            // Deliberately not the 48dp of an OverlayIcon — this is a chip, not an exit — but
            // still on a target a gloved thumb lands on without aiming.
            .heightIn(min = 44.dp)
            .background(Color(0xB8202124), CircleShape)
            .clickable(onClickLabel = "Change the flash", onClick = onCycle)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        // Null: the label beside it already says the state, and a screen reader announcing it
        // twice is worse than not at all.
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        Text(mode.label, style = WarrantTheme.type.label.copy(color = tint))
    }
}

/**
 * Turn the camera around.
 *
 * The same shape as [FlashChip] and for the same reasons — a 44dp target, a label spelled out
 * beside the glyph, and a tap that toggles rather than a menu that opens. Both are statements
 * about the lens rather than about the work, and both come and go with it.
 *
 * Drawn unconditionally rather than gated on the device actually having two cameras. Every
 * Android handset this app targets has both, and probing `CameraProvider.hasCamera` to hide a
 * chip would trade a real line of code for a case that does not occur. The browser twin DOES
 * gate on it, because a laptop with one webcam is an ordinary thing — see `LensControl` in
 * web/src/components/CameraLayer.tsx.
 */
@Composable
fun LensChip(lens: Lens, onFlip: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .heightIn(min = 44.dp)
            .background(Color(0xB8202124), CircleShape)
            .clickable(onClickLabel = "Turn the camera around", onClick = onFlip)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        // Null: the label beside it already says the state, and a screen reader announcing it
        // twice is worse than not at all.
        Icon(
            Icons.Rounded.Cameraswitch,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(16.dp),
        )
        Text(lens.label, style = WarrantTheme.type.label.copy(color = Color.White))
    }
}

@Composable
private fun BoxScope.Hint(text: String) {
    Text(
        text,
        style = WarrantTheme.type.bodySmall.copy(color = Color.White.copy(alpha = 0.7f)),
        modifier = Modifier.align(Alignment.Center).padding(32.dp),
    )
}

private fun granted(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED

private fun takePhoto(
    context: Context,
    controller: LifecycleCameraController,
    onDone: (File?) -> Unit,
) {
    val dir = File(context.filesDir, "captures").apply { mkdirs() }
    val file = File(dir, "cap_${System.currentTimeMillis()}.jpg")
    val executor: Executor = ContextCompat.getMainExecutor(context)

    controller.takePicture(
        ImageCapture.OutputFileOptions.Builder(file).build(),
        executor,
        object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(output: ImageCapture.OutputFileResults) = onDone(file)
            override fun onError(exception: ImageCaptureException) = onDone(null)
        },
    )
}
