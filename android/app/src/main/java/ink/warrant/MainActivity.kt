package ink.warrant

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.compose.ui.Modifier
import ink.warrant.auth.AuthState
import ink.warrant.design.Tokens
import ink.warrant.design.WarrantTheme
import ink.warrant.instrument.tierOf
import ink.warrant.ui.ProceduresScreen
import ink.warrant.ui.account.AccountScreen
import ink.warrant.ui.instrument.PairScreen
import ink.warrant.ui.job.JobScreen
import ink.warrant.ui.job.JobViewModel
import ink.warrant.ui.procedure.CreateProcedureScreen
import ink.warrant.ui.procedure.YourProceduresScreen
import ink.warrant.ui.records.JobRecordScreen
import ink.warrant.ui.records.RecordScreen
import ink.warrant.ui.records.RecordsScreen
import ink.warrant.ui.settings.SettingsScreen
import ink.warrant.ui.shell.Dest
import ink.warrant.ui.shell.Shell

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val container = (application as WarrantApplication).container

        setContent {
            WarrantTheme {
                val nav = rememberNavController()
                // The window is edge to edge so the workshop ground runs under the system
                // bars rather than leaving them a different colour. The inset is applied by
                // the SHELL rather than here, because the one route that lives outside the
                // shell is the job — and a capture screen whose camera stops short of the
                // status bar is not a full-screen camera. That screen insets its own chrome
                // instead, so nothing lands behind the clock or the navigation bar.
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Tokens.work),
                ) {
                    WarrantNav(nav, container)
                }
            }
        }
    }
}

/** The job route, which is the only one that lives outside the shell. */
private const val JOB = "job"

@Composable
private fun WarrantNav(nav: NavHostController, container: WarrantApplication.Container) {
    // The job outlives the screen it is shown on: a technician can walk to pairing and back
    // without the job restarting, so this ViewModel is scoped to the activity, not the route.
    val jobVm: JobViewModel = viewModel(
        factory = remember {
            viewModelFactory {
                initializer {
                    JobViewModel(
                        container.source,
                        container.instruments,
                        // Read at the moment a signature is attributed, never captured here:
                        // the technician may sign in after this factory has already run.
                        signer = {
                            (container.auth.state.value as? AuthState.SignedIn)
                                ?.identity?.displayName
                        },
                    )
                }
            }
        },
    )

    NavHost(navController = nav, startDestination = Dest.PROCEDURES.route) {
        composable(Dest.PROCEDURES.route) {
            val auth by container.auth.state.collectAsState()
            Shelled(Dest.PROCEDURES, nav, container) {
                ProceduresScreen(
                    source = container.source,
                    instruments = container.instruments,
                    // The quick actions need to know whether there is an account, because a
                    // gated one says so on its face rather than only once you tap it.
                    auth = auth,
                    onStart = { procedure, tier ->
                        jobVm.start(procedure.id, procedure.tenantId, tier)
                        nav.navigate(JOB)
                    },
                    onNavigate = { dest -> nav.go(dest) },
                )
            }
        }

        composable(Dest.RECORDS.route) {
            Shelled(Dest.RECORDS, nav, container) {
                RecordsScreen(
                    source = container.source,
                    // Two destinations, because a sealed record and an open job are genuinely
                    // different documents. What matters is that neither row goes nowhere.
                    onOpenRecord = { id -> nav.navigate("record/${Uri.encode(id)}") },
                    onOpenJob = { id -> nav.navigate("jobrecord/${Uri.encode(id)}") },
                )
            }
        }

        composable(
            "record/{id}",
            arguments = listOf(navArgument("id") { type = NavType.StringType }),
        ) { entry ->
            Shelled(Dest.RECORDS, nav, container) {
                RecordScreen(
                    source = container.source,
                    recordId = entry.arguments?.getString("id").orEmpty(),
                    onBack = { nav.popBackStack() },
                )
            }
        }

        // A job that has not sealed: where it stands, what it has captured, and the questions
        // the fleet raised on it. Shelled, unlike the live job screen — somebody reading this
        // is checking rather than capturing, and there is no shutter to protect.
        composable(
            "jobrecord/{id}",
            arguments = listOf(navArgument("id") { type = NavType.StringType }),
        ) { entry ->
            val auth by container.auth.state.collectAsState()
            Shelled(Dest.RECORDS, nav, container) {
                JobRecordScreen(
                    source = container.source,
                    jobId = entry.arguments?.getString("id").orEmpty(),
                    // An answer is an assertion and has to carry a name. Signed out there is
                    // no name to carry, and "technician" is what the second exit already
                    // writes — the same honest placeholder rather than a second one.
                    by = (auth as? AuthState.SignedIn)
                        ?.identity?.displayName
                        ?.takeIf { it.isNotBlank() }
                        ?: "technician",
                    onBack = { nav.popBackStack() },
                    // Picking a job back up puts it in the hands of the live job screen, which
                    // owns the camera. `resume`, never `start`: starting would write a SECOND
                    // job against the same machine and split the record in two.
                    onResume = { id, stepId ->
                        jobVm.resume(id, at = stepId)
                        nav.navigate(JOB)
                    },
                    // Same route, one flag apart. The step is emptied as the job is rebuilt
                    // rather than after arriving, so the page never draws the finished step
                    // for a frame on its way to drawing the empty one.
                    onRedoStep = { id, stepId ->
                        jobVm.resume(id, at = stepId, redo = true)
                        nav.navigate(JOB)
                    },
                    onOpenRecord = { id -> nav.navigate("record/${Uri.encode(id)}") },
                )
            }
        }

        // Authoring is gated: a procedure belongs to a tenant, and there is no tenant
        // without an identity. Running a public procedure stays open to anyone.
        composable(Dest.CREATE.route) {
            Shelled(Dest.CREATE, nav, container) {
                CreateProcedureScreen(
                    auth = container.auth,
                    onBack = { nav.popBackStack() },
                )
            }
        }

        // Gated like CREATE, and for the same reason: this is where you decide who may read
        // your work, and there is nobody to decide for until there is a tenant.
        composable(Dest.YOUR_PROCEDURES.route) {
            Shelled(Dest.YOUR_PROCEDURES, nav, container) {
                YourProceduresScreen(
                    auth = container.auth,
                    session = container.firebase,
                    api = container.api,
                    source = container.source,
                    // The same start path the picker uses, so an authored procedure and a
                    // bundled one open the identical job screen.
                    onStart = { procedure, tier ->
                        jobVm.start(procedure.id, procedure.tenantId, tier)
                        nav.navigate(JOB)
                    },
                    onCreate = { nav.go(Dest.CREATE) },
                    onBack = { nav.popBackStack() },
                )
            }
        }

        composable(Dest.INSTRUMENTS.route) {
            Shelled(Dest.INSTRUMENTS, nav, container) {
                PairScreen(session = container.instruments, onBack = { nav.popBackStack() })
            }
        }

        composable(Dest.ACCOUNT.route) {
            Shelled(Dest.ACCOUNT, nav, container) {
                AccountScreen(auth = container.auth, onBack = { nav.popBackStack() })
            }
        }

        composable(Dest.SETTINGS.route) {
            Shelled(Dest.SETTINGS, nav, container) {
                SettingsScreen(
                    instruments = container.instruments,
                    source = container.source,
                    onOpenInstruments = { nav.navigate(Dest.INSTRUMENTS.route) },
                )
            }
        }

        // No shell. Evidence capture owns its whole surface — see the note on [Shell].
        composable(JOB) {
            JobScreen(
                vm = jobVm,
                source = container.source,
                onOpenPairing = { nav.navigate(Dest.INSTRUMENTS.route) },
                // The job is over by the time this is reachable, so it is left behind rather
                // than stacked under the record: back from a record goes to the records list,
                // not into a finished job's last step.
                onOpenRecord = { id ->
                    nav.navigate("record/$id") { popUpTo(JOB) { inclusive = true } }
                },
                onExit = { if (!nav.popBackStack()) nav.go(Dest.PROCEDURES) },
            )
        }
    }
}

/**
 * A screen inside the app frame.
 *
 * The header needs two live things — who is signed in, and what the surface can reach — and
 * both are read here rather than passed down through every screen, so no screen has to know
 * the shell exists.
 */
@Composable
private fun Shelled(
    dest: Dest,
    nav: NavHostController,
    container: WarrantApplication.Container,
    content: @Composable () -> Unit,
) {
    val auth by container.auth.state.collectAsState()
    val instrument by container.instruments.state.collectAsState()

    Shell(
        current = dest,
        tier = tierOf(instrument),
        auth = auth,
        onNavigate = { target -> nav.go(target) },
        modifier = Modifier.safeDrawingPadding(),
        content = content,
    )
}

/**
 * Going somewhere the menu names.
 *
 * One function rather than a lambda per call site, because the drawer and the home screen's
 * quick actions now reach the same destinations and they must land on them the same way.
 *
 * The menu is not a stack: walking Procedures → Records → Procedures should leave you with
 * one way back out, not three.
 */
private fun NavHostController.go(dest: Dest) {
    navigate(dest.route) {
        launchSingleTop = true
        popUpTo(Dest.PROCEDURES.route) { inclusive = false }
    }
}
