package ink.warrant.net

import android.util.Log
import ink.warrant.data.ReadingFrame
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The few things the phone asks a server to do for it, and nothing else.
 *
 * Almost everything this app does goes straight to Firestore through the authenticated client,
 * so that `firestore.rules` is what enforces tenancy rather than a server we have to trust to
 * remember. Four kinds of thing cannot work that way, and each is here for a specific reason:
 *
 *  1. **Adjudication** calls a deployed model fleet. A client that could call it directly could
 *     also choose not to, and could hand it a case of its own devising.
 *  2. **An instrument reading** is the ONLY path to the measured class, and `firestore.rules`
 *     refuses `readings` from any client at all. That refusal is what makes "a reading exists
 *     with this tool_id" a claim only a paired instrument can cause to be true.
 *  3. **The session exchange** sets the `hd` custom claim, which is what `tenantOf()` in
 *     firestore.rules reads. A client cannot mint its own claim, which is the entire point.
 *  4. **Writing outside the tenant subtree** — seeding the catalogue, and publishing a
 *     procedure to the world. `procedure_versions` and `/public_procedures` are refused to
 *     every client, and that refusal is what makes a frozen version and a public copy mean
 *     something: neither can exist unless a server checked who asked for it.
 *
 * Plain `HttpURLConnection`. This app has a handful of endpoints to call and no other
 * networking; an HTTP stack would be a dependency carried for nothing.
 */
class Api(private val baseUrl: String) {

    companion object {
        private const val TAG = "Api"
    }

    val isConfigured: Boolean get() = baseUrl.isNotBlank()

    /**
     * Ask the fleet to rule on a capture. Fire and forget, deliberately.
     *
     * The technician's screen has already advanced and will learn the verdict from its
     * Firestore listener. If this call never lands, the server's sweep finds the capture and
     * adjudicates it anyway — which is why failing here is logged and not surfaced. A dialog
     * saying "could not reach the adjudicator" would be both alarming and untrue.
     */
    suspend fun adjudicate(
        idToken: String?,
        jobId: String,
        stepId: String,
        fieldKey: String,
        captureId: String,
        integrityToken: String? = null,
    ) {
        val body = JSONObject()
            .put("job_id", jobId)
            .put("step_id", stepId)
            .put("field_key", fieldKey)
            .put("capture_id", captureId)
        // Opaque, and only meaningful to Google. Absent on any build not installed from Play,
        // in which case the server records UNATTESTED rather than inventing a device.
        integrityToken?.let { body.put("integrity_token", it) }
        runCatching { post("/api/adjudicate", body, idToken) }
            .onFailure { Log.i(TAG, "adjudicate did not land; the sweep will catch it", it) }
    }

    /**
     * A number that came off a paired instrument.
     *
     * NOT fire and forget. This one is the difference between a measured value and a typed
     * one, and a technician who is told the reading was taken when it never reached the
     * record has been told something false.
     *
     * Authenticated by the TECHNICIAN'S SESSION, like every other call here. It used to carry
     * `x-warrant-tool-key` — a shared secret shipped inside the APK — while the server took the
     * tenant from the caller's own job id. Admin credentials bypass firestore.rules, so one
     * extracted key wrote `measured` readings into any tenant that existed, and a Workspace
     * tenant id is a domain name. The secret is gone from this app entirely; what proves an
     * instrument was involved is now [ReadingFrame], which only the instrument can produce.
     */
    suspend fun submitReading(
        idToken: String?,
        jobId: String,
        stepId: String,
        fieldKey: String,
        key: String,
        value: Double,
        unit: String,
        frame: ReadingFrame?,
    ): Boolean {
        val body = JSONObject()
            .put("job_id", jobId)
            .put("step_id", stepId)
            .put("field_key", fieldKey)
            .put("key", key)
            // What this handset SAW. Used only when nothing was attested — a device that does
            // not sign, or the simulator — so the number still reaches the form. When the frame
            // below verifies, the server ignores this entirely and decodes the value from the
            // signed bytes, so it cannot carry one figure and report another.
            .put("value", value)
            .put("unit", unit)
        // NO `tenant_id`, NO `tool_id`, NO `at`. Each was a fact the caller asserted about
        // itself, and the server derives all three now: the tenant from the session, the tool id
        // from whichever registered secret verifies the frame, the timestamp from its own clock.
        // `value` survives only as an unattested claim — it can never carry a tool_id with it,
        // and a tool_id is the whole difference between `measured` and typed.
        frame?.let {
            body.put(
                "frame",
                JSONObject()
                    .put("counter", it.counter)
                    .put("rawHex", it.rawHex)
                    .put("signature", it.signature),
            )
        }
        return runCatching { post("/api/ingest/reading", body, idToken) }.isSuccess
    }

    /**
     * Put the public catalogue into this tenant.
     *
     * The picker is bundled on every surface, but a bundled picker is not a bundled
     * procedure: a job is judged against a version frozen in Firestore, and
     * `procedure_versions` is a collection firestore.rules refuses to every client. So the
     * server writes it, and a client that could write its own frozen version — and therefore
     * rewrite the acceptance rule it is about to be judged against — cannot.
     *
     * Idempotent, so calling it on every launch costs one read per procedure and nothing else.
     */
    suspend fun seedPublicProcedures(idToken: String?): Boolean =
        runCatching { post("/api/procedures/seed", JSONObject(), idToken) }
            .onFailure { Log.w(TAG, "could not seed the public catalogue", it) }
            .isSuccess

    /**
     * Show a procedure to the world, or take it back down.
     *
     * Server-side for the same reason seeding is: `/public_procedures` is world-readable and
     * nobody-writable, so there is no client path to it at all. The server checks that the
     * caller's tenant owns the procedure and that the version it is about to copy was actually
     * frozen — a draft would change under whoever was reading it.
     *
     * NOT fire and forget, unlike [adjudicate]. This is a person deciding who may read their
     * work, and someone told the switch flipped when it did not has been told something false.
     * The caller surfaces the throw.
     *
     * @return the new `public_id`, or null when the procedure was taken back down.
     */
    suspend fun shareProcedure(idToken: String?, procedureId: String, public: Boolean): String? {
        val body = JSONObject()
            .put("procedure_id", procedureId)
            // Explicit rather than defaulted, matching the route, which rejects a body without
            // it: the direction of this call is the whole decision it carries.
            .put("public", public)
        val text = post("/api/procedures/share", body, idToken)
        // Absent when taken down. `optString` returns "" for JSON null as well as for a
        // missing key, and both mean private here.
        return JSONObject(text).optString("public_id").takeIf { it.isNotBlank() }
    }

    /**
     * Exchange a freshly minted Firebase token for the tenant claim.
     *
     * Workspace accounts carry `hd`, and Firebase does NOT propagate it into its own ID token
     * — the server verifies Google's token separately and writes a custom claim. Until that
     * has happened a Workspace technician resolves to a personal tenant and sees none of their
     * employer's work, which looks exactly like an empty account rather than a missing claim.
     */
    suspend fun exchangeSession(firebaseIdToken: String, googleIdToken: String): Boolean {
        val body = JSONObject()
            .put("idToken", firebaseIdToken)
            .put("googleIdToken", googleIdToken)
        return runCatching { post("/api/auth/session", body, idToken = null) }.isSuccess
    }

    private suspend fun post(
        path: String,
        body: JSONObject,
        idToken: String?,
        headers: Map<String, String> = emptyMap(),
    ): String = withContext(Dispatchers.IO) {
        check(isConfigured) { "No API base url. Set warrant_api_base in res/values/api.xml." }
        val conn = (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Content-Type", "application/json")
            idToken?.let { setRequestProperty("Authorization", "Bearer $it") }
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
        }
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) error("$path returned $code: ${text.take(300)}")
            text
        } finally {
            conn.disconnect()
        }
    }
}
