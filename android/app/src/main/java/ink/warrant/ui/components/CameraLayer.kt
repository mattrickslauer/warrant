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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
 */
@Composable
fun CameraLayer(handle: CameraHandle, modifier: Modifier = Modifier) {
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
            cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
            setEnabledUseCases(LifecycleCameraController.IMAGE_CAPTURE)
        }
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
