package ink.warrant.ui.instrument

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ink.warrant.contract.Tier
import ink.warrant.data.CLASS_BY_TIER
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.instrument.InstrumentClient
import ink.warrant.instrument.InstrumentSession
import ink.warrant.instrument.tierOf
import ink.warrant.ui.components.EvidenceChip
import ink.warrant.ui.components.HoldBanner
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.ReadingBadge
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.WarrantButton

/**
 * Pairing.
 *
 * Every device in range is listed, including the ones no shipped driver recognises, because a
 * technician holding an unfamiliar tool needs to be told "nothing here reads that" rather than
 * left watching an empty list. That listing is also what Wright works from.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PairScreen(
    session: InstrumentSession,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by session.state.collectAsState()
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim

    val found = remember { mutableStateListOf<InstrumentClient.Found>() }
    var scanning by remember { mutableStateOf(false) }
    var scanError by remember { mutableStateOf<String?>(null) }
    var readiness by remember { mutableStateOf(session.readiness()) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { readiness = session.readiness() }

    LaunchedEffect(scanning) {
        if (!scanning) return@LaunchedEffect
        found.clear()
        scanError = null
        runCatching {
            session.scan().collect { device ->
                if (found.none { it.address == device.address }) found.add(device)
            }
        }.onFailure { scanError = it.message }
    }

    Ground(Ground.Work, modifier) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(dim.pad),
            verticalArrangement = Arrangement.spacedBy(dim.stack),
        ) {
            Text("Instrument", style = WarrantTheme.type.heading.copy(color = colors.fg))
            Text(
                "A number that arrives from a paired device, without passing through a human, " +
                    "is the only kind this system will call measured.",
                style = WarrantTheme.type.body.copy(color = colors.fg.copy(alpha = 0.8f)),
            )

            // What the surface can reach, stated where it can be changed. This used to sit on
            // the picker, where it was a paragraph you read once and could do nothing about.
            MonoLabel("This surface can reach")
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CLASS_BY_TIER[tierOf(state)].orEmpty().forEach { EvidenceChip(it) }
            }
            Text(
                when {
                    tierOf(state) == Tier.INSTRUMENTED ->
                        "An instrument is paired, so a measured value is obtainable."
                    // Connected, but to a simulation. The tier deliberately does NOT rise: a
                    // fabricated reading must never reach a record as measured.
                    state.connected ->
                        "A simulated instrument is attached. It does not raise the ceiling — " +
                            "a generated reading cannot seal as measured."
                    else ->
                        "No instrument paired. Everything here is inferred or asserted until " +
                            "one is."
                },
                style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
            )
            Rule()

            when (val r = readiness) {
                is InstrumentClient.Readiness.NoHardware ->
                    HoldBanner("No Bluetooth", "This device has no BLE radio.")

                is InstrumentClient.Readiness.BluetoothOff ->
                    HoldBanner("Bluetooth is off", "Turn it on to pair an instrument.", waiting = true)

                is InstrumentClient.Readiness.NeedsPermission ->
                    HoldBanner(
                        "Permission needed",
                        "Android needs scan and connect permission before any device can be found.",
                        waiting = true,
                    ) {
                        WarrantButton(
                            "Grant",
                            onClick = { permissionLauncher.launch(r.permissions.toTypedArray()) },
                        )
                    }

                InstrumentClient.Readiness.Ready -> Unit
            }

            if (state.connected) {
                MonoLabel("Paired")
                Text(
                    state.driver?.label ?: "unknown driver",
                    style = WarrantTheme.type.body.copy(color = colors.fg),
                )
                Text(
                    "tool #${state.toolId}",
                    style = WarrantTheme.type.mono.copy(color = colors.fg.copy(alpha = 0.7f)),
                )
                state.latest?.let {
                    ReadingBadge(it.value, it.unit, at = "", toolId = it.toolId)
                }
                if (state.simulated) {
                    HoldBanner(
                        "Simulated",
                        "No hardware is attached. These readings are generated, are marked as " +
                            "such on the record, and cannot seal as measured.",
                        waiting = true,
                    )
                }
                WarrantButton("Disconnect", ghost = true, onClick = { session.disconnect() })
                Rule()
            }

            state.error?.let { HoldBanner("Instrument problem", it) }
            scanError?.let { HoldBanner("Scan failed", it) }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                WarrantButton(
                    if (scanning) "Stop scan" else "Scan",
                    enabled = readiness is InstrumentClient.Readiness.Ready,
                    onClick = { scanning = !scanning },
                )
                WarrantButton("Back", ghost = true, onClick = onBack)
            }

            if (found.isNotEmpty()) {
                MonoLabel("In range")
                found.sortedByDescending { it.rssi }.forEach { device ->
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                scanning = false
                                session.connect(device.address, device.driver)
                            }
                            .padding(vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                device.name ?: "(unnamed)",
                                style = WarrantTheme.type.body.copy(color = colors.fg),
                                modifier = Modifier.weight(1f),
                            )
                            MonoLabel("${device.rssi} dBm")
                        }
                        Text(
                            device.driver?.label
                                ?: "No driver claims this device — a generic read will be tried, " +
                                "and the reading marked unvetted.",
                            style = WarrantTheme.type.bodySmall.copy(
                                color = if (device.driver != null) colors.measured
                                else colors.fg.copy(alpha = 0.6f),
                            ),
                        )
                        Text(
                            device.address,
                            style = WarrantTheme.type.monoLabel.copy(
                                color = colors.fg.copy(alpha = 0.45f),
                            ),
                        )
                    }
                    Rule()
                }
            }

            Rule()
            MonoLabel("No hardware to hand?")
            Text(
                "The flow can be demonstrated with a simulated instrument. It is labelled " +
                    "everywhere it appears and the Seal refuses it — a fabricated reading must " +
                    "never be able to reach a record as a measurement.",
                style = WarrantTheme.type.bodySmall.copy(color = colors.fg.copy(alpha = 0.7f)),
            )
            WarrantButton("Use a simulated instrument", ghost = true, onClick = { session.simulate() })
        }
    }
}
