package ink.warrant.data

import ink.warrant.contract.CaptureKind
import ink.warrant.contract.FieldKind

/**
 * Where a capture's bytes live. One builder, and the only place this surface spells that path.
 *
 * It must agree with `storage.rules`, which allows exactly
 * `tenants/{tenant}/captures/{job}/{captureId}.{ext}`, and with `mediaUri` in
 * `web/src/server/adjudicate/cases.ts`, which is this same builder on the other surface. The
 * adjudicator reads what the client wrote, so those two agreeing is not a tidiness point.
 *
 * The path is DERIVED from the capture id and the kind, never read out of a stored string.
 * That is the whole reason this file exists. There are two different things called
 * `media_ref` in this system: on a FIELD it is a capture id, and on a CAPTURE it is this path
 * for a photograph but a READING id for an instrument capture — which is not a storage object
 * at all. Every bug in this area has been one of those being mistaken for the other. Derive
 * the path and neither can be.
 */
object Media {

    /** The extension a kind is stored under, or null when the kind has no object behind it. */
    fun extension(kind: CaptureKind): String? = when (kind) {
        CaptureKind.PHOTO, CaptureKind.SCAN -> "jpg"
        CaptureKind.VIDEO -> "mp4"
        CaptureKind.AUDIO -> "m4a"
        // The one kind with nothing to store: a text capture carries the answer itself.
        CaptureKind.TEXT -> null
    }

    /**
     * The same question asked of a FIELD kind, which is the wider enum — a record renders
     * fields, and most field kinds are values rather than objects.
     *
     * Exhaustive rather than a default, so a kind added later has to be classified here by
     * somebody instead of quietly acquiring an extension and a path pointing at nothing.
     */
    fun extension(kind: FieldKind): String? = when (kind) {
        FieldKind.PHOTO, FieldKind.SCAN -> "jpg"
        FieldKind.VIDEO -> "mp4"
        FieldKind.MEASUREMENT, FieldKind.CHOICE, FieldKind.TEXT,
        FieldKind.SIGNATURE, FieldKind.LOCATION -> null
    }

    /** [tenant] and [job] are bare ids here, not the scoped `tenant/job` pair ids travel as. */
    fun path(tenant: String, job: String, captureId: String, ext: String): String =
        "tenants/$tenant/captures/$job/$captureId.$ext"
}
