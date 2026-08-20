package ink.warrant.ui.account

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
import ink.warrant.auth.SignInGate
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.WarrantButton

/**
 * Who you are signed in as, and — the part that actually matters — what tenant that puts you in.
 *
 * This screen is where the tenant explanation lives now. It used to be duplicated on the
 * authoring screen, which meant two copies of the one rule that decides who can see what.
 */
@Composable
fun AccountScreen(
    auth: GoogleAuth,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SignInGate(auth, AuthPurpose.ACCOUNT, onBack, modifier) { identity ->
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
                // Mono: the address came from Google, not from anything typed here.
                Text(
                    identity.email,
                    style = WarrantTheme.type.mono.copy(color = colors.fg2),
                )

                Rule()

                MonoLabel("Tenant")
                Text(identity.tenantLabel, style = WarrantTheme.type.body.copy(color = colors.fg))
                Text(
                    if (identity.isEnterprise) {
                        "A Workspace domain, so procedures you author here are your " +
                            "organisation's. Multiple technicians work under this tenant."
                    } else {
                        "A personal Google account, so this is a tenant of one. Adding " +
                            "technicians needs Workspace — their directory is the membership list."
                    },
                    style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
                )
                Text(
                    "Offboarding is your directory's job and it already works: disable the " +
                        "account and this access ends the same instant.",
                    style = WarrantTheme.type.bodySmall.copy(color = colors.fg3),
                )

                Rule()

                // Signing out drops the identity held in memory. It does not revoke anything
                // at Google, and it does not touch a record that was already sealed — that is
                // the point of sealing.
                WarrantButton(
                    "Sign out",
                    ghost = true,
                    onClick = { auth.signOut() },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}
