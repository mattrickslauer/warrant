package ink.warrant.ui

import androidx.compose.foundation.Image
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ink.warrant.auth.AuthState
import ink.warrant.contract.Procedure
import ink.warrant.contract.Tier
import ink.warrant.data.DataSource
import ink.warrant.data.surfaceCanRun
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.instrument.InstrumentSession
import ink.warrant.instrument.tierOf
import ink.warrant.ui.components.EvidenceChip
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import ink.warrant.ui.shell.Dest

/**
 * The picker, and the three other things worth doing.
 *
 * No hero, no title, no tagline — the same decision the web landing page made: **the page IS
 * the picker.** A person opening this is here to do a job, and a masthead telling them what the
 * product is called costs them a scroll before they can start one.
 *
 * Under the cards, the quick actions. They were pulled to the menu once and that was a
 * mistake: a hamburger is the right home for *navigation* and the wrong home for the handful
 * of things a returning person came to do. What did not come back is the block of prose about
 * what this surface can reach — the tier chip in the header states that on every screen now.
 *
 * What stays on the cards is the honest half that belongs ON the choice: a procedure needing
 * more than this surface can supply is refused on its own card, with the reason, rather than
 * quietly downgraded. The quick actions say the same kind of thing about accounts.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProceduresScreen(
    source: DataSource,
    instruments: InstrumentSession,
    auth: AuthState,
    onStart: (Procedure, Tier) -> Unit,
    onNavigate: (Dest) -> Unit,
    modifier: Modifier = Modifier,
) {
    val dim = WarrantTheme.dim
    val instrument by instruments.state.collectAsState()
    var procedures by remember { mutableStateOf<List<Procedure>>(emptyList()) }

    LaunchedEffect(Unit) { procedures = source.listProcedures("*") }

    val tier = tierOf(instrument)

    // Scrolls rather than divides. The first cut of this gave the carousel `weight(1f)` and
    // the quick actions the rest, which looks right until a device with a large font scale
    // arrives: a weighted box does not shrink its child, it CLIPS it, and the card lost its
    // meta line and the whole page indicator with no hint that anything was missing. Both
    // halves now take the height they need, and the screen scrolls if the sum overflows.
    //
    // On a normal phone nothing scrolls — the sizes below are chosen so the card, the dots
    // and all four actions land inside one screen, because a shortcut you have to scroll to
    // find is not a shortcut.
    Ground(Ground.Work, modifier) {
        // Centred when it fits, scrolling when it does not. `heightIn(min = maxHeight)` is
        // what buys both: the column is never shorter than the screen, so the arrangement has
        // slack to centre into, and never taller than its content, so the scroll only engages
        // on a device where the content genuinely overflows.
        BoxWithConstraints(Modifier.fillMaxSize()) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .heightIn(min = maxHeight)
                    .padding(vertical = dim.stack),
                verticalArrangement = Arrangement.spacedBy(dim.stack, Alignment.CenterVertically),
            ) {
                TaskCarousel(tier = tier, procedures = procedures, onStart = onStart)
                QuickActions(auth = auth, onNavigate = onNavigate)
            }
        }
    }
}

/**
 * The carousel.
 *
 * One card per public procedure, snapping so a card is always squarely chosen rather than
 * half-scrolled. Cards carry the artwork, the name, the note and the classes the task can
 * reach — including the struck-through ones it cannot, which is the honest half.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TaskCarousel(
    tier: Tier,
    procedures: List<Procedure>,
    onStart: (Procedure, Tier) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim
    val listState = rememberLazyListState()
    val active by remember { derivedStateOf { listState.firstVisibleItemIndex } }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        LazyRow(
            state = listState,
            flingBehavior = rememberSnapFlingBehavior(listState),
            contentPadding = PaddingValues(horizontal = dim.pad),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            itemsIndexed(publicTasks, key = { _, t -> t.procedureId }) { _, task ->
                val procedure = procedures.firstOrNull { it.id == task.procedureId }
                // Runnable means the procedure exists AND this surface can reach what it asks
                // for. Both failures are shown on the card, and neither is a downgrade.
                val runnable = procedure?.takeIf {
                    task.available && surfaceCanRun(it, tier)
                }

                TaskCard(
                    task = task,
                    runnable = runnable != null,
                    refusal = when {
                        !task.available -> null
                        procedure == null -> "Not in this build yet."
                        !surfaceCanRun(procedure, tier) ->
                            "Needs the ${procedure.minimumTier.name.lowercase()} tier. " +
                                "Pair an instrument."
                        else -> null
                    },
                    onClick = { runnable?.let { onStart(it, tier) } },
                )
            }
        }

        // The Material page indicator: a dot that stretches into a bar for the page you are
        // on, in the action colour. The same shape the web rail uses, so a person who saw the
        // site recognises the control on the phone.
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            publicTasks.forEachIndexed { i, _ ->
                val on = i == active
                val width by animateDpAsState(if (on) 24.dp else 8.dp, label = "indicator")
                Box(
                    Modifier
                        .padding(horizontal = 4.dp)
                        .height(8.dp)
                        .width(width)
                        .background(
                            if (on) colors.action else colors.fg3.copy(alpha = 0.5f),
                            CircleShape,
                        ),
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TaskCard(
    task: PublicTask,
    runnable: Boolean,
    refusal: String?,
    onClick: () -> Unit,
) {
    val colors = WarrantTheme.colors
    // A Material 3 card: the large corner, a tonal surface, and no border — the surface step
    // is what separates a card from the ground, not an outline.
    val shape = RoundedCornerShape(WarrantTheme.dim.rLg)

    Column(
        Modifier
            .width(300.dp)
            .clip(shape)
            .background(if (runnable) colors.surfaceHigh else colors.surface)
            .clickable(enabled = runnable, onClick = onClick),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                // 3:2 rather than 4:3. Twenty-five fewer vertical dp per card, and none of it
                // costs the artwork anything — every one of these images is a centred subject
                // on a plain ground, so the crop takes sky, not information.
                .aspectRatio(3f / 2f)
                .background(colors.bg),
        ) {
            Image(
                painter = painterResource(task.image),
                contentDescription = task.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            // A scrim under the bottom edge so the artwork never fights the text below it.
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0.55f to Color.Transparent,
                            1f to colors.surface.copy(alpha = 0.85f),
                        ),
                    ),
            )
            if (!task.available) {
                Text(
                    "Coming next",
                    style = WarrantTheme.type.label.copy(color = Color.White),
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(12.dp)
                        .background(Color(0xC7202124), RoundedCornerShape(WarrantTheme.dim.rSm))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }

        Column(
            Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                task.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = WarrantTheme.type.title.copy(fontSize = 20.sp, color = colors.fg),
            )
            // Capped at two lines. The note is flavour; the chips under it are the argument,
            // and a long note at a large font scale must not be what pushes them off the card.
            Text(
                task.note,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                style = WarrantTheme.type.bodySmall.copy(color = colors.fg.copy(alpha = 0.72f)),
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                task.classes.forEach { EvidenceChip(it) }
                task.unreachable.forEach { EvidenceChip(it, out = true) }
            }
            if (refusal != null) {
                Text(
                    refusal,
                    style = WarrantTheme.type.bodySmall.copy(color = colors.held),
                )
            } else {
                MonoLabel("${task.steps} steps · about a minute")
            }
        }
    }
}
