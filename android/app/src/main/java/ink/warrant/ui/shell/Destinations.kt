package ink.warrant.ui.shell

import ink.warrant.auth.AuthState

/**
 * Everywhere the app goes, and what the menu calls it.
 *
 * The vocabulary is the product's, and it is worth being exact about: a **procedure** is the
 * versioned spec, a **job** is one run of it, and a **record** is what a sealed job leaves
 * behind. So the list you launch from is Procedures, and authoring is a verb — `Create a
 * procedure` — rather than a second noun competing with the first.
 *
 * Routes live here rather than as string literals at the call sites, because a typo in a
 * `navigate("recrods")` is a runtime crash and a typo here does not compile.
 */
enum class Dest(val route: String, val label: String) {
    PROCEDURES("procedures", "Procedures"),
    RECORDS("records", "Records"),
    CREATE("procedure/create", "Create a procedure"),
    INSTRUMENTS("instruments", "Instruments"),
    FLEET("fleet", "Fleet view"),
    ACCOUNT("account", "Account"),
    SETTINGS("settings", "Settings"),
}

/** Whether a menu row can be walked through, and if not, why not. */
enum class Reach {
    /** Tappable now. */
    OPEN,

    /**
     * Tappable, but the screen behind it will ask for an account first. The row stays visible
     * and dim rather than disappearing: a menu that changes shape when you sign in makes the
     * app look like it is hiding something, and the honest version of "you can't do this yet"
     * names the thing you can't do.
     */
    NEEDS_ACCOUNT,

    /** Named, not built. Dim and inert — never a row that goes nowhere when tapped. */
    SOON,
}

data class MenuItem(val dest: Dest, val reach: Reach) {
    val enabled: Boolean get() = reach != Reach.SOON
}

data class MenuSection(val title: String, val items: List<MenuItem>)

/**
 * The menu, grouped by what a person is there to do.
 *
 * WORK is the technician standing at the machine. AUTHOR is whoever decides what the work is.
 * OPERATE is whoever is watching the fleet. Three roles, and most people are only ever one of
 * them — which is why they are sections rather than one flat list of seven.
 *
 * Pure and Compose-free so the enablement rules can be tested without a device.
 */
fun menu(auth: AuthState): List<MenuSection> {
    val signedIn = auth is AuthState.SignedIn
    val gated = if (signedIn) Reach.OPEN else Reach.NEEDS_ACCOUNT

    return listOf(
        // Records is deliberately NOT gated. A stranger who ran a public procedure made a real
        // record, and being unable to look at their own evidence would contradict the whole
        // claim the product makes.
        MenuSection(
            "Work",
            listOf(
                MenuItem(Dest.PROCEDURES, Reach.OPEN),
                MenuItem(Dest.RECORDS, Reach.OPEN),
            ),
        ),
        MenuSection(
            "Author",
            listOf(
                // A procedure governs every job ever run against it, so it must belong to a
                // tenant, and there is no tenant without an identity.
                MenuItem(Dest.CREATE, gated),
                MenuItem(Dest.INSTRUMENTS, Reach.OPEN),
            ),
        ),
        MenuSection(
            "Operate",
            listOf(MenuItem(Dest.FLEET, Reach.SOON)),
        ),
    )
}

/** The rows pinned to the bottom of the drawer. Empty when signed out — the CTA stands there. */
fun accountMenu(auth: AuthState): List<MenuItem> =
    if (auth is AuthState.SignedIn) {
        listOf(MenuItem(Dest.ACCOUNT, Reach.OPEN), MenuItem(Dest.SETTINGS, Reach.OPEN))
    } else {
        emptyList()
    }

/**
 * One row in the home screen's quick-action list.
 *
 * It carries its own label rather than borrowing [Dest.label] because the menu names *places*
 * — `Instruments` — and this list names *things to do* — `Pair an instrument`. Same
 * destination, different sentence, and the difference is the whole reason to have both.
 *
 * [hint] is written to fit one line, and the row renders it on one line whatever happens. Four
 * of these sit under the carousel on a screen that also has to show a card whole; every hint
 * that wraps to a second line is eighteen dp taken off the artwork above it.
 */
data class QuickAction(
    val dest: Dest,
    val label: String,
    val hint: String,
    val reach: Reach,
) {
    val enabled: Boolean get() = reach != Reach.SOON
}

/**
 * The short list under the carousel: what to do when none of the four tasks is the thing.
 *
 * It reads [Reach] from the same rules the drawer does, so the two surfaces cannot drift into
 * disagreeing about what needs an account — a home row that opens what the menu says is
 * locked is the kind of bug nobody notices until a judge finds it.
 *
 * The signed-out list is the signed-in one plus an invitation, never minus a row. Hiding what
 * an account would unlock is how an app ends up asking for one without ever saying why; the
 * gated row states its own price, and tapping it lands on the gate that explains it.
 */
fun quickActions(auth: AuthState): List<QuickAction> {
    val signedIn = auth is AuthState.SignedIn
    val gated = if (signedIn) Reach.OPEN else Reach.NEEDS_ACCOUNT

    val work = listOf(
        QuickAction(
            dest = Dest.RECORDS,
            label = "Open your records",
            hint = "Every job you have sealed.",
            // Not gated, deliberately. A stranger who ran a public procedure made a real
            // record; being unable to read their own evidence would contradict the product.
            reach = Reach.OPEN,
        ),
        QuickAction(
            dest = Dest.INSTRUMENTS,
            label = "Pair an instrument",
            hint = "Raise the ceiling to measured.",
            reach = Reach.OPEN,
        ),
        QuickAction(
            dest = Dest.CREATE,
            label = "Create a procedure",
            hint = "A spec of your own.",
            reach = gated,
        ),
    )

    return if (signedIn) {
        work
    } else {
        work + QuickAction(
            dest = Dest.ACCOUNT,
            label = "Sign in with Google",
            hint = "Which tenant your work belongs to.",
            reach = Reach.OPEN,
        )
    }
}
