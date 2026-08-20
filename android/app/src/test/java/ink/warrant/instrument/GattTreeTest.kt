package ink.warrant.instrument

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

/**
 * Which characteristic actually carries the reading.
 *
 * `InstrumentClient.fallbackDriver` takes the FIRST readable or notifiable characteristic
 * outside generic access. On a great many devices that is the battery level: a uint8 between 0
 * and 100 that decodes cleanly, passes every plausibility check, and is not the reading. It is
 * the most likely way the generic path is silently wrong, and
 * `specs/2026-08-19-wright-design.md` §2 makes fixing it the justification for Wright existing.
 */
class GattTreeTest {

    private val vendorService: UUID = UUID.fromString("0000fe95-0000-1000-8000-00805f9b34fb")
    private val vendorChar: UUID = UUID.fromString("00000100-0000-1000-8000-00805f9b34fb")

    private fun char(
        uuid: UUID,
        properties: Set<GattProperty> = setOf(GattProperty.READ),
        format: PresentationFormat? = null,
        description: String? = null,
    ) = GattCharacteristic(uuid, properties, description, format)

    @Test
    fun `battery level is a decoy however cleanly it decodes`() {
        assertTrue(char(sig(0x2A19)).likelyDecoy)
    }

    @Test
    fun `device information is a decoy, all of it`() {
        // Serial number, firmware revision, model. All readable, none a measurement.
        assertTrue(char(sig(0x2A25)).likelyDecoy)
        assertTrue(char(sig(0x2A26)).likelyDecoy)
        assertTrue(char(sig(0x2A29)).likelyDecoy)
    }

    @Test
    fun `a real reading characteristic is not a decoy`() {
        assertFalse(char(sig(0x2A6E)).likelyDecoy)   // temperature
        assertFalse(char(vendorChar, setOf(GattProperty.NOTIFY)).likelyDecoy)
    }

    @Test
    fun `candidates exclude the decoy even when it comes first`() {
        // The exact ordering that defeats fallbackDriver today: battery is enumerated before
        // the vendor characteristic that carries the actual signal.
        val tree = GattTree(listOf(
            GattService(sig(0x180F), listOf(char(sig(0x2A19), setOf(GattProperty.READ, GattProperty.NOTIFY)))),
            GattService(vendorService, listOf(char(vendorChar, setOf(GattProperty.NOTIFY)))),
        ))
        val candidates = tree.readingCandidates()
        assertEquals(1, candidates.size)
        assertEquals(vendorChar, candidates.single().characteristic.uuid)
    }

    @Test
    fun `a characteristic that can be neither read nor subscribed is not a candidate`() {
        val tree = GattTree(listOf(
            GattService(vendorService, listOf(char(vendorChar, setOf(GattProperty.WRITE)))),
        ))
        assertTrue(tree.readingCandidates().isEmpty())
    }

    @Test
    fun `a declared encoding outranks one that would have to be inferred`() {
        // Evidence over inference, which is the ordering the Wright turn contract states. A
        // characteristic carrying a 0x2904 descriptor has told us its encoding; one without it
        // is a guess waiting to happen, so it must not be offered first.
        val declared = UUID.fromString("00000200-0000-1000-8000-00805f9b34fb")
        val format = PresentationFormat.parse(
            byteArrayOf(0x0E, 0xFE.toByte(), 0x2F, 0x27, 0x01, 0x00, 0x00)
        )!!
        val tree = GattTree(listOf(
            GattService(vendorService, listOf(
                char(vendorChar, setOf(GattProperty.NOTIFY)),
                char(declared, setOf(GattProperty.NOTIFY), format = format),
            )),
        ))
        assertEquals(declared, tree.readingCandidates().first().characteristic.uuid)
    }

    @Test
    fun `an infrastructure service is skipped even holding a characteristic no denylist knows`() {
        // Vendors do stash proprietary characteristics inside Device Information, and this one
        // is on no denylist — notifiable, unrecognised, and indistinguishable from a signal.
        // Only the service it lives under says it is not a reading, so this is the one case
        // that proves the service filter carries weight the characteristic denylist cannot.
        val undocumented = UUID.fromString("00009999-0000-1000-8000-00805f9b34fb")
        val tree = GattTree(listOf(
            GattService(sig(0x1800), listOf(char(sig(0x2A00)))),          // device name
            GattService(sig(0x180A), listOf(char(undocumented, setOf(GattProperty.NOTIFY)))),
        ))
        assertTrue(tree.readingCandidates().isEmpty())
    }

    // --- diagnostics: which one did it pick, and why did the rest lose ----------------------

    @Test
    fun `explain names the chosen characteristic`() {
        val tree = GattTree(listOf(
            GattService(vendorService, listOf(char(vendorChar, setOf(GattProperty.NOTIFY)))),
        ))
        val chosen = tree.explain().single { it.contains("CHOSEN") }
        assertTrue(chosen, chosen.contains("00000100"))
    }

    @Test
    fun `explain says a decoy was skipped for being a decoy`() {
        // A battery level characteristic sitting inside a vendor service, which is where the
        // service-level filter cannot help and only the denylist can.
        val tree = GattTree(listOf(
            GattService(vendorService, listOf(
                char(sig(0x2A19), setOf(GattProperty.READ, GattProperty.NOTIFY)),
                char(vendorChar, setOf(GattProperty.NOTIFY)),
            )),
        ))
        val line = tree.explain().single { it.contains("00002a19") }
        assertTrue(line, line.contains("decoy"))
    }

    @Test
    fun `explain says an infrastructure service was skipped for being one`() {
        val tree = GattTree(listOf(
            GattService(sig(0x180A), listOf(char(sig(0x2A26), setOf(GattProperty.READ)))),
        ))
        val line = tree.explain().single { it.contains("00002a26") }
        assertTrue(line, line.contains("infrastructure"))
    }

    @Test
    fun `explain says a write-only characteristic cannot be read`() {
        val tree = GattTree(listOf(
            GattService(vendorService, listOf(char(vendorChar, setOf(GattProperty.WRITE)))),
        ))
        val line = tree.explain().single { it.contains("00000100") }
        assertTrue(line, line.contains("readable"))
    }

    @Test
    fun `explain accounts for every characteristic on the device`() {
        // The point of the log is to answer "why did it pick that one". A characteristic that
        // vanishes silently is the one you end up guessing about at a bench with a phone.
        val tree = GattTree(listOf(
            GattService(sig(0x180F), listOf(char(sig(0x2A19)))),
            GattService(vendorService, listOf(
                char(vendorChar, setOf(GattProperty.NOTIFY)),
                char(sig(0x2A6E), setOf(GattProperty.READ)),
                char(sig(0x2A25), setOf(GattProperty.READ)),
            )),
        ))
        assertEquals(4, tree.explain().size)
    }

    @Test
    fun `explain reports a declared encoding when the device gave one`() {
        val format = PresentationFormat.parse(
            byteArrayOf(0x0E, 0xFE.toByte(), 0x2F, 0x27, 0x01, 0x00, 0x00)
        )!!
        val tree = GattTree(listOf(
            GattService(vendorService, listOf(
                char(vendorChar, setOf(GattProperty.NOTIFY), format = format),
            )),
        ))
        val line = tree.explain().single()
        assertTrue(line, line.contains("°C"))
    }

    // --- gaps found by running against real hardware ----------------------------------------

    @Test
    fun `the clock is not a measurement`() {
        // Observed on a real device, 2026-08-20: Current Time Service exposing a NOTIFIABLE
        // Current Time characteristic. It decodes cleanly, it changes constantly, and it tracks
        // nothing physical — so it would survive both a plausibility check and a naive
        // does-it-move check. It ranked as a candidate and lost only by enumeration order.
        val tree = GattTree(listOf(
            GattService(sig(0x1805), listOf(
                char(sig(0x2A2B), setOf(GattProperty.READ, GattProperty.NOTIFY)),
                char(sig(0x2A0F), setOf(GattProperty.READ)),
            )),
        ))
        assertTrue(tree.readingCandidates().isEmpty())
    }

    @Test
    fun `a clock characteristic outside its own service is still a clock`() {
        val tree = GattTree(listOf(
            GattService(vendorService, listOf(char(sig(0x2A2B), setOf(GattProperty.NOTIFY)))),
        ))
        assertTrue(tree.readingCandidates().isEmpty())
    }

    @Test
    fun `transmit power is a property of the radio, not a reading`() {
        val tree = GattTree(listOf(
            GattService(vendorService, listOf(char(sig(0x2A07), setOf(GattProperty.READ)))),
        ))
        assertTrue(tree.readingCandidates().isEmpty())
    }
}
