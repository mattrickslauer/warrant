import { Ground } from "@/components";
import { TaskCarousel, type Task } from "./TaskCarousel";
import Link from "next/link";

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
    <Ground tone="work">
      <div className="app">
        <header className="topbar">
          <span className="topbar__logo"><i aria-hidden />Warrant</span>
          <nav className="topbar__nav">
            <Link href="/about">What is this?</Link>
          </nav>
        </header>
        <TaskCarousel tasks={TASKS} />
      </div>
    </Ground>
  );
}
