package ink.warrant.capture

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.util.Log
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * On-device redaction, before anything leaves the phone.
 *
 * A workshop photograph catches bystanders and number plates that have nothing to do with the
 * job. Masking them in the cloud would mean the unmasked frame had already left the device,
 * which is the one thing this is supposed to prevent — so it runs here, on ML Kit, offline.
 *
 * SCOPE, stated plainly: this masks FACES, using ML Kit's face detector. Number plates are
 * detected by ML Kit's text recogniser in the same pass in a fuller build; today the procedure
 * guidance carries that ("Registration plate out of shot") and the honest position is that
 * plate redaction is not yet implemented. [Redaction.facesFound] is what actually happened, and
 * the record shows it rather than a blanket "redacted" claim.
 *
 * This is NOT Model Armor. Model Armor is a cloud-side guardrail over model input and output —
 * it reads instruction text hidden inside an image. Different problem, different layer.
 */
object Redactor {

    private const val TAG = "Redactor"

    /** Fast over accurate: this runs on every capture, and a missed face is masked coarsely. */
    private val detector by lazy {
        FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
                .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
                .setMinFaceSize(0.05f)
                .build(),
        )
    }

    data class Redaction(
        val file: File,
        val facesFound: Int,
        /**
         * False when detection itself failed. The distinction matters: "nothing to mask" and
         * "we could not look" are different claims, and a record must not conflate them.
         */
        val ran: Boolean,
    )

    /**
     * Masks faces in [source] IN PLACE and returns what happened.
     *
     * In place is deliberate — an unredacted original left on disk is exactly the artifact this
     * is meant not to produce.
     *
     * OFF THE MAIN THREAD, and not as a tidiness point. Decoding a 12MP JPEG, copying it to
     * ARGB_8888, drawing over it and re-compressing it is on the order of a second on a
     * mid-range phone, and this is a `suspend` function that used to do all of it on whatever
     * dispatcher it was called from — which, from a Compose `rememberCoroutineScope`, is the
     * main one. The screen was frozen solid for that second: no frame drawn, no indicator
     * animating, nothing to distinguish "working" from "the app has hung". The caller shows a
     * busy indicator over the frame while this runs, and an indicator that cannot be painted
     * is worse than none — so the work is moved here, once, where it belongs.
     *
     * Default rather than IO: this is bounded CPU work on one frame. The two file touches are
     * a single read and a single write of a few megabytes either side of it.
     */
    suspend fun redactInPlace(source: File): Redaction = withContext(Dispatchers.Default) {
        val bitmap = BitmapFactory.decodeFile(source.absolutePath)
            ?: return@withContext Redaction(source, 0, ran = false)

        val faces = try {
            detect(bitmap)
        } catch (e: Exception) {
            Log.w(TAG, "face detection failed; leaving the capture unmasked and saying so", e)
            bitmap.recycle()
            return@withContext Redaction(source, 0, ran = false)
        }

        if (faces.isEmpty()) {
            bitmap.recycle()
            return@withContext Redaction(source, 0, ran = true)
        }

        val masked = bitmap.copy(Bitmap.Config.ARGB_8888, true)
        bitmap.recycle()
        val canvas = Canvas(masked)
        val paint = Paint().apply {
            color = Color.BLACK
            style = Paint.Style.FILL
            isAntiAlias = false
        }
        // A solid block, not a blur. A blur invites somebody to try to undo it; a block is an
        // honest statement that the pixels are gone.
        faces.forEach { canvas.drawRect(it, paint) }

        FileOutputStream(source).use { out ->
            masked.compress(Bitmap.CompressFormat.JPEG, 92, out)
        }
        masked.recycle()

        Redaction(source, faces.size, ran = true)
    }

    private suspend fun detect(bitmap: Bitmap): List<Rect> =
        suspendCancellableCoroutine { cont ->
            detector.process(InputImage.fromBitmap(bitmap, 0))
                .addOnSuccessListener { faces ->
                    // Pad outward: the bounding box clips ears and chin, and a partly masked
                    // face is not masked.
                    val pad = (minOf(bitmap.width, bitmap.height) * 0.02f).toInt()
                    cont.resume(
                        faces.map { f ->
                            Rect(
                                (f.boundingBox.left - pad).coerceAtLeast(0),
                                (f.boundingBox.top - pad).coerceAtLeast(0),
                                (f.boundingBox.right + pad).coerceAtMost(bitmap.width),
                                (f.boundingBox.bottom + pad).coerceAtMost(bitmap.height),
                            )
                        },
                    )
                }
                .addOnFailureListener { cont.resumeWithException(it) }
        }
}
