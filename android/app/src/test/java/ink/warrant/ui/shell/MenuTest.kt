package ink.warrant.ui.shell

import ink.warrant.auth.AuthState
import ink.warrant.auth.Identity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The menu's rules, tested without a device.
 *
 * These are the rules that decide what a stranger is allowed to do, so they are worth more
 * than a visual check: a regression here does not look broken, it looks like a product that
 * quietly demands an account for work that was supposed to need none.
 */
class MenuTest {

    private val signedIn = AuthState.SignedIn(
        Identity(
            subject = "sub-1",
            email = "tech@acme.com",
            displayName = "Ana Reyes",
            photoUrl = null,
            hostedDomain = "acme.com",
        ),
    )

    private fun itemFor(auth: AuthState, dest: Dest): MenuItem =
        menu(auth).flatMap { it.items }.first { it.dest == dest }

    @Test
    fun `running work never asks for an account`() {
        listOf(Dest.PROCEDURES, Dest.RECORDS, Dest.INSTRUMENTS).forEach { dest ->
            assertEquals(
                "$dest must stay open to a stranger",
                Reach.OPEN,
                itemFor(AuthState.SignedOut, dest).reach,
            )
        }
    }

    @Test
    fun `authoring asks for an account until there is one`() {
        assertEquals(Reach.NEEDS_ACCOUNT, itemFor(AuthState.SignedOut, Dest.CREATE).reach)
        assertEquals(Reach.OPEN, itemFor(signedIn, Dest.CREATE).reach)
    }

    @Test
    fun `a gated row is still tappable - it leads to the gate`() {
        assertTrue(itemFor(AuthState.SignedOut, Dest.CREATE).enabled)
    }

    @Test
    fun `what is not built is inert rather than a dead end`() {
        val fleet = itemFor(signedIn, Dest.FLEET)
        assertEquals(Reach.SOON, fleet.reach)
        assertFalse("a row that goes nowhere must not be tappable", fleet.enabled)
    }

    @Test
    fun `the menu does not change shape when you sign in`() {
        val out = menu(AuthState.SignedOut)
        val in_ = menu(signedIn)
        assertEquals(out.map { it.title }, in_.map { it.title })
        assertEquals(out.map { s -> s.items.map { it.dest } }, in_.map { s -> s.items.map { it.dest } })
    }

    @Test
    fun `account rows appear only once there is an account`() {
        assertEquals(emptyList<MenuItem>(), accountMenu(AuthState.SignedOut))
        assertEquals(
            listOf(Dest.ACCOUNT, Dest.SETTINGS),
            accountMenu(signedIn).map { it.dest },
        )
    }

    @Test
    fun `the quick actions agree with the menu about what needs an account`() {
        listOf(AuthState.SignedOut, signedIn).forEach { auth ->
            quickActions(auth).forEach { action ->
                val row = menu(auth).flatMap { it.items }.firstOrNull { it.dest == action.dest }
                    ?: return@forEach // ACCOUNT is not a menu row; it is the drawer's CTA.
                assertEquals(
                    "${action.dest} must be reachable the same way from both surfaces",
                    row.reach,
                    action.reach,
                )
            }
        }
    }

    @Test
    fun `authoring is offered but priced when signed out`() {
        val create = quickActions(AuthState.SignedOut).first { it.dest == Dest.CREATE }
        assertEquals(Reach.NEEDS_ACCOUNT, create.reach)
        assertTrue("a gated action still leads to the gate", create.enabled)
        assertEquals(Reach.OPEN, quickActions(signedIn).first { it.dest == Dest.CREATE }.reach)
    }

    @Test
    fun `signing out adds the invitation rather than removing the work`() {
        val out = quickActions(AuthState.SignedOut).map { it.dest }
        val in_ = quickActions(signedIn).map { it.dest }
        assertTrue("no row may disappear when signed out", out.containsAll(in_))
        assertEquals(in_ + Dest.ACCOUNT, out)
        assertFalse("the sign-in row is pointless once there is an account", Dest.ACCOUNT in in_)
    }

    @Test
    fun `running work never asks for an account from the home screen either`() {
        listOf(Dest.RECORDS, Dest.INSTRUMENTS).forEach { dest ->
            assertEquals(
                "$dest must stay open to a stranger",
                Reach.OPEN,
                quickActions(AuthState.SignedOut).first { it.dest == dest }.reach,
            )
        }
    }

    @Test
    fun `every quick action says something a menu row does not`() {
        quickActions(AuthState.SignedOut).forEach { action ->
            assertTrue("${action.dest} needs a hint", action.hint.isNotBlank())
            assertTrue(
                "${action.dest} should name the deed, not the place",
                action.label != action.dest.label || action.dest == Dest.CREATE,
            )
        }
    }

    @Test
    fun `routes are unique`() {
        val routes = Dest.entries.map { it.route }
        assertEquals(routes.size, routes.toSet().size)
    }
}
