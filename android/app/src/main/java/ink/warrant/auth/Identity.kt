package ink.warrant.auth

import kotlinx.serialization.Serializable

/**
 * Who is signed in, and — the part that actually matters — what tenant that puts them in.
 *
 * From `docs/architecture.md` §7: **the account type decides the shape of the tenant.**
 *
 * | Account | Tenant |
 * |---|---|
 * | Google Workspace — an `hd` claim is present | The DOMAIN is the enterprise. Everyone at `acme.com` shares procedures, jobs, parts and records |
 * | Consumer Google account — no `hd` claim | A SINGLE-USER tenant. Their own procedures, their own jobs |
 *
 * That is the whole model, and the boundary is a natural one: **multiple technicians require
 * Workspace.** A solo operator signs in and starts working; a company with a crew already has a
 * directory, and that directory is the membership list.
 *
 * Offboarding is somebody else's problem and it already works — a technician leaves, their
 * employer disables the account, their access ends the same instant.
 *
 * Serializable because this is exactly what [IdentityStore] keeps between runs — see there for
 * why the profile is persisted and the id token is not. The nullable fields carry defaults so
 * that a record written by an older build still reads; [Identity.subject] and [Identity.email]
 * have none, because a record missing either is not an identity.
 */
@Serializable
data class Identity(
    val subject: String,
    val email: String,
    val displayName: String? = null,
    val photoUrl: String? = null,
    /**
     * The `hd` (hosted domain) claim. Present only on Google Workspace accounts, and its
     * presence is the ONLY thing that distinguishes an enterprise tenant from a personal one.
     */
    val hostedDomain: String? = null,
) {
    /** The domain for Workspace, the subject for a consumer account. Never the email. */
    val tenantId: String get() = hostedDomain ?: "user:$subject"

    val isEnterprise: Boolean get() = hostedDomain != null

    val tenantLabel: String
        get() = hostedDomain ?: "Personal — just you"
}

/**
 * Where the sign-in attempt got to.
 *
 * There is no "restoring" state on purpose: [GoogleAuth] reads the stored identity as it is
 * constructed, so by the time any screen can observe this, the answer is already final. A
 * restore that resolved a frame later would flash the sign-in gate at somebody who is signed
 * in, which is the same bug wearing a nicer coat.
 */
sealed interface AuthState {
    data object SignedOut : AuthState
    data object Working : AuthState
    data class SignedIn(val identity: Identity) : AuthState

    /** Sign-in failed, or was dismissed, or this build has no client id. */
    data class Failed(val reason: String, val configuration: Boolean = false) : AuthState
}
