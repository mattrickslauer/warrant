package ink.warrant.ui.settings

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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ink.warrant.data.DataSource
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.instrument.InstrumentSession
import ink.warrant.ui.components.HoldBanner
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.WarrantButton

/**
 * Settings, kept honest.
 *
 * Only things that are actually settable appear here. An app of this kind accumulates a
 * settings screen full of switches that do nothing long before it accumulates the features
 * they pretend to configure, and on a product whose entire claim is *the record means what it
 * says*, a decorative toggle is worse than a missing one.
 */
@Composable
fun SettingsScreen(
    instruments: InstrumentSession,
    source: DataSource,
    onOpenInstruments: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by instruments.state.collectAsState()
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim

    Ground(Ground.Work, modifier) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(dim.pad),
            verticalArrangement = Arrangement.spacedBy(dim.stack),
        ) {
            Text("Settings", style = WarrantTheme.type.heading.copy(color = colors.fg))

            MonoLabel("Instrument")
            Text(
                when {
                    state.simulated -> "A simulated instrument is attached."
                    state.connected -> state.driver?.label ?: "Paired, driver unknown"
                    else -> "Nothing paired."
                },
                style = WarrantTheme.type.body.copy(color = colors.fg),
            )
            WarrantButton(
                if (state.connected) "Instrument settings" else "Pair an instrument",
                ghost = true,
                onClick = onOpenInstruments,
                modifier = Modifier.fillMaxWidth(),
            )

            Rule()

            MonoLabel("Simulation")
            Text(
                "A simulated instrument lets the flow be walked without hardware. It does " +
                    "not raise the ceiling — a generated number can never seal as measured, " +
                    "which is the one rule this app will not bend for a demo.",
                style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
            )
            WarrantButton(
                if (state.simulated) "Stop simulating" else "Simulate an instrument",
                ghost = true,
                onClick = { if (state.simulated) instruments.disconnect() else instruments.simulate() },
                modifier = Modifier.fillMaxWidth(),
            )

            Rule()

            MonoLabel("Data")
            Text(
                "Source: ${source.name}",
                style = WarrantTheme.type.mono.copy(color = colors.fg2),
            )
            if (source.fabricated) {
                HoldBanner(
                    headline = "Fixture data",
                    why = "This build has no backend. Procedures are bundled, and jobs and " +
                        "records live only as long as the app does.",
                    waiting = true,
                )
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
