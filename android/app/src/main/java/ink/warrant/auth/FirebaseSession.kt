package ink.warrant.auth

import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.google.firebase.auth.GoogleAuthProvider
import ink.warrant.net.Api
import kotlinx.coroutines.tasks.await

/**
 * The step between "signed in with Google" and "allowed to read anything".
 *
 * [GoogleAuth] gets a Google ID token through Credential Manager. That token proves who
 * somebody is to Google, and means nothing at all to Firestore. `firestore.rules` authorises
 * against a FIREBASE token, so the Google one has to be exchanged for one — and until it has
 * been, every read the phone makes is an unauthenticated read that the rules correctly refuse.
 *
 * ## Why there is a second round trip
 *
 * Firebase does not propagate Google's `hd` claim into its own ID token. `tenantOf()` in
 * firestore.rules reads `hd` and falls back to `u:<uid>`, so a Workspace technician whose
 * claim has never been written resolves to a personal tenant of one: signed in, authorised,
 * and looking at an empty account instead of their employer's work. That failure is
 * particularly nasty because nothing errors.
 *
 * So the server verifies Google's token against Google's certificates and writes the custom
 * claim, and the phone then forces a token refresh to pick it up. A client cannot write its
 * own claim, which is exactly the property that makes the claim worth reading.
 *
 * On a consumer account there is no `hd` and the tenant is `u:<uid>` either way — the exchange
 * still runs, because it is also what provisions the tenant and the membership record.
 */
class FirebaseSession(
    private val api: Api,
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
) {

    companion object {
        private const val TAG = "FirebaseSession"
    }

    /** The signed-in Firebase uid, or null. Firestore reads are refused without one. */
    val uid: String? get() = auth.currentUser?.uid

    val isSignedIn: Boolean get() = auth.currentUser != null

    val isAnonymous: Boolean get() = auth.currentUser?.isAnonymous == true

    /**
     * There must ALWAYS be a Firebase user before Firestore is touched.
     *
     * `firestore.rules` refuses everything to `request.auth == null`, and a rejected listen is
     * not a quiet empty result — Firestore's async queue rethrows it on the main thread and
     * the app dies. So a signed-out launch that reads anything is a crash, not an empty screen.
     *
     * Anonymous is the right answer rather than a workaround. Running a public task needs no
     * account — that is a product decision, and `isAnonymous()` in firestore.rules exists to
     * serve it, giving a stranger the tenant `anon:<uid>` of their own. Signing in with Google
     * later LINKS to this same uid, so the work they did before signing in comes with them.
     *
     * Idempotent and cheap: it checks for a user before asking for one.
     */
    suspend fun ensureSignedIn(): String? {
        auth.currentUser?.let { return it.uid }
        return runCatching { auth.signInAnonymously().await().user?.uid }
            .onFailure { Log.w(TAG, "anonymous sign-in failed; Firestore will refuse reads", it) }
            .getOrNull()
    }

    /**
     * The tenant this session resolves to, computed the way `tenantOf()` in firestore.rules
     * computes it.
     *
     * These are the same rule written twice, and a divergence between them is not a cosmetic
     * bug: the phone would read one tenant's path while the rules authorised another, and
     * every read would be refused for reasons no screen could explain.
     */
    fun tenantId(hostedDomain: String? = null): String {
        if (!hostedDomain.isNullOrBlank()) return hostedDomain
        val user = auth.currentUser ?: return "anon:unknown"
        return if (user.isAnonymous) "anon:${user.uid}" else "u:${user.uid}"
    }

    /**
     * Exchange a Google ID token for a Firebase session.
     *
     * Returns the tenant this identity resolves to, so a caller can show it without guessing.
     * Throws on failure rather than returning null: a screen that quietly continued without a
     * Firebase user would show an empty account and no reason for it.
     */
    suspend fun signIn(googleIdToken: String, identity: Identity): String {
        val credential = GoogleAuthProvider.getCredential(googleIdToken, null)
        val existing = auth.currentUser

        // LINK rather than replace when the current user is anonymous. The uid is preserved,
        // so a stranger who ran a public task and then decided to sign in keeps the record
        // they just made. Signing in fresh would strand it in a tenant nobody can reach again.
        val result = if (existing != null && existing.isAnonymous) {
            runCatching { existing.linkWithCredential(credential).await() }
                .recoverCatching { error ->
                    // The Google account is already a Firebase user. Their real account wins;
                    // the empty anonymous one is what gets abandoned.
                    if (error is FirebaseAuthUserCollisionException) {
                        auth.signInWithCredential(credential).await()
                    } else {
                        throw error
                    }
                }
                .getOrThrow()
        } else {
            auth.signInWithCredential(credential).await()
        }

        val user = result.user ?: error("Firebase accepted the credential and returned no user.")

        // Best effort. A Workspace account NEEDS this; a consumer account does not, and a
        // technician on a bad connection should not be locked out of their own personal
        // tenant because the claim service was unreachable.
        if (api.isConfigured) {
            runCatching {
                val firebaseToken = user.getIdToken(false).await().token
                if (firebaseToken != null) {
                    if (api.exchangeSession(firebaseToken, googleIdToken)) {
                        // Force refresh, or the claim just written is not in the token this
                        // client is holding and every rule still sees the old tenant.
                        user.getIdToken(true).await()
                    }
                }
            }.onFailure { Log.w(TAG, "tenant claim exchange failed; using the local tenant", it) }
        }

        return tenantId(identity.hostedDomain)
    }

    /** The current Firebase ID token, for the few calls that go to our own server. */
    suspend fun idToken(): String? =
        auth.currentUser?.let { runCatching { it.getIdToken(false).await().token }.getOrNull() }

    /**
     * Signing out of Firebase as well as of the app.
     *
     * Leaving the Firebase user behind would leave a client that still passes `signedIn()` in
     * firestore.rules after the person believes they have gone.
     */
    fun signOut() {
        runCatching { auth.signOut() }
    }
}
