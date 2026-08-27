// The component library. The primitives, plus the agent stamps.
//
// Every screen is these arranged differently. A screen needing something this file does not
// export comes back to the reference build — agents fanning out on a surface may not invent
// components, and that constraint is what makes parallel work safe.
export { Ground, Wrap } from "./Ground";
export { Rule } from "./Rule";
export { EvidenceChip, type ProvenanceClass } from "./EvidenceChip";
export { StatusPill, type JobStatus } from "./StatusPill";
export { StepCard } from "./StepCard";
// The job surface: one non-scrolling page, the lens behind it, and the sheets that hold
// everything the page cannot. Ports of android/…/ui/job/StepPage.kt, CameraLayer.kt and
// JobSheets.kt — see each file for the rules they keep.
export { StepPage, type Notice, type FieldPip } from "./StepPage";
export {
  CameraLayer, LiveMark, LensControl, LampControl, useCameraHandle, flip, lensLabel,
  type Lens, type CameraHandle, type CameraStatus, type Shot,
} from "./CameraLayer";
export { StepBriefSheet, BlockedSheet, TraceSheet } from "./StepSheets";
// The handover: the evidence itself, and what the fleet is doing to it while you watch.
export { EvidenceCarousel } from "./EvidenceCarousel";
export { LiveProgress } from "./LiveProgress";
export { ReasonCapture } from "./ReasonCapture";
export { Attribution } from "./Attribution";
export { AnswerInput } from "./AnswerInput";
export { ReadingBadge } from "./ReadingBadge";
export { CeilingCard } from "./CeilingCard";
export { AgentTrace } from "./AgentTrace";
export { AgentStamp, type AgentName } from "./AgentStamp";
export { JobRow } from "./JobRow";
export { Timeline, type TimelineEntry } from "./Timeline";
export { HoldBanner } from "./HoldBanner";
export { ChatTurn } from "./ChatTurn";
