package ink.warrant.capture

import android.content.Context
import android.util.Log
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import kotlinx.coroutines.tasks.await

/**
 * What this device can say about itself — which is nothing anybody has to take on trust.
 *
 * The token this returns is OPAQUE. This app cannot read it, cannot alter it, and gains
 * nothing by lying about it, because the server decodes it with Google and writes the verdict
 * itself. `firestore.rules` refuses attestation fields from every client, so there is no path
 * by which a phone can claim to be attested.
 *
 * ## It will usually fail, and that is fine
 *
 * Play Integrity answers for apps installed from Google Play. A sideloaded demo build, an
 * emulator, or a device with no Play Services gets an error rather than a token — which is
 * the honest answer, and the record says `UNATTESTED` rather than pretending.
 *
 * That distinction is the tier ceiling doing its job: an unattested capture is still real
 * evidence, it simply cannot reach the classes that require a trusted device. Nothing here
 * blocks a technician from working.
 */
object Attestation {

    private const val TAG = "Attestation"

    /**
     * A token for this capture, or null.
     *
     * [requestHash] binds the token to the thing being attested, so a token minted for one
     * capture cannot be replayed against another. Without it an attacker could attest once on
     * a genuine device and attach that answer to every later fabrication.
     */
    suspend fun token(context: Context, requestHash: String): String? = runCatching {
        val manager = IntegrityManagerFactory.create(context.applicationContext)
        manager.requestIntegrityToken(
            IntegrityTokenRequest.builder().setNonce(requestHash).build(),
        ).await().token()
    }.onFailure {
        // Info, not warning. On every build that is not from Play this is the expected path,
        // and logging it as a problem would train everyone to ignore the log.
        Log.i(TAG, "no integrity token on this build; the capture records UNATTESTED", it)
    }.getOrNull()
}
