package ink.warrant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ink.warrant.auth.AuthState
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.shell.Dest
import ink.warrant.ui.shell.QuickAction
import ink.warrant.ui.shell.Reach
import ink.warrant.ui.shell.quickActions

/**
 * The short list under the carousel.
 *
 * The menu is behind a hamburger, which is the right place for navigation and the wrong place
 * for the three things a person actually does on their second visit. These are those three,
 * on the surface, one tap from where the app opens.
 *
 * A row needing an account says so and still goes somewhere: tapping it lands on the sign-in
 * gate for that destination, which explains what the account is for and then drops you on the
 * screen you asked for. A row that greys out and swallows the tap teaches people that the
 * app is broken; a row that names its price teaches them what an account means here.
 */
@Composable
fun QuickActions(
    auth: AuthState,
    onNavigate: (Dest) -> Unit,
    modifier: Modifier = Modifier,
) {
    val dim = WarrantTheme.dim

    Column(
        modifier.fillMaxWidth().padding(horizontal = dim.pad),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        MonoLabel("Or", modifier = Modifier.padding(bottom = 2.dp))
        quickActions(auth).forEach { action ->
            QuickActionRow(action = action, onClick = { onNavigate(action.dest) })
        }
    }
}

/**
 * One row: what it does, why you would, and what it costs.
 *
 * Tonal surface rather than a hairline list, so the group reads as a set of controls sitting
 * *under* the cards rather than as a menu that leaked onto the home screen.
 */
@Composable
private fun QuickActionRow(action: QuickAction, onClick: () -> Unit) {
    val colors = WarrantTheme.colors
    val shape = RoundedCornerShape(WarrantTheme.dim.rMd)
    // Dim, but never so dim it stops being an invitation — this row is how somebody finds out
    // what an account is for, so it has to stay readable while it says "not yet".
    val alpha = if (action.reach == Reach.OPEN) 1f else 0.66f

    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = WarrantTheme.dim.tap)
            .clip(shape)
            .background(colors.surface)
            .clickable(enabled = action.enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // One line each, ellipsised rather than wrapped. Four two-line rows was what pushed
        // the carousel card off the bottom of the screen — and a hint that wraps is a hint
        // that was too long to be a hint.
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                action.label,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = WarrantTheme.type.label.copy(color = colors.fg.copy(alpha = alpha)),
            )
            Text(
                action.hint,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = WarrantTheme.type.bodySmall.copy(
                    color = colors.fg.copy(alpha = alpha * 0.7f),
                ),
            )
        }
        when (action.reach) {
            Reach.NEEDS_ACCOUNT -> MonoLabel("sign in", color = colors.fg3)
            Reach.SOON -> MonoLabel("soon", color = colors.fg3)
            Reach.OPEN -> Unit
        }
    }
}
