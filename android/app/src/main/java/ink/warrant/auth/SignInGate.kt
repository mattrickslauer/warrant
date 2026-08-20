package ink.warrant.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.HoldBanner
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.WarrantButton
import kotlinx.coroutines.launch

/**
 * Why this particular screen is asking.
 *
 * Every gate in the app is the same screen, and the only thing that differs is the sentence
 * explaining what you are about to be let into. That sentence matters more than it looks:
 * "sign in to continue" with no object is how an app teaches people to sign in reflexively,
 * and the whole identity model here rests on the account meaning something specific.
 */
enum class AuthPurpose(val label: String, val why: String) {
    AUTHOR(
        "Create a procedure",
        "Running a procedure needs no account. Authoring one does — a procedure governs " +
            "every job that is ever run against it, so it has to belong to somebody.",
    ),
    ACCOUNT(
        "Account",
        "There is nothing to show until you sign in. Your account is what decides which " +
            "tenant your procedures, jobs and records belong to.",
    ),
}

/**
 * Shows [content] only to a signed-in person; otherwise explains what is needed and why.
 *
 * The gate is a screen rather than a dialog on purpose: being asked to sign in is a real fork
 * in the road, and a modal over a screen you cannot use is a worse way to say so.
 *
 * It lives in `auth` rather than inside any one screen because there are three doors to it
 * now — authoring, the account row, and the drawer's sign-in — and a gate that is copied per
 * caller is a gate whose copies disagree about what an account is for.
 */
@Composable
fun SignInGate(
    auth: GoogleAuth,
    purpose: AuthPurpose,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable (Identity) -> Unit,
) {
    val state by auth.state.collectAsState()
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim
    val scope = rememberCoroutineScope()
    // Credential Manager needs the Activity context — an application context shows no UI.
    val activityContext = LocalContext.current

    if (state is AuthState.SignedIn) {
        content((state as AuthState.SignedIn).identity)
        return
    }

    Ground(Ground.Work, modifier) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(dim.pad),
            verticalArrangement = Arrangement.spacedBy(dim.stack),
        ) {
            MonoLabel(purpose.label)
            Text("Sign in to continue", style = WarrantTheme.type.heading.copy(color = colors.fg))
            Text(
                purpose.why,
                style = WarrantTheme.type.body.copy(color = colors.fg.copy(alpha = 0.8f)),
            )

            Rule()

            MonoLabel("What your account decides")
            Text(
                "A Google Workspace account puts you in your organisation's tenant — everyone " +
                    "at your domain shares procedures, jobs, parts and records. A personal " +
                    "Google account gets a tenant of one.",
                style = WarrantTheme.type.bodySmall.copy(color = colors.fg.copy(alpha = 0.72f)),
            )
            Text(
                "Offboarding comes free: when an employer disables an account, that person's " +
                    "access ends the same instant.",
                style = WarrantTheme.type.bodySmall.copy(color = colors.fg.copy(alpha = 0.72f)),
            )

            when (val s = state) {
                is AuthState.Working -> Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.height(18.dp),
                        color = colors.measured,
                        strokeWidth = 2.dp,
                    )
                    MonoLabel("Waiting for Google")
                }

                is AuthState.Failed -> HoldBanner(
                    headline = if (s.configuration) "Sign-in not configured" else "Sign-in failed",
                    why = s.reason,
                    waiting = s.configuration,
                )

                else -> Unit
            }

            Spacer(Modifier.height(4.dp))

            // There is no sign-up button, because there is no account of ours to create. The
            // first successful sign-in is what brings the tenant into existence.
            WarrantButton(
                "Continue with Google",
                enabled = state !is AuthState.Working,
                onClick = { scope.launch { auth.signIn(activityContext) } },
                modifier = Modifier.fillMaxWidth(),
            )
            WarrantButton("Back", ghost = true, onClick = onBack, modifier = Modifier.fillMaxWidth())

            Spacer(Modifier.height(24.dp))
        }
    }
}
