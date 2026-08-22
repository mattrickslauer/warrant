package ink.warrant.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Signing in has to survive the app being killed.
 *
 * A technician signs in once. Android then kills the process the moment they take a photo with
 * another app, or the battery saver decides, or they simply come back tomorrow — and every one
 * of those returned them to the sign-in gate. That is not a login screen, that is a login
 * screen shown at random, and it is the difference between an account and a nuisance.
 *
 * These run on the JVM: [GoogleAuth]'s restore path is deliberately built out of a store it is
 * handed, so what happens at start-up can be tested without a device.
 */
class IdentityPersistenceTest {

    private val ana = Identity(
        subject = "sub-1",
        email = "ana@acme.com",
        displayName = "Ana Reyes",
        photoUrl = "https://example.test/ana.jpg",
        hostedDomain = "acme.com",
    )

    private val solo = Identity(
        subject = "sub-2",
        email = "sam@gmail.com",
        displayName = null,
        photoUrl = null,
        hostedDomain = null,
    )

    /** What [PrefsIdentityStore] is, minus the disk. */
    private class FakeStore(private var held: Identity? = null) : IdentityStore {
        override fun read(): Identity? = held
        override fun write(identity: Identity) { held = identity }
        override fun clear() { held = null }
    }

    private fun auth(store: IdentityStore) = GoogleAuth(store) { "client-id" }

    @Test
    fun `a stored identity is signed in before anything is drawn`() {
        // Not after a coroutine, not after a frame: by the time the state can be read at all.
        // A restore that lands late shows the gate first, and a gate that flashes is worse
        // than one that stays.
        val state = auth(FakeStore(ana)).state.value
        assertEquals(AuthState.SignedIn(ana), state)
    }

    @Test
    fun `an empty store starts signed out`() {
        assertEquals(AuthState.SignedOut, auth(FakeStore()).state.value)
    }

    @Test
    fun `the tenant survives the restore, not just the name`() {
        // The hd claim is the whole identity model — restoring a person into the wrong tenant
        // would be worse than not restoring them.
        val restored = (auth(FakeStore(ana)).state.value as AuthState.SignedIn).identity
        assertEquals("acme.com", restored.tenantId)
        assertTrue(restored.isEnterprise)

        val personal = (auth(FakeStore(solo)).state.value as AuthState.SignedIn).identity
        assertEquals("user:sub-2", personal.tenantId)
        assertTrue(!personal.isEnterprise)
    }

    @Test
    fun `signing out stays signed out across a restart`() {
        val store = FakeStore(ana)
        auth(store).signOut()
        assertNull(store.read())
        assertEquals(AuthState.SignedOut, auth(store).state.value)
    }

    @Test
    fun `an identity survives the trip through storage`() {
        listOf(ana, solo).forEach { identity ->
            assertEquals(identity, decodeIdentity(encodeIdentity(identity)))
        }
    }

    @Test
    fun `unreadable storage signs nobody in`() {
        // A half-written or older-format record must read as "signed out", never as a crash on
        // launch and never as a partly-filled identity in some other tenant.
        listOf("", "   ", "not json", "{}", """{"subject":"s"}""").forEach { junk ->
            assertNull("`$junk` must not decode", decodeIdentity(junk))
        }
    }
}
