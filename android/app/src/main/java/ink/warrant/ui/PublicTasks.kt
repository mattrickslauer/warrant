package ink.warrant.ui

import androidx.annotation.DrawableRes
import ink.warrant.R
import ink.warrant.contract.ProvenanceClass

/**
 * The public procedures, as the picker shows them.
 *
 * Mirrors `web/src/app/page.tsx` — same order, same names, same notes, same artwork. A judge
 * who opens the hosted page and then installs the app must land on the same five tasks, because
 * the ONLY difference between the two surfaces is meant to be what each can prove. If the
 * picker differs, that comparison stops working.
 *
 * [available] false is a task that is drawn but not yet built. Shown rather than hidden: the
 * set is the argument that this is an engine, not one demo.
 */
data class PublicTask(
    val procedureId: String,
    val name: String,
    @DrawableRes val image: Int,
    val steps: Int,
    val note: String,
    val classes: List<ProvenanceClass>,
    val unreachable: List<ProvenanceClass> = emptyList(),
    val available: Boolean,
)

val publicTasks: List<PublicTask> = listOf(
    PublicTask(
        procedureId = "proc_banana_v1",
        name = "Cut a banana",
        image = R.drawable.task_banana,
        steps = 3,
        note = "Two photographs and one thing only you can say.",
        classes = listOf(ProvenanceClass.INFERRED, ProvenanceClass.ASSERTED),
        unreachable = listOf(ProvenanceClass.MEASURED),
        available = true,
    ),
    PublicTask(
        procedureId = "proc_pickup_v1",
        name = "Pick up an object",
        image = R.drawable.task_pickup,
        steps = 2,
        note = "Two photographs, and nothing to fetch. Anything on your desk will do.",
        classes = listOf(ProvenanceClass.INFERRED),
        unreachable = listOf(ProvenanceClass.MEASURED),
        available = true,
    ),
    PublicTask(
        procedureId = "proc_front_brake_v3",
        name = "Front brake service",
        image = R.drawable.task_brake,
        steps = 4,
        note = "Needs a paired torque wrench.",
        classes = listOf(
            ProvenanceClass.MEASURED, ProvenanceClass.SPECIFIED,
            ProvenanceClass.INFERRED, ProvenanceClass.ASSERTED,
        ),
        available = true,
    ),
    PublicTask(
        procedureId = "proc_lightbulb_v1",
        name = "Replace a lightbulb",
        image = R.drawable.task_lightbulb,
        steps = 3,
        note = "The most universal maintenance task there is.",
        classes = listOf(ProvenanceClass.INFERRED, ProvenanceClass.ASSERTED),
        unreachable = listOf(ProvenanceClass.MEASURED),
        available = false,
    ),
    PublicTask(
        procedureId = "proc_tyre_v1",
        name = "Check a tyre with a coin",
        image = R.drawable.task_tyre,
        steps = 3,
        note = "A coin gives you a threshold, not a number. That gap is the whole point.",
        classes = listOf(ProvenanceClass.INFERRED, ProvenanceClass.ASSERTED),
        unreachable = listOf(ProvenanceClass.MEASURED),
        available = false,
    ),
)
