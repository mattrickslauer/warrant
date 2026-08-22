package ink.warrant.auth

import android.content.Context
import kotlinx.serialization.json.Json

/**
 * Where a signed-in identity is kept between one run of the app and the next.
 *
 * An interface rather than a bare [android.content.SharedPreferences] call inside [GoogleAuth]
 * for one reason: what happens at start-up is the part that was broken, so it is the part that
 * has to be testable, and a device is a bad place to test start-up.
 */
interface IdentityStore {
    /** The identity from the last successful sign-in, or null if there is none to restore. */
    fun read(): Identity?

    fun write(identity: Identity)

    fun clear()
}

/**
 * The real one: a single JSON string in the app's private preferences.
 *
 * ## What is NOT kept here
 *
 * The **id token is not stored**, deliberately. It expires within the hour, so a stored one is
 * a stale credential that would have to be treated as suspect anyway — and a stale credential
 * on disk is strictly worse than no credential on disk. What is kept is the profile: who this
 * is and, the load-bearing part, which tenant they belong to.
 *
 * That is the right thing to persist for what the app does today, because the account decides
 * what the UI shows and nothing here calls a server yet. When Phase 3 does start making calls,
 * a fresh token comes from a silent Credential Manager request at that moment — not from here.
 * The signed-in state and a live token are two different lifetimes and conflating them is how
 * apps end up signing people out because a network was down.
 *
 * Private app storage, not encrypted: an email address and a display name that the launcher
 * icon already implies, on a device where anything reading app-private storage has already
 * won. Nothing here is a secret.
 */
class PrefsIdentityStore(context: Context) : IdentityStore {

    private val prefs = context.applicationContext
        .getSharedPreferences("ink.warrant.auth", Context.MODE_PRIVATE)

    override fun read(): Identity? = decodeIdentity(prefs.getString(KEY, null).orEmpty())

    override fun write(identity: Identity) {
        prefs.edit().putString(KEY, encodeIdentity(identity)).apply()
    }

    override fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    private companion object {
        const val KEY = "identity"
    }
}

private val json = Json {
    // A record written by an older build must still read, so an added field is not a sign-out
    // for everyone who already had one.
    ignoreUnknownKeys = true
    encodeDefaults = true
}

internal fun encodeIdentity(identity: Identity): String = json.encodeToString(Identity.serializer(), identity)

/**
 * Null for anything that is not a whole identity — empty, truncated, or from a format this
 * build no longer understands.
 *
 * Failing closed is the only safe direction. A partly-decoded identity would put somebody in a
 * tenant, and being put in the wrong tenant is a far worse outcome than being asked to sign in
 * again.
 */
internal fun decodeIdentity(stored: String): Identity? = runCatching {
    json.decodeFromString(Identity.serializer(), stored)
}.getOrNull()
