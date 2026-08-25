package ink.warrant.ui.procedure

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ink.warrant.auth.AuthPurpose
import ink.warrant.auth.FirebaseSession
import ink.warrant.auth.GoogleAuth
import ink.warrant.auth.SignInGate
import ink.warrant.contract.Procedure
import ink.warrant.contract.ProcedureStatus
import ink.warrant.contract.Tier
import ink.warrant.data.DataSource
import ink.warrant.data.isBundled
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.net.Api
import ink.warrant.ui.components.HoldBanner
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.WarrantButton
import kotlinx.coroutines.launch

/** 0 log, 1 standard, 2 assured, 3 regulated. Matches `STRICTNESS` in the web twin. */
private val STRICTNESS = listOf("log", "standard", "assured", "regulated")

/**
 * Every procedure this tenant has authored, and which of them the world can see.
 *
 * The phone had no such screen at all, which is why a shop that finished a Scoper interview on
 * the handset had nowhere to go: the picker lists what you can RUN and could only ever show
 * one of the two things, so a procedure you had just published looked like it had vanished.
 *
 * Nothing is seeded here. A row exists because somebody sat through an interview.
 *
 * The Kotlin twin of `web/src/app/procedures/yours/YourProcedures.tsx`, and the two are meant
 * to be read side by side — same four chips, same three sentences under them, same rule about
 * which button is offered.
 */
@Composable
fun YourProceduresScreen(
    auth: GoogleAuth,
    session: FirebaseSession,
    api: Api,
    source: DataSource,
    onStart: (Procedure, Tier) -> Unit,
    onCreate: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SignInGate(auth, AuthPurpose.YOUR_PROCEDURES, onBack, modifier) { identity ->
        YourProcedures(
            session = session,
            api = api,
            source = source,
            tenantId = identity.tenantId,
            onStart = onStart,
            onCreate = onCreate,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun YourProcedures(
    session: FirebaseSession,
    api: Api,
    source: DataSource,
    tenantId: String,
    onStart: (Procedure, Tier) -> Unit,
    onCreate: () -> Unit,
) {
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim
    val scope = rememberCoroutineScope()

    var procedures by remember { mutableStateOf<List<Procedure>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var refused by remember { mutableStateOf<String?>(null) }
    // Which row is mid-call, so two taps cannot race one another to the same document.
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(tenantId) {
        loading = true
        refused = null
        // `*` rather than the identity's own tenant id: the source resolves the tenant the
        // same way for every screen, and a caller that resolved it itself would be a second
        // opinion about which tenant you are in. Keyed on the identity so switching accounts
        // re-reads.
        //
        // Against LiveSource this read goes through firestore.rules. A refusal must SHOW
        // rather than spin forever on an empty list that looks like "you have written nothing".
        runCatching { source.listProcedures("*") }
            // The bundled three are copied into every tenant by the seed, so they sit in this
            // collection looking exactly like authored work. Subtracting them is what makes
            // this screen answer "what have I written?" rather than "what is in my tenant?".
            .onSuccess { procedures = it.filterNot { p -> isBundled(p.id) } }
            .onFailure { refused = it.message ?: it.toString() }
        loading = false
    }

    /**
     * Show it to the world, or take it back down.
     *
     * The answer is applied to local state rather than re-read, because the server has just
     * told us what it wrote and a re-read would race Firestore's own propagation — the row
     * would flick back to its old state for a moment, which reads as the tap having failed.
     */
    fun setPublic(procedure: Procedure, next: Boolean) {
        busy = procedure.id
        error = null
        scope.launch {
            runCatching { api.shareProcedure(session.idToken(), procedure.id, next) }
                .onSuccess { publicId ->
                    procedures = procedures.map {
                        if (it.id == procedure.id) it.copy(publicId = publicId) else it
                    }
                }
                .onFailure { error = it.message ?: "That did not go through." }
            busy = null
        }
    }

    Ground(Ground.Work) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(dim.pad),
            verticalArrangement = Arrangement.spacedBy(dim.stack),
        ) {
            MonoLabel("Procedures")
            Text(
                "What you have written",
                style = WarrantTheme.type.heading.copy(color = colors.fg),
            )
            Text(
                "A procedure governs every job ever run against it. These are yours: private " +
                    "to this tenant until you say otherwise, and frozen version by version so " +
                    "a record can name the one it ran.",
                style = WarrantTheme.type.body.copy(color = colors.fg2),
            )

            if (loading) {
                Text(
                    "Reading this tenant's procedures…",
                    style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
                )
            }

            refused?.let {
                HoldBanner(headline = "This tenant's procedures could not be read", why = it)
            }

            error?.let { HoldBanner(headline = "Nothing changed", why = it) }

            if (!loading && refused == null && procedures.isEmpty()) {
                Text(
                    "Nothing yet. A procedure comes out of an interview, not a form — and " +
                        "the bundled tasks in the picker are not counted here, because you " +
                        "did not write them.",
                    style = WarrantTheme.type.body.copy(color = colors.fg2),
                )
                WarrantButton(
                    "Create a procedure",
                    onClick = onCreate,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            procedures.forEach { p ->
                Rule()
                val isPublic = p.publicId != null
                val published = p.status == ProcedureStatus.PUBLISHED

                Text(p.title, style = WarrantTheme.type.body.copy(color = colors.fg))
                Text(p.key, style = WarrantTheme.type.mono.copy(color = colors.fg3))

                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Chip(if (published) "v${p.currentVersion}" else "draft")
                    Chip(STRICTNESS.getOrNull(p.strictness) ?: p.strictness.toString())
                    Chip(p.minimumTier.name.lowercase())
                    // The one chip that is filled rather than outlined, because it is the only
                    // one on the row that somebody chose rather than the procedure declaring.
                    Chip(if (isPublic) "public" else "private", filled = isPublic)
                }

                Text(
                    when {
                        isPublic ->
                            "Anyone can read v${p.currentVersion} of this, including the steps " +
                                "and every acceptance rule. Your drafts and every record run " +
                                "against it stay private."
                        published ->
                            "Private to this tenant. Nobody outside it can read this, whatever " +
                                "any flag says — the tenant subtree is unreachable to them."
                        else ->
                            "Still drafting. Publish it to freeze a version; only a frozen " +
                                "version can be made public, because a draft would change " +
                                "under whoever was reading it."
                    },
                    style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
                )

                // Running comes first: it is what a procedure is FOR, and sharing is the
                // administrative act you do once in its life. Before this button existed,
                // subtracting the catalogue left no surface anywhere that could start an
                // authored procedure — you could publish one, show it to the world, and still
                // have no way to perform it yourself.
                WarrantButton(
                    if (busy == p.id) "Working…" else "Run it",
                    // `open` matches the picker. A procedure whose minimum tier is higher is
                    // refused before the job starts rather than quietly downgraded.
                    enabled = published && busy != p.id,
                    onClick = { onStart(p, Tier.OPEN) },
                    modifier = Modifier.fillMaxWidth(),
                )

                WarrantButton(
                    when {
                        busy == p.id -> "Working…"
                        isPublic -> "Make it private"
                        else -> "Show it to the world"
                    },
                    // A draft has no frozen version to copy, so the act is not merely
                    // discouraged — there is nothing for the server to publish.
                    enabled = published && busy != p.id,
                    ghost = isPublic,
                    tonal = !isPublic,
                    onClick = { setPublic(p, !isPublic) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (!loading && refused == null && source.fabricated) {
                Rule()
                HoldBanner(
                    headline = "Fixture data",
                    why = "This screen is bound to the fixture layer, so what you see above is " +
                        "fabricated and is not what is in Firestore. A procedure you published " +
                        "really was written — you are not looking at it.",
                    waiting = true,
                )
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

/** A one-word fact about a procedure. Outlined by default; filled when somebody chose it. */
@Composable
private fun Chip(text: String, filled: Boolean = false) {
    val colors = WarrantTheme.colors
    Text(
        text,
        modifier = Modifier
            .then(
                if (filled) Modifier.background(colors.container(colors.action, 0.20f))
                else Modifier.border(1.dp, colors.hairline),
            )
            .padding(horizontal = 8.dp, vertical = 3.dp),
        style = WarrantTheme.type.mono.copy(
            color = if (filled) colors.action else colors.fg2,
        ),
    )
}
