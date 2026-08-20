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
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import ink.warrant.design.WarrantTheme
import java.io.File
import java.util.concurrent.Executor

/** What the tile is doing right now. */
sealed interface CaptureState {
    data object NeedsPermission : CaptureState
    data object Denied : CaptureState
    data object Live : CaptureState
    data class Filled(val file: File) : CaptureState
}

/**
 * The capture surface. A live camera, a prompt on the frame, and a shutter that never moves.
 *
 * Two decisions here are load-bearing:
 *
 *  1. **The prompt sits ON the frame.** What you are being asked for and what the lens can see
 *     are the same question, so they are in the same place.
 *  2. **The shutter is bottom-right on every step, at 60dp, always.** A technician with dirty
 *     hands should never have to aim, and a button that moves between steps is a button you
 *     have to look for.
 *
 * The capture returns as soon as the file is written. Nothing here waits on a model — the
 * verdict arrives later, on the job, and is fixable from wherever the person has got to.
 */
@Composable
fun CaptureTile(
    prompt: String,
    onCaptured: (File) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val colors = WarrantTheme.colors

    var state by remember { mutableStateOf<CaptureState>(resolveInitial(context)) }
    var busy by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> state = if (granted) CaptureState.Live else CaptureState.Denied }

    LaunchedEffect(Unit) {
        if (state is CaptureState.NeedsPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    val controller = remember {
        LifecycleCameraController(context).apply {
            cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
            setEnabledUseCases(LifecycleCameraController.IMAGE_CAPTURE)
        }
    }

    DisposableEffect(lifecycleOwner, state) {
        if (state is CaptureState.Live) controller.bindToLifecycle(lifecycleOwner)
        onDispose { controller.unbind() }
    }

    Box(
        modifier
            .fillMaxWidth()
            .aspectRatio(4f / 3f)
            .clip(RoundedCornerShape(WarrantTheme.dim.rLg))
            .background(colors.surface, RoundedCornerShape(WarrantTheme.dim.rLg))
            .border(
                width = 1.dp,
                color = when (state) {
                    is CaptureState.Live -> colors.measured
                    is CaptureState.Filled -> colors.hairline
                    else -> colors.hairline
                },
                shape = RoundedCornerShape(WarrantTheme.dim.rLg),
            ),
    ) {
        when (val s = state) {
            is CaptureState.Live -> {
                AndroidView(
                    factory = { ctx ->
                        PreviewView(ctx).apply {
                            scaleType = PreviewView.ScaleType.FILL_CENTER
                            // COMPATIBLE backs the preview with a TextureView. PERFORMANCE
                            // uses a SurfaceView, which Compose does not clip — it painted
                            // straight over the field prompt and the evidence chip above the
                            // tile, which is how this was found.
                            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                            this.controller = controller
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
                FramePrompt(prompt)
                LiveMark()
                Shutter(
                    enabled = enabled && !busy,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(14.dp),
                    onClick = {
                        busy = true
                        takePhoto(context, controller) { file ->
                            busy = false
                            if (file != null) {
                                state = CaptureState.Filled(file)
                                onCaptured(file)
                            }
                        }
                    },
                )
            }

            is CaptureState.Filled -> {
                val bitmap = remember(s.file) {
                    android.graphics.BitmapFactory.decodeFile(s.file.absolutePath)
                }
                if (bitmap != null) {
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = prompt,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
                Row(
                    Modifier.align(Alignment.BottomStart).padding(10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    WarrantButton(
                        "Retake",
                        ghost = true,
                        onClick = { state = CaptureState.Live },
                    )
                }
            }

            is CaptureState.Denied -> Hint(
                "No camera permission. Evidence can still be recorded by stating what you saw " +
                    "— it will be an assertion, not a photograph.",
            )

            is CaptureState.NeedsPermission -> Hint("Waiting for camera permission…")
        }
    }
}

@Composable
private fun BoxScope.FramePrompt(prompt: String) {
    Text(
        prompt,
        style = WarrantTheme.type.bodySmall.copy(color = Color.White),
        modifier = Modifier
            .align(Alignment.TopStart)
            .padding(12.dp)
            .background(Color(0xB8202124), RoundedCornerShape(WarrantTheme.dim.rSm))
            .padding(horizontal = 14.dp, vertical = 10.dp),
    )
}

@Composable
private fun BoxScope.LiveMark() {
    Row(
        Modifier
            .align(Alignment.BottomStart)
            .padding(start = 16.dp, bottom = 18.dp)
            .background(Color(0xB8202124), CircleShape)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(Modifier.size(8.dp).background(WarrantTheme.colors.measured, CircleShape))
        // "live" is a claim about provenance, not a decoration: a frame grabbed from an open
        // stream here and now is a different thing from an uploaded file, and the record
        // records which one it was.
        Text("Live", style = WarrantTheme.type.label.copy(color = Color.White))
    }
}

@Composable
private fun Shutter(enabled: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .size(64.dp)
            .border(3.dp, Color.White, CircleShape)
            .padding(6.dp)
            .background(
                if (enabled) Color.White else Color(0x66FFFFFF),
                CircleShape,
            )
            .let { if (enabled) it.clickable(onClick = onClick) else it },
    )
}

@Composable
private fun BoxScope.Hint(text: String) {
    Column(
        Modifier.align(Alignment.Center).padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text,
            style = WarrantTheme.type.bodySmall.copy(
                color = WarrantTheme.colors.fg.copy(alpha = 0.6f),
            ),
        )
    }
}

private fun resolveInitial(context: Context): CaptureState =
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
        == PackageManager.PERMISSION_GRANTED
    ) {
        CaptureState.Live
    } else {
        CaptureState.NeedsPermission
    }

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
