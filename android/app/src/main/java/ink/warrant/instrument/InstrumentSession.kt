package ink.warrant.instrument

import ink.warrant.contract.Tier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The paired instrument, for as long as it stays paired.
 *
 * One per process. A technician pairs a tool once and then walks through several steps and
 * several jobs with it in their hand, so the connection outlives any one screen — which is
 * exactly the thing a per-screen ViewModel gets wrong.
 */
class InstrumentSession(
    private val client: InstrumentClient,
    private val scope: CoroutineScope,
) {

    data class State(
        val connecting: Boolean = false,
        val toolId: String? = null,
        val driver: Driver? = null,
        val latest: InstrumentEvent.Value? = null,
        val error: String? = null,
        /**
         * True when readings are simulated because no hardware is paired. Every surface that
         * shows a simulated value MUST say so — see [simulate].
         */
        val simulated: Boolean = false,
    ) {
        val connected: Boolean get() = toolId != null
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var connection: Job? = null

    fun scan() = client.scan()

    fun readiness() = client.readiness()

    fun missingPermissions() = client.missingPermissions()

    fun connect(address: String, preferred: Driver? = null) {
        connection?.cancel()
        _state.value = State(connecting = true)
        connection = scope.launch {
            client.connect(address, preferred).collect { event ->
                _state.value = when (event) {
                    is InstrumentEvent.Connecting ->
                        _state.value.copy(connecting = true, error = null)

                    is InstrumentEvent.Connected ->
                        _state.value.copy(
                            connecting = false,
                            toolId = event.toolId,
                            driver = event.driver,
                            error = null,
                            simulated = false,
                        )

                    is InstrumentEvent.Value ->
                        _state.value.copy(latest = event, error = null)

                    is InstrumentEvent.Failed ->
                        _state.value.copy(connecting = false, error = event.reason)

                    is InstrumentEvent.Disconnected -> State()
                }
            }
        }
    }

    fun disconnect() {
        connection?.cancel()
        connection = null
        _state.value = State()
    }

    /**
     * Simulated readings, for demonstrating the flow with no hardware on the bench.
     *
     * The tool id is prefixed `fake-` and [State.simulated] is set, and both travel with the
     * value everywhere it goes. A simulated reading must never be able to pass itself off as a
     * measurement — that would forge exactly the evidence this system exists to make checkable.
     */
    fun simulate() {
        connection?.cancel()
        val value = FakeDriver.sample()
        _state.value = State(
            toolId = "${FakeDriver.TOOL_ID_PREFIX}sim",
            driver = FakeDriver,
            simulated = true,
            latest = InstrumentEvent.Value(
                value = value,
                unit = FakeDriver.produces.unit,
                toolId = "${FakeDriver.TOOL_ID_PREFIX}sim",
                plausible = true,
                driverId = FakeDriver.id,
            ),
        )
    }
}

/**
 * The tier this surface can actually reach right now.
 *
 * Derived, never set. And a SIMULATED instrument deliberately does not raise it: a generated
 * number must never reach a record as measured, no matter how convenient that would be during
 * a demo. This lives at the top level because three screens and the app header all have to
 * agree on the answer, and three copies of a rule is three chances to break the one rule the
 * product is about.
 */
fun tierOf(state: InstrumentSession.State): Tier =
    if (state.connected && !state.simulated) Tier.INSTRUMENTED else Tier.ATTESTED
