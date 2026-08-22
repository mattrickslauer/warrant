package ink.warrant

import android.app.Application
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.storage.FirebaseStorage
import ink.warrant.auth.FirebaseSession
import ink.warrant.auth.GoogleAuth
import ink.warrant.data.DataSource
import ink.warrant.data.FixtureSource
import ink.warrant.data.LiveSource
import ink.warrant.instrument.InstrumentClient
import ink.warrant.instrument.InstrumentSession
import ink.warrant.net.Api
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob

/**
 * The one place that decides what this build is wired to.
 *
 * Choosing [LiveSource] over [FixtureSource] is one line here and touches no screen — which is
 * the entire purpose of the seam, and keeping the decision in a single visible place is what
 * stops it leaking back into the UI.
 *
 * [FixtureSource] is NOT dead code and is not going away. It is how the flow is walked with no
 * network, no project and nothing at risk, and it is the build the film is shot against. Every
 * screen already renders the banner that says the data is fabricated, driven by
 * [DataSource.fabricated] rather than by anything a screen decides for itself.
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

        /** Identity. The hd claim on the account decides the tenant shape. */
        val auth = GoogleAuth(app)

        val api = Api(app.getString(R.string.warrant_api_base))

        val firebase = FirebaseSession(api)

        init {
            // Google proves identity; Firebase is what firestore.rules authorises. The gap
            // between the two is closed here, once, rather than at each screen that reads.
            auth.onGoogleToken = { googleIdToken, identity ->
                firebase.signIn(googleIdToken, identity)
            }
            auth.onSignOut = { firebase.signOut() }
        }

        /**
         * Live unless this build says otherwise, and fixture whenever there is no server to
         * talk to. A build configured for neither would fail at the first read with something
         * about Firestore, which tells a person nothing about what is actually wrong.
         */
        val source: DataSource =
            if (app.resources.getBoolean(R.bool.warrant_live) && api.isConfigured) {
                LiveSource(
                    session = firebase,
                    api = api,
                    db = FirebaseFirestore.getInstance(),
                    // The bucket is named explicitly. The Firebase default in
                    // google-services.json does not exist in this project, and the SDK would
                    // fail against it silently.
                    storage = FirebaseStorage.getInstance(
                        "gs://" + app.getString(R.string.warrant_storage_bucket),
                    ),
                    // Falls back exactly as tenantOf() in firestore.rules does, so the phone
                    // and the rules never disagree about who somebody is.
                    tenantId = {
                        val identity = (auth.state.value as? ink.warrant.auth.AuthState.SignedIn)
                            ?.identity
                        identity?.hostedDomain
                            ?: firebase.uid?.let { "u:$it" }
                            ?: identity?.let { "u:${it.subject}" }
                            ?: "u:unknown"
                    },
                )
            } else {
                FixtureSource(parent = scope)
            }

        val instruments = InstrumentSession(InstrumentClient(app), scope)
    }
}
