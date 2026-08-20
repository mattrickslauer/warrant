package ink.warrant.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.dp
import ink.warrant.auth.AuthState
import ink.warrant.contract.Tier
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import kotlinx.coroutines.launch

/**
 * The frame every screen sits in, except the one where the work happens.
 *
 * ## Why the job screen is outside it
 *
 * Evidence capture is the only flow in this app that can be *spoiled* by a stray tap. A
 * technician holding a phone in one hand over an open caliper does not need a menu button
 * eight millimetres from the shutter, and a job that is half-captured is not a thing to walk
 * away from casually. So the job screen owns its whole surface and keeps its own exit.
 *
 * ## What the header carries
 *
 * The tier chip is live, and it is the reason the home screen no longer needs a block
 * explaining what this surface can reach: the ceiling is now stated on *every* screen instead
 * of one, and tapping it lands on the screen where you can raise it. A statement you can act
 * on where it is made beats a paragraph you have to remember.
 */
@Composable
fun Shell(
    current: Dest,
    tier: Tier,
    auth: AuthState,
    onNavigate: (Dest) -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val colors = WarrantTheme.colors

    fun close() = scope.launch { drawer.close() }

    ModalNavigationDrawer(
        drawerState = drawer,
        modifier = modifier,
        drawerContent = {
            // Material's sheet, stripped back to this app's system: square, our ground, and a
            // hairline down the edge instead of an elevation shadow. What it is kept FOR is
            // the behaviour — edge swipe, scrim, and predictive back all come free, and all
            // three are a lot of code to get right by hand.
            ModalDrawerSheet(
                drawerShape = RectangleShape,
                drawerContainerColor = colors.bg,
                drawerContentColor = colors.fg,
                modifier = Modifier.width(300.dp),
            ) {
                Box(Modifier.fillMaxSize()) {
                    DrawerBody(
                        current = current,
                        auth = auth,
                        onNavigate = { dest -> close(); onNavigate(dest) },
                        onClose = { close() },
                    )
                    // The hairline edge. Drawn last so it sits over the sheet's own surface.
                    Box(
                        Modifier
                            .fillMaxSize()
                            .padding(start = 299.dp)
                            .background(colors.hairline),
                    )
                }
            }
        },
    ) {
        Column(Modifier.fillMaxSize().background(colors.bg)) {
            Header(
                onMenu = { scope.launch { drawer.open() } },
                tier = tier,
                onTier = { onNavigate(Dest.INSTRUMENTS) },
            )
            // Screens call Ground() themselves, which fills whatever it is given — so the
            // header keeps its 48dp and the screen gets the rest.
            Box(Modifier.weight(1f)) { content() }
        }
    }
}

/** The bar. 48dp, hairline under it, and nothing in it that is not load-bearing. */
@Composable
private fun Header(onMenu: () -> Unit, tier: Tier, onTier: () -> Unit) {
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().height(dim.tap),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Hamburger(onClick = onMenu)
            MonoLabel("Warrant", color = colors.fg)
            Spacer(Modifier.weight(1f))
            TierChip(tier = tier, onClick = onTier)
        }
        Rule()
    }
}

/**
 * Three hairlines in a 48dp target.
 *
 * Not an icon font. Font Awesome would be a megabyte of glyphs to draw three rectangles, and
 * the hairline is already this app's alphabet — every rule, every divider, every card edge is
 * the same 1dp line. The menu button being made of them is the point.
 */
@Composable
private fun Hamburger(onClick: () -> Unit) {
    val colors = WarrantTheme.colors
    Box(
        Modifier.size(WarrantTheme.dim.tap).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            repeat(3) {
                Box(Modifier.width(18.dp).height(2.dp).background(colors.fg))
            }
        }
    }
}

/**
 * What this surface can reach, said in two words on every screen.
 *
 * Filled dot means an instrument is actually attached and a number can arrive without passing
 * through a person. Hollow means everything here is inferred or asserted until one is. A
 * simulated instrument reads as ATTESTED on purpose — see the tier derivation in
 * [ink.warrant.instrument.tierOf].
 */
@Composable
private fun TierChip(tier: Tier, onClick: () -> Unit) {
    val colors = WarrantTheme.colors
    val instrumented = tier == Tier.INSTRUMENTED
    val hue = if (instrumented) colors.measured else colors.fg3

    Row(
        Modifier
            .height(WarrantTheme.dim.tap)
            .clickable(onClick = onClick)
            .padding(horizontal = WarrantTheme.dim.pad),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            Modifier
                .size(8.dp)
                .background(if (instrumented) hue else colors.bg, CircleShape)
                .then(
                    if (instrumented) Modifier
                    else Modifier.border(1.dp, hue, CircleShape),
                ),
        )
        MonoLabel(tier.name, color = hue)
    }
}
