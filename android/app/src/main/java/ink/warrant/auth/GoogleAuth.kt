package ink.warrant.auth

import android.content.Context
import android.util.Base64
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import ink.warrant.R
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/**
 * Sign in with Google, and nothing else.
 *
 * Uses Credential Manager, which is the supported path on Android 14 and the compatibility
 * path below it. There is no username, no password, and no account creation of our own — the
 * whole identity model rests on the fact that the employer already runs the directory.
 *
 * ## This build needs a client id
 *
 * [R.string.google_web_client_id] is empty by default, because a client id is per-project and
 * belongs to whoever deploys this. Until it is set, [signIn] fails with
 * [AuthState.Failed.configuration] true and the gate says exactly what is missing rather than
 * showing a button that cannot work.
 *
 * To fill it in: Google Cloud console → APIs & Services → Credentials → create an **OAuth
 * client ID of type Web application** (not Android — Credential Manager wants the web client
 * id), then put the value in `res/values/auth.xml`. An Android OAuth client for this package
 * and signing certificate must also exist in the same project.
 */
class GoogleAuth(private val context: Context) {

    companion object {
        private const val TAG = "GoogleAuth"
    }

    private val _state = MutableStateFlow<AuthState>(AuthState.SignedOut)
    val state: StateFlow<AuthState> = _state.asStateFlow()

    private val clientId: String
        get() = context.getString(R.string.google_web_client_id).trim()

    val isConfigured: Boolean get() = clientId.isNotEmpty()

    /**
     * [activityContext] must be an Activity — Credential Manager shows UI, so an application
     * context silently fails.
     */
    suspend fun signIn(activityContext: Context) {
        if (!isConfigured) {
            _state.value = AuthState.Failed(
                "This build has no Google client id. Set google_web_client_id in " +
                    "res/values/auth.xml — see GoogleAuth for where to get one.",
                configuration = true,
            )
            return
        }

        _state.value = AuthState.Working
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(
                GetGoogleIdOption.Builder()
                    .setServerClientId(clientId)
                    // False so a first-time user sees every account, not an empty sheet.
                    .setFilterByAuthorizedAccounts(false)
                    .build(),
            )
            .build()

        _state.value = try {
            val response = CredentialManager.create(activityContext)
                .getCredential(activityContext, request)
            val credential = response.credential
            if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                val token = GoogleIdTokenCredential.createFrom(credential.data)
                AuthState.SignedIn(identityFrom(token))
            } else {
                AuthState.Failed("Signed in, but not with a Google account.")
            }
        } catch (e: GetCredentialCancellationException) {
            AuthState.SignedOut
        } catch (e: NoCredentialException) {
            AuthState.Failed("No Google account on this device.")
        } catch (e: GetCredentialException) {
            Log.w(TAG, "sign-in failed", e)
            AuthState.Failed(e.message ?: "Sign-in failed.")
        }
    }

    fun signOut() {
        _state.value = AuthState.SignedOut
    }

    private fun identityFrom(token: GoogleIdTokenCredential): Identity {
        // The hd claim is not exposed on GoogleIdTokenCredential, so it is read from the JWT
        // payload. This is NOT verification — the token is verified server side before it is
        // trusted for anything. Here it only decides which tenant to show, and a forged hd
        // would buy a liar nothing but a wrong label on their own screen.
        val hd = claim(token.idToken, "hd")
        return Identity(
            subject = claim(token.idToken, "sub") ?: token.id,
            email = token.id,
            displayName = token.displayName ?: token.givenName,
            photoUrl = token.profilePictureUri?.toString(),
            hostedDomain = hd,
        )
    }

    /** Reads one claim out of a JWT payload without validating the signature. See above. */
    private fun claim(jwt: String, name: String): String? = runCatching {
        val payload = jwt.split(".").getOrNull(1) ?: return null
        val json = String(
            Base64.decode(payload, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP),
        )
        JSONObject(json).optString(name).takeIf { it.isNotBlank() }
    }.getOrNull()
}
