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
 *
 * ## Signing in once means once
 *
 * Android kills this process routinely — the moment another app wants the camera, when the
 * battery saver decides, or simply overnight. Sign-in therefore CANNOT live only in memory, or
 * a technician meets the gate again at random and the account stops feeling like an account.
 *
 * So the identity goes to [store] on success and comes back out of it here, in the constructor,
 * before any screen exists to observe the wrong answer. [store] is a parameter rather than a
 * `SharedPreferences` call inline because start-up is precisely the behaviour worth testing.
 */
class GoogleAuth(
    private val store: IdentityStore,
    private val clientIdOf: () -> String,
) {

    constructor(context: Context) : this(
        PrefsIdentityStore(context),
        { context.getString(R.string.google_web_client_id).trim() },
    )

    companion object {
        private const val TAG = "GoogleAuth"
    }

    // Read eagerly, not in a coroutine: see the note on [AuthState] about flashing the gate.
    // It is one small file in app-private storage, read once per process.
    private val _state = MutableStateFlow<AuthState>(
        store.read()?.let(AuthState::SignedIn) ?: AuthState.SignedOut,
    )
    val state: StateFlow<AuthState> = _state.asStateFlow()

    private val clientId: String get() = clientIdOf()

    /**
     * What to do with Google's token once it has been obtained.
     *
     * A Google ID token proves who somebody is to Google and means NOTHING to Firestore, whose
     * rules authorise against a Firebase token. So the exchange has to happen before any read
     * is attempted, or every read is unauthenticated and correctly refused.
     *
     * A property rather than a constructor parameter because the exchange needs an [Api], and
     * an [Api] needs configuration this class has no business knowing about. Null in a fixture
     * build, where there is nothing to exchange with.
     */
    var onGoogleToken: (suspend (String, Identity) -> Unit)? = null

    /** Called on sign-out, to end the Firebase session as well as this one. */
    var onSignOut: (() -> Unit)? = null

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
                val identity = identityFrom(token)

                // Before the state changes. A screen that showed a signed-in technician while
                // Firestore still refused every read would look like an app that lost their
                // data, not like an exchange that had not happened yet.
                //
                // A failure here is not fatal: the identity is real and the local tenant is
                // correct for a consumer account. It is logged and the person is let in,
                // because a technician standing at a machine with a working camera should not
                // be stopped by a claim service.
                runCatching { onGoogleToken?.invoke(token.idToken, identity) }
                    .onFailure { Log.w(TAG, "Firebase exchange failed; continuing local", it) }

                // Written before the state changes, so a process death in the same instant
                // cannot leave a screen showing somebody who is not on disk.
                store.write(identity)
                AuthState.SignedIn(identity)
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

    /**
     * Signing out has to stick across a restart too — otherwise the stored identity simply
     * signs them back in on the next launch, which is the same bug pointed the other way.
     *
     * The credential provider's own state is left alone deliberately: sign-in asks with
     * `setFilterByAuthorizedAccounts(false)` and no auto-select, so the account chooser always
     * appears and there is nothing here that would silently pick the account just abandoned.
     */
    fun signOut() {
        // Firebase first. Leaving that session behind would leave a client that still passes
        // signedIn() in firestore.rules after the person believes they have gone.
        runCatching { onSignOut?.invoke() }
        store.clear()
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
