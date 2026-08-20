package ink.warrant

import android.app.Application
import ink.warrant.auth.GoogleAuth
import ink.warrant.data.DataSource
import ink.warrant.data.FixtureSource
import ink.warrant.instrument.InstrumentClient
import ink.warrant.instrument.InstrumentSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob

/**
 * The one place that decides what this build is wired to.
 *
 * Swapping [FixtureSource] for LiveSource is a one-line change here and touches no screen —
 * that is the entire purpose of the seam, and keeping the decision in a single visible place
 * is what stops it leaking back into the UI.
 */
class WarrantApplication : Application() {

    lateinit var container: Container
        private set

    override fun onCreate() {
        super.onCreate()
        container = Container(this)
    }

    class Container(app: Application) {
        private val scope = CoroutineScope(SupervisorJob())

        /** Phase 3 swaps this binding. Nothing else. */
        val source: DataSource = FixtureSource(parent = scope)

        val instruments = InstrumentSession(InstrumentClient(app), scope)

        /** Identity. The hd claim on the account decides the tenant shape. */
        val auth = GoogleAuth(app)
    }
}
