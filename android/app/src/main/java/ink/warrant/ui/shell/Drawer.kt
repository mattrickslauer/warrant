package ink.warrant.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ink.warrant.auth.AuthState
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.WarrantButton

/**
 * The menu.
 *
 * Grouped by the role a person is in — work, author, operate — rather than flattened into
 * seven equal rows, because almost nobody is in more than one of those roles at a time and a
 * flat list makes you read all seven to find your two.
 *
 * Signed out, the list does not change shape. The rows that need an account stay where they
 * are, dim, labelled, and still tappable — each one leads to the same sign-in gate, which then
 * lands you on the screen you asked for rather than back at the beginning.
 */
@Composable
fun DrawerBody(
    current: Dest,
    auth: AuthState,
    onNavigate: (Dest) -> Unit,
    onClose: () -> Unit,
) {
    val colors = WarrantTheme.colors
    val identity = (auth as? AuthState.SignedIn)?.identity

    Column(Modifier.fillMaxSize().background(colors.bg)) {

        // The same 48dp bar the screen behind it has, so the ☰ does not move when the drawer
        // opens — it is the same button, and it now closes what it opened.
        Row(
            Modifier.fillMaxWidth().height(WarrantTheme.dim.tap),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(WarrantTheme.dim.tap).clickable(onClick = onClose),
                contentAlignment = Alignment.Center,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    repeat(3) { Box(Modifier.width(18.dp).height(2.dp).background(colors.fg)) }
                }
            }
            MonoLabel("Warrant", color = colors.fg)
        }
        Rule()

        menu(auth).forEach { section ->
            MonoLabel(
                section.title,
                modifier = Modifier.padding(
                    start = WarrantTheme.dim.pad,
                    top = 18.dp,
                    bottom = 6.dp,
                ),
            )
            section.items.forEach { item ->
                MenuRow(
                    item = item,
                    current = item.dest == current,
                    onClick = { onNavigate(item.dest) },
                )
            }
        }

        if (identity == null) {
            // Signed out: the invitation stands in the free space rather than sitting at the
            // bottom, because it is the only thing down there and a lone button pinned to a
            // corner reads as an afterthought.
            Column(
                Modifier.weight(1f).fillMaxWidth().padding(horizontal = WarrantTheme.dim.pad),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "Running a procedure needs no account. Anything that belongs to " +
                        "somebody does.",
                    style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(14.dp))
                // One button, not two: with Google there is no separate sign-up. The first
                // sign-in is what creates the tenant.
                WarrantButton(
                    "Sign in with Google",
                    onClick = { onNavigate(Dest.ACCOUNT) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        } else {
            Spacer(Modifier.weight(1f))
            Rule()
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { onNavigate(Dest.ACCOUNT) }
                    .padding(horizontal = WarrantTheme.dim.pad, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // An initial, not a photo. Loading the avatar would mean an image library and
                // a network call on the one screen that has to open instantly.
                Box(
                    Modifier.size(32.dp).background(colors.surfaceHigh, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        (identity.displayName ?: identity.email).take(1).uppercase(),
                        style = WarrantTheme.type.label.copy(color = colors.fg),
                    )
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        identity.displayName ?: identity.email,
                        style = WarrantTheme.type.label.copy(color = colors.fg),
                    )
                    // The tenant is mono because a machine decided it — from the hd claim,
                    // not from anything this person typed.
                    Text(
                        identity.tenantLabel,
                        style = WarrantTheme.type.mono.copy(color = colors.fg3),
                    )
                }
            }
            accountMenu(auth).forEach { item ->
                MenuRow(
                    item = item,
                    current = item.dest == current,
                    onClick = { onNavigate(item.dest) },
                )
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/**
 * One row. 48dp like everything tappable, with a 2dp bar marking where you already are.
 *
 * A row you cannot use still says what it is and why — `soon` for what is not built,
 * `sign in` for what needs an account. A greyed row with no explanation is just a bug the
 * user has to guess at.
 */
@Composable
private fun MenuRow(item: MenuItem, current: Boolean, onClick: () -> Unit) {
    val colors = WarrantTheme.colors
    val alpha = when {
        current -> 1f
        item.reach == Reach.OPEN -> 0.78f
        else -> 0.42f
    }

    Row(
        Modifier
            .fillMaxWidth()
            .height(WarrantTheme.dim.tap)
            .clickable(enabled = item.enabled, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .width(2.dp)
                .fillMaxHeight()
                .background(if (current) colors.fg else Color.Transparent),
        )
        Text(
            item.dest.label,
            modifier = Modifier.padding(start = WarrantTheme.dim.pad - 2.dp).weight(1f),
            style = WarrantTheme.type.body.copy(color = colors.fg.copy(alpha = alpha)),
        )
        when (item.reach) {
            Reach.SOON -> MonoLabel("soon", modifier = Modifier.padding(end = WarrantTheme.dim.pad))
            Reach.NEEDS_ACCOUNT ->
                MonoLabel("sign in", modifier = Modifier.padding(end = WarrantTheme.dim.pad))
            Reach.OPEN -> Unit
        }
    }
}
