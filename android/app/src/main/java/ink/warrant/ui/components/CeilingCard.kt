package ink.warrant.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ink.warrant.contract.CeilingUnreachable
import ink.warrant.contract.ProvenanceClass
import ink.warrant.contract.Tier
import ink.warrant.design.WarrantTheme

private fun tierLabel(t: Tier) = when (t) {
    Tier.OPEN -> "Open — any browser"
    Tier.ATTESTED -> "Attested — the Warrant app"
    Tier.INSTRUMENTED -> "Instrumented — the app and a paired instrument"
}

private fun nextTier(t: Tier): String? = when (t) {
    Tier.OPEN -> "Install the app to attest your captures to a device."
    Tier.ATTESTED -> "Pair an instrument to record a measured value."
    Tier.INSTRUMENTED -> null
}

/**
 * The signature. What this record could prove, what it could not, and why — stated ON the
 * record rather than implied by its absence.
 *
 * The struck-through rows are the call to action, and they are honest: not "upgrade for more
 * features", but *this is the strongest evidence your surface can make, and here is what the
 * next one can*. It is computed by the Seal from the capture surfaces present — a lookup, not
 * a judgement — because it is the one thing on a public record that tells a stranger how much
 * to believe it.
 */
@Composable
fun CeilingCard(
    tier: Tier,
    reachable: List<ProvenanceClass>,
    unreachable: List<CeilingUnreachable>,
    modifier: Modifier = Modifier,
    cta: @Composable ColumnScope.() -> Unit = {},
) {
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim
    val next = nextTier(tier)

    Column(
        modifier
            .fillMaxWidth()
            .background(colors.surface, RoundedCornerShape(dim.rMd))
            .border(1.dp, colors.hairline, RoundedCornerShape(dim.rMd))
            .padding(dim.pad),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column {
            MonoLabel("Verification ceiling")
            Text(
                tierLabel(tier),
                style = WarrantTheme.type.title.copy(fontSize = 19.sp, color = colors.fg),
            )
        }

        Column {
            reachable.forEachIndexed { i, c ->
                if (i > 0) Rule()
                CeilingRow(c, "on this record", out = false)
            }
            unreachable.forEach { u ->
                if (reachable.isNotEmpty() || unreachable.first() != u) Rule()
                CeilingRow(u.cls, u.reason, out = true)
            }
        }

        if (next != null) {
            Text(
                next,
                style = WarrantTheme.type.bodySmall.copy(color = colors.fg.copy(alpha = 0.62f)),
            )
        }
        cta()
    }
}

@Composable
private fun CeilingRow(cls: ProvenanceClass, reason: String, out: Boolean) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        EvidenceChip(cls, out = out)
        Text(
            reason,
            style = WarrantTheme.type.bodySmall.copy(
                color = WarrantTheme.colors.fg.copy(alpha = 0.62f),
            ),
        )
    }
}
