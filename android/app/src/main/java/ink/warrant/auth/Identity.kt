package ink.warrant.auth

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
 */
data class Identity(
    val subject: String,
    val email: String,
    val displayName: String?,
    val photoUrl: String?,
    /**
     * The `hd` (hosted domain) claim. Present only on Google Workspace accounts, and its
     * presence is the ONLY thing that distinguishes an enterprise tenant from a personal one.
     */
    val hostedDomain: String?,
) {
    /** The domain for Workspace, the subject for a consumer account. Never the email. */
    val tenantId: String get() = hostedDomain ?: "user:$subject"

    val isEnterprise: Boolean get() = hostedDomain != null

    val tenantLabel: String
        get() = hostedDomain ?: "Personal — just you"
}

/** Where the sign-in attempt got to. */
sealed interface AuthState {
    data object Unknown : AuthState
    data object SignedOut : AuthState
    data object Working : AuthState
    data class SignedIn(val identity: Identity) : AuthState

    /** Sign-in failed, or was dismissed, or this build has no client id. */
    data class Failed(val reason: String, val configuration: Boolean = false) : AuthState
}
