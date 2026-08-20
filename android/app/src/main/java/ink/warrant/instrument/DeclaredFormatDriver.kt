package ink.warrant.instrument

import java.util.UUID

/**
 * A driver for a device that stated its own encoding.
 *
 * Three standings exist, and a record should be able to tell them apart:
 *
 * | | Who determined the encoding | Prefix |
 * |---|---|---|
 * | [Esp32ReferenceDriver], [EnvironmentalSensingDriver] | We did, by hand, against firmware or a published profile | none — vetted |
 * | **This** | **The device did, in its `0x2904` descriptor** | `declared-` |
 * | [GenericGattDriver] | Nobody. It is a guess | `unvetted-` |
 *
 * The middle row is the one worth having and the one nothing reads today. A device carrying a
 * presentation format has named its width, its scale and its unit; decoding it is following a
 * specification, not inferring one, and no per-vendor code had to be written to do it.
 *
 * **It cannot exist without a unit.** `specs/2026-08-19-wright-design.md` §2 defect 1: a number
 * with no unit is not a measurement and cannot be checked against an acceptance rule. Where the
 * device names a unit code we cannot resolve, [from] returns null and the caller falls back to
 * a driver that is honest about guessing — see `PresentationFormat.UNITS` on why that table is
 * deliberately partial.
 */
class DeclaredFormatDriver private constructor(
    private val ref: CharacteristicRef,
    private val format: PresentationFormat,
    override val label: String,
    override val produces: Produces,
) : Driver {

    override val id = "ble-declared-format@1"

    override val matches = Match(serviceUuids = listOf(ref.service))

    override fun characteristicFor(services: List<UUID>): CharacteristicRef? =
        if (ref.service in services) ref else null

    override fun decode(raw: ByteArray): Double? = format.decode(raw)

    companion object {
        /** Marks a reading whose encoding came from the device rather than from us or a guess. */
        const val TOOL_ID_PREFIX = "declared-"

        /**
         * Build one, or refuse.
         *
         * Null when the declared unit code is not one we can resolve. The alternative is a
         * driver with an empty unit, which is the defect this class exists to not have.
         */
        fun from(
            service: UUID,
            characteristic: UUID,
            format: PresentationFormat,
            label: String? = null,
        ): DeclaredFormatDriver? {
            val unit = format.unit ?: return null
            return DeclaredFormatDriver(
                ref = CharacteristicRef(service, characteristic),
                format = format,
                label = label ?: "Device-declared reading ($unit)",
                produces = Produces(
                    unit = unit,
                    min = format.format.rawMin * format.scale,
                    max = format.format.rawMax * format.scale,
                ),
            )
        }
    }
}
