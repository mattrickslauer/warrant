// The component library. Fourteen primitives plus the agent stamps.
//
// Every screen is these arranged differently. A screen needing something this file does not
// export comes back to the reference build — agents fanning out on a surface may not invent
// components, and that constraint is what makes parallel work safe.
export { Ground, Wrap } from "./Ground";
export { Rule } from "./Rule";
export { EvidenceChip, type ProvenanceClass } from "./EvidenceChip";
export { StatusPill, type JobStatus } from "./StatusPill";
export { StepCard } from "./StepCard";
export { CaptureTile } from "./CaptureTile";
export { ReasonCapture } from "./ReasonCapture";
export { SignatureInput } from "./SignatureInput";
export { ReadingBadge } from "./ReadingBadge";
export { CeilingCard } from "./CeilingCard";
export { AgentTrace } from "./AgentTrace";
export { AgentStamp, type AgentName } from "./AgentStamp";
export { JobRow } from "./JobRow";
export { Timeline, type TimelineEntry } from "./Timeline";
export { HoldBanner } from "./HoldBanner";
export { ChatTurn } from "./ChatTurn";
