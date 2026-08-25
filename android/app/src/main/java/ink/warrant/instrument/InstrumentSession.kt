package ink.warrant.instrument

import ink.warrant.contract.FieldDef
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

    /**
     * Where the connection has got to, as ONE value rather than several that can disagree.
     *
     * This was three loose fields — `connecting`, `toolId`, `error` — which made it impossible
     * to show progress against the row the technician actually tapped, and impossible to tell a
     * refusal apart from an ordinary disconnect. Both of those are things a person standing at
     * a bench needs to see.
     */
    sealed interface Link {
        /** Nothing attempted, or disconnected cleanly. */
        data object Idle : Link

        /** In flight. The address is carried so the tapped row can show it, and only that row. */
        data class Connecting(val address: String, val name: String?) : Link

        /** Attached and reading. */
        data class Paired(val address: String, val toolId: String, val driver: Driver) : Link

        /** The attempt finished and did not pair. The reason is the whole point of the state. */
        data class Rejected(val address: String, val name: String?, val reason: String) : Link

        /** No hardware; generated values. Never raises the tier — see [tierOf]. */
        data class Simulated(val toolId: String) : Link
    }

    data class State(
        val link: Link = Link.Idle,
        val latest: InstrumentEvent.Value? = null,
    ) {
        val connecting: Boolean get() = link is Link.Connecting
        val connected: Boolean get() = link is Link.Paired || link is Link.Simulated

        /**
         * True when readings are simulated because no hardware is paired. Every surface that
         * shows a simulated value MUST say so — see [simulate].
         */
        val simulated: Boolean get() = link is Link.Simulated

        val toolId: String? get() = when (link) {
            is Link.Paired -> link.toolId
            is Link.Simulated -> link.toolId
            else -> null
        }

        val driver: Driver? get() = when (link) {
            is Link.Paired -> link.driver
            is Link.Simulated -> FakeDriver
            else -> null
        }

        /** The refusal, if the last attempt was refused. */
        val error: String? get() = (link as? Link.Rejected)?.reason

        /** True while this exact device is being connected to, and false for every other row. */
        fun isConnecting(address: String): Boolean =
            (link as? Link.Connecting)?.address == address

        /** True when this exact device is the one that refused. */
        fun isRejected(address: String): Boolean =
            (link as? Link.Rejected)?.address == address
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var connection: Job? = null

    fun scan() = client.scan()

    fun readiness() = client.readiness()

    fun missingPermissions() = client.missingPermissions()

    fun connect(address: String, preferred: Driver? = null, name: String? = null) {
        connection?.cancel()
        _state.value = State(link = Link.Connecting(address, name))
        connection = scope.launch {
            client.connect(address, preferred).collect { event ->
                _state.value = reduce(_state.value, event, address, name)
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
    fun simulate(field: FieldDef? = null) {
        connection?.cancel()
        _state.value = State(link = Link.Simulated(SIM_TOOL_ID), latest = reading(field))
    }

    /**
     * Re-read, for the measurement field now in front of the technician.
     *
     * A real tool is held against one thing at a time and reports that thing. The simulator has
     * to be told, because it has no thing — so every screen that puts a measurement field up
     * aims it first. Only the reading changes: this is not a reconnection, and it must not
     * disturb a live pairing, so it does nothing at all unless the link is already simulated.
     */
    fun aim(field: FieldDef?) {
        if (_state.value.link !is Link.Simulated) return
        _state.value = _state.value.copy(latest = reading(field))
    }

    private fun reading(field: FieldDef?): InstrumentEvent.Value {
        val sample = FakeDriver.sample(field)
        return InstrumentEvent.Value(
            value = sample.value,
            unit = sample.unit,
            toolId = SIM_TOOL_ID,
            plausible = true,
            driverId = FakeDriver.id,
        )
    }

    private companion object {
        const val SIM_TOOL_ID = "${FakeDriver.TOOL_ID_PREFIX}sim"
    }
}

/**
 * One event applied to the connection state. Pure, so the transitions can be pinned by tests
 * rather than inferred from a coroutine.
 */
fun reduce(
    state: InstrumentSession.State,
    event: InstrumentEvent,
    address: String,
    name: String?,
): InstrumentSession.State = when (event) {
    is InstrumentEvent.Connecting ->
        state.copy(link = InstrumentSession.Link.Connecting(address, name))

    is InstrumentEvent.Connected ->
        state.copy(link = InstrumentSession.Link.Paired(address, event.toolId, event.driver))

    is InstrumentEvent.Value ->
        state.copy(latest = event)

    is InstrumentEvent.Failed ->
        InstrumentSession.State(link = InstrumentSession.Link.Rejected(address, name, event.reason))

    // A refused connection tears the GATT client down, so this arrives immediately behind
    // Failed. Letting it reset to idle makes the explanation flash up and disappear, which is
    // indistinguishable from the silent failure this state exists to end.
    is InstrumentEvent.Disconnected ->
        if (state.link is InstrumentSession.Link.Rejected) state else InstrumentSession.State()
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
    if (state.link is InstrumentSession.Link.Paired) Tier.INSTRUMENTED else Tier.ATTESTED
