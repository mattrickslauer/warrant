package ink.warrant.contract

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * The guard on the hand-written boundary.
 *
 * The spec (§4) trades a code generator for hand-written Kotlin and promises "a contract test
 * guards the boundary". This is that test. It reads `contract/entities/<entity>.schema.json` — the
 * same files the TypeScript generator reads — and fails if a Kotlin type has drifted from the
 * schema it claims to implement.
 *
 * It checks two directions, and both matter:
 *   1. Every property in the schema exists on the Kotlin type. Catches a field added to the
 *      contract that the client silently ignores.
 *   2. Every property on the Kotlin type exists in the schema. Catches a field invented on
 *      the client that will never survive a round trip through the real backend.
 *
 * Required-ness is checked too: a schema-required property may not be nullable-with-default on
 * the Kotlin side, because that is exactly how a missing value becomes a silent null at 2am.
 */
class ContractShapeTest {

    private val json = Json { ignoreUnknownKeys = true }

    /** Walks up from the module directory to the repository root. */
    private val contractDir: File by lazy {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null && !File(dir, "contract/entities").isDirectory) {
            dir = dir.parentFile
        }
        File(dir ?: File("."), "contract/entities").also {
            assertTrue(
                "Could not locate contract/entities from ${System.getProperty("user.dir")}. " +
                    "The test must run inside the repository.",
                it.isDirectory,
            )
        }
    }

    /** schema file stem -> the Kotlin descriptor that implements it. */
    @OptIn(ExperimentalSerializationApi::class)
    private val bindings: Map<String, SerialDescriptor> = mapOf(
        "field-def" to FieldDef.serializer().descriptor,
        "field" to Field.serializer().descriptor,
        "step" to Step.serializer().descriptor,
        "procedure" to Procedure.serializer().descriptor,
        "step-outcome" to StepOutcome.serializer().descriptor,
        "job" to Job.serializer().descriptor,
        "capture" to Capture.serializer().descriptor,
        "reading" to Reading.serializer().descriptor,
        "decision" to Decision.serializer().descriptor,
        "record" to SealedRecord.serializer().descriptor,
    )

    @OptIn(ExperimentalSerializationApi::class)
    @Test
    fun `every kotlin type matches the schema it implements`() {
        val problems = mutableListOf<String>()

        for ((stem, descriptor) in bindings) {
            val file = File(contractDir, "$stem.schema.json")
            if (!file.exists()) {
                problems += "$stem: no schema file at ${file.path}"
                continue
            }
            val schema = json.parseToJsonElement(file.readText()).jsonObject
            val properties = schema["properties"]?.jsonObject
            if (properties == null) {
                problems += "$stem: schema has no properties"
                continue
            }
            val required = schema["required"]?.jsonArray
                ?.map { it.jsonPrimitive.content }?.toSet() ?: emptySet()

            val schemaKeys = properties.keys
            val kotlinKeys = (0 until descriptor.elementsCount).map { descriptor.getElementName(it) }.toSet()

            (schemaKeys - kotlinKeys).forEach {
                problems += "$stem: schema property '$it' is missing from the Kotlin type"
            }
            (kotlinKeys - schemaKeys).forEach {
                problems += "$stem: Kotlin property '$it' does not exist in the schema"
            }

            // A schema-required property must not be optional on the Kotlin side. If it is,
            // a malformed payload deserialises to a default instead of failing loudly.
            for (name in required.intersect(kotlinKeys)) {
                val index = descriptor.getElementIndex(name)
                if (descriptor.isElementOptional(index)) {
                    problems += "$stem: '$name' is required by the schema but optional in Kotlin"
                }
            }
        }

        if (problems.isNotEmpty()) {
            fail("Kotlin has drifted from contract/entities:\n  " + problems.joinToString("\n  "))
        }
    }

    /**
     * Every entity schema must have a Kotlin binding or be deliberately excluded. Without
     * this, adding an entity to the contract and forgetting the client passes silently.
     */
    @Test
    fun `no entity schema is left unbound`() {
        // tenant is server-side only; the client never deserialises one.
        val deliberatelyUnbound = setOf("tenant")

        val onDisk = contractDir.listFiles { f -> f.name.endsWith(".schema.json") }
            .orEmpty()
            .map { it.name.removeSuffix(".schema.json") }
            .toSet()

        val unbound = onDisk - bindings.keys - deliberatelyUnbound
        assertTrue(
            "Entity schemas with no Kotlin binding: $unbound. Add the type, or add it to " +
                "deliberatelyUnbound with a reason.",
            unbound.isEmpty(),
        )
    }

    /** The discriminator rule from contract/README.md, asserted rather than trusted. */
    @Test
    fun `field carries every value slot flat`() {
        val f = Field(id = "f1", stepId = "s1", key = "pad_torque", kind = FieldKind.MEASUREMENT)
        // Unfilled: the discriminator says measurement, and no slot is populated yet.
        assertTrue("an empty measurement field must not read as filled", !f.isFilled)
        assertTrue(f.copy(valueNumber = 28.0).isFilled)
        // A photo field is not satisfied by a number sitting in the wrong slot.
        assertTrue(!f.copy(kind = FieldKind.PHOTO, valueNumber = 28.0).isFilled)
        assertTrue(f.copy(kind = FieldKind.PHOTO, mediaRef = "cap_1").isFilled)
    }

    /**
     * The class is a property of the RULE, not of anybody's confidence (architecture.md §1).
     * If this table ever disagrees with the architecture doc, the doc is the authority.
     */
    @Test
    fun `acceptance rule decides the provenance class`() {
        fun def(rule: AcceptanceRule) = FieldDef(
            key = "k", kind = FieldKind.MEASUREMENT, prompt = "p",
            source = FieldSource.INSTRUMENT, requiredAtStrictness = 0,
            acceptanceRule = rule, guidance = "g",
        )
        assertTrue(def(AcceptanceRule.WITHIN).declaredClass == ProvenanceClass.MEASURED)
        assertTrue(def(AcceptanceRule.MATCHES).declaredClass == ProvenanceClass.MEASURED)
        assertTrue(def(AcceptanceRule.PER_SPEC).declaredClass == ProvenanceClass.SPECIFIED)
        assertTrue(def(AcceptanceRule.MUST_SHOW).declaredClass == ProvenanceClass.INFERRED)
        assertTrue(def(AcceptanceRule.CONSISTENT_WITH).declaredClass == ProvenanceClass.INFERRED)
        assertTrue(def(AcceptanceRule.SIGNED_BY).declaredClass == ProvenanceClass.ASSERTED)
    }

    /** Unused import guard: JsonObject is referenced so the import stays meaningful. */
    @Suppress("unused")
    private fun typeAnchor(o: JsonObject) = o.keys
}
