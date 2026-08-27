import { AppShell } from "./shell/AppShell";
import { QuickActions } from "./QuickActions";
import { TaskCarousel, type Task } from "./TaskCarousel";

// No hero, no marketing. The page is the picker — the whole surface is one decision.
// The explanation lives at /about, one tap away, for anyone who wants it after.
const TASKS: Task[] = [
  {
    procedureId: "proc_banana_v1",
    name: "Cut a banana",
    image: "/tasks/banana.webp",
    steps: 3,
    note: "Two photographs and one thing only you can say.",
    classes: ["inferred", "asserted"],
    unreachable: ["measured"],
    available: true,
  },
  {
    procedureId: "proc_smile_v1",
    name: "Smile",
    image: "/tasks/smile.webp",
    steps: 2,
    note: "Two photographs, and the only prop is your own face.",
    classes: ["inferred"],
    unreachable: ["measured"],
    available: true,
  },
  {
    procedureId: "proc_pickup_v1",
    name: "Pick up an object",
    image: "/tasks/pickup.webp",
    steps: 2,
    note: "Two photographs, and nothing to fetch. Anything on your desk will do.",
    classes: ["inferred"],
    unreachable: ["measured"],
    available: true,
  },
  {
    procedureId: "proc_front_brake_v3",
    name: "Front brake service",
    image: "/tasks/brake.webp",
    steps: 4,
    note: "Needs a paired torque wrench. Open it to see this browser refused.",
    classes: ["measured", "specified", "inferred", "asserted"],
    available: true,
  },
  {
    procedureId: "proc_lightbulb_v1",
    name: "Replace a lightbulb",
    image: "/tasks/lightbulb.webp",
    steps: 3,
    note: "The most universal maintenance task there is.",
    classes: ["inferred", "asserted"],
    unreachable: ["measured"],
    available: false,
  },
  {
    procedureId: "proc_tyre_v1",
    name: "Check a tyre with a coin",
    image: "/tasks/tyre.webp",
    steps: 3,
    note: "A coin gives you a threshold, not a number. That gap is the whole point.",
    classes: ["inferred", "asserted"],
    unreachable: ["measured"],
    available: false,
  },
];

export default function Home() {
  return (
    <AppShell tone="work" frame="app">
      <TaskCarousel tasks={TASKS}>
        <QuickActions />
      </TaskCarousel>
    </AppShell>
  );
}
