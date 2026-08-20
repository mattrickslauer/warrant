package ink.warrant.ui.components

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import ink.warrant.contract.ReasonKind
import ink.warrant.design.WarrantTheme
import java.io.File

/**
 * The second exit.
 *
 * Every step has two ways out: satisfy it, or say why you cannot. There is no third, and
 * critically there is no SKIP — a skip is a hole in the record that looks like nothing
 * happened, when in fact something did and nobody wrote it down.
 *
 * So this is never styled as a failure and never buried behind a menu. It sits on every step
 * next to the capture button. What comes out of it is an *asserted* outcome: a named human
 * said this, at this time, in their own words — which is a weaker claim than a measurement and
 * an infinitely stronger one than an empty field.
 *
 * Hold to speak, or type. Speaking wins in a workshop, where hands are full and dirty.
 */
@Composable
fun ReasonCapture(
    onSubmit: (kind: ReasonKind, transcript: String, audio: File?) -> Unit,
    modifier: Modifier = Modifier,
    /** The Instructor's answer, once it arrives. Null until then. */
    recommendation: String? = null,
) {
    val context = LocalContext.current
    val colors = WarrantTheme.colors
    val type = WarrantTheme.type

    var typing by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    var recording by remember { mutableStateOf(false) }
    var recorder by remember { mutableStateOf<MediaRecorder?>(null) }
    var audioFile by remember { mutableStateOf<File?>(null) }

    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (!granted) typing = true }

    // A recorder left running when the screen goes away keeps the microphone open. It must not.
    DisposableEffect(Unit) {
        onDispose {
            runCatching { recorder?.stop() }
            recorder?.release()
        }
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (typing) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 96.dp)
                    .background(colors.surface, RoundedCornerShape(WarrantTheme.dim.radius))
                    .border(
                        1.dp,
                        colors.fg.copy(alpha = 0.14f),
                        RoundedCornerShape(WarrantTheme.dim.radius),
                    )
                    .padding(12.dp),
            ) {
                if (text.isEmpty()) {
                    Text(
                        "Why can't this step be done?",
                        style = type.body.copy(color = colors.fg.copy(alpha = 0.45f)),
                    )
                }
                BasicTextField(
                    value = text,
                    onValueChange = { text = it },
                    textStyle = type.body.copy(color = colors.fg),
                    cursorBrush = SolidColor(colors.asserted),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            WarrantButton(
                "Record the reason",
                enabled = text.isNotBlank(),
                onClick = { onSubmit(ReasonKind.TEXT, text.trim(), null) },
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            // Hold to speak. Press-and-hold rather than tap-to-start/tap-to-stop, because a
            // held button cannot be left recording by accident.
            Column(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 96.dp)
                    .background(
                        if (recording) colors.asserted.copy(alpha = 0.12f) else colors.bg,
                        RoundedCornerShape(WarrantTheme.dim.radius),
                    )
                    .border(1.dp, colors.asserted, RoundedCornerShape(WarrantTheme.dim.radius))
                    .pointerInput(Unit) {
                        detectTapGestures(
                            onPress = {
                                if (!hasMic(context)) {
                                    micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                    return@detectTapGestures
                                }
                                val started = startRecording(context)
                                if (started == null) {
                                    typing = true
                                    return@detectTapGestures
                                }
                                recorder = started.first
                                audioFile = started.second
                                recording = true

                                tryAwaitRelease()

                                recording = false
                                val f = stopRecording(recorder)
                                recorder = null
                                if (f != null || audioFile != null) {
                                    // Speech-to-text runs server side; until the transcript
                                    // comes back the record carries the audio and says so
                                    // rather than inventing words the person did not say.
                                    onSubmit(
                                        ReasonKind.VOICE,
                                        "Spoken reason recorded — awaiting transcription.",
                                        audioFile,
                                    )
                                }
                            },
                        )
                    }
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.size(10.dp).background(colors.asserted, CircleShape))
                Text(
                    if (recording) "RECORDING — RELEASE TO STOP" else "HOLD TO SAY WHY",
                    style = type.monoLabel.copy(color = colors.asserted),
                )
            }

            Text(
                "or type it instead",
                style = type.monoLabel.copy(color = colors.fg.copy(alpha = 0.6f)),
                modifier = Modifier
                    .padding(vertical = 6.dp)
                    .pointerInput(Unit) { detectTapGestures { typing = true } },
            )
        }

        if (recommendation != null) {
            ChatTurn(who = "Instructor", body = recommendation)
        }
    }
}

private fun hasMic(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED

private fun startRecording(context: Context): Pair<MediaRecorder, File>? = runCatching {
    val dir = File(context.filesDir, "reasons").apply { mkdirs() }
    val file = File(dir, "reason_${System.currentTimeMillis()}.m4a")
    val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        MediaRecorder(context)
    } else {
        @Suppress("DEPRECATION")
        MediaRecorder()
    }
    rec.setAudioSource(MediaRecorder.AudioSource.MIC)
    rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
    rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
    rec.setOutputFile(file.absolutePath)
    rec.prepare()
    rec.start()
    rec to file
}.getOrNull()

private fun stopRecording(recorder: MediaRecorder?): File? {
    recorder ?: return null
    runCatching { recorder.stop() }
    recorder.release()
    return null
}
