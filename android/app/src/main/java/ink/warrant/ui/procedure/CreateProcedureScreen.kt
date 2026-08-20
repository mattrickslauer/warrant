package ink.warrant.ui.procedure

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ink.warrant.auth.AuthPurpose
import ink.warrant.auth.GoogleAuth
import ink.warrant.auth.Identity
import ink.warrant.auth.SignInGate
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.ChatTurn
import ink.warrant.ui.components.HoldBanner
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.WarrantButton

/**
 * Authoring a procedure. Behind Google sign-in, and it has to be.
 *
 * Running a public task needs no account — a stranger should be able to make a record in
 * seconds. **Authoring is different**: a procedure governs every future job run against it, so
 * it belongs to a tenant, and there is no tenant without an identity. The `hd` claim on the
 * account decides which kind (`docs/architecture.md` §7), and that decision happens here.
 */
@Composable
fun CreateProcedureScreen(
    auth: GoogleAuth,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SignInGate(auth, AuthPurpose.AUTHOR, onBack, modifier) { identity ->
        ScoperIntro(identity = identity, onBack = onBack)
    }
}

/**
 * What a signed-in author sees.
 *
 * **There is no form builder**, and there is not going to be one. The Scoper conversation IS
 * the authoring interface — less to build and better to use, because a conversation can ask
 * *"what happens if it's seized?"* and a drag-and-drop editor cannot.
 *
 * The Scoper itself is a server-side agent, so this screen currently establishes the tenant and
 * shows the interview it will run. It says so rather than pretending to compile anything.
 */
@Composable
private fun ScoperIntro(identity: Identity, onBack: () -> Unit) {
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim

    Ground(Ground.Work) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(dim.pad),
            verticalArrangement = Arrangement.spacedBy(dim.stack),
        ) {
            MonoLabel("Signed in")
            Text(
                identity.displayName ?: identity.email,
                style = WarrantTheme.type.heading.copy(color = colors.fg),
            )
            Text(
                identity.email,
                style = WarrantTheme.type.mono.copy(color = colors.fg.copy(alpha = 0.7f)),
            )

            Rule()

            MonoLabel("This procedure will belong to")
            Text(identity.tenantLabel, style = WarrantTheme.type.body.copy(color = colors.fg))

            Rule()

            MonoLabel("How authoring works")
            Text(
                "There is no form builder. You describe the job and the Scoper interviews you " +
                    "until it is unambiguous, then compiles and versions a procedure.",
                style = WarrantTheme.type.body.copy(color = colors.fg.copy(alpha = 0.85f)),
            )
            ChatTurn(who = "Scoper", body = "What has to be true before you'd sign this job off?")
            ChatTurn(
                who = "You",
                body = "The caliper bolts have to be torqued to spec.",
                fromMe = true,
            )
            ChatTurn(
                who = "Scoper",
                body = "What happens if the bolt is seized and you can't reach the torque?",
            )

            HoldBanner(
                headline = "Not wired up yet",
                why = "The Scoper runs server side and this build has no network layer. The " +
                    "tenant above is real — it came from your account — but no procedure can " +
                    "be compiled from this screen yet.",
                waiting = true,
            )

            WarrantButton("Back", ghost = true, onClick = onBack, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(24.dp))
        }
    }
}
