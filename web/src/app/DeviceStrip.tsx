"use client";
import { useEffect, useState } from "react";
import { EvidenceChip, type ProvenanceClass } from "@/components";

/**
 * What this device can actually prove.
 *
 * The verification ceiling stops being an abstract argument the moment it is computed from
 * the hardware in the visitor's hand. We enumerate what the browser exposes and derive the
 * reachable classes from that — so a phone with a camera and no paired tool is told exactly
 * why `measured` is out of reach, on its own terms.
 *
 * Nothing here requests a permission. Enumeration without consent returns unlabelled
 * entries, which is enough to know a camera exists; the label arrives once you use it.
 */
export interface Capability {
  id: string;
  label: string;
  present: boolean;
  detail: string;
}

export interface DeviceReport {
  caps: Capability[];
  reachable: ProvenanceClass[];
  unreachable: Array<{ class: ProvenanceClass; reason: string }>;
  instrumentPathAvailable: boolean;
}

const nav = () => (typeof navigator === "undefined" ? null : navigator);

export async function detectDevices(): Promise<DeviceReport> {
  const n = nav();
  const caps: Capability[] = [];

  let cameras = 0;
  let mics = 0;
  try {
    const list = (await n?.mediaDevices?.enumerateDevices?.()) ?? [];
    cameras = list.filter((d) => d.kind === "videoinput").length;
    mics = list.filter((d) => d.kind === "audioinput").length;
  } catch {
    /* enumeration blocked — treat as absent rather than guessing */
  }

  caps.push({
    id: "camera", label: "Camera", present: cameras > 0,
    detail: cameras > 1 ? `${cameras} available` : cameras === 1 ? "1 available" : "none found",
  });
  caps.push({
    id: "mic", label: "Microphone", present: mics > 0,
    detail: mics > 0 ? "can record a spoken reason" : "type your reason instead",
  });
  caps.push({
    id: "location", label: "Location", present: !!n && "geolocation" in n,
    detail: "self-reported — never counts as measured",
  });
  caps.push({
    id: "motion", label: "Motion sensors", present: typeof DeviceMotionEvent !== "undefined",
    detail: "self-reported — never counts as measured",
  });

  // The instrument path. Web Bluetooth, WebUSB and Web Serial can each reach a real tool,
  // and a value arriving from one carries a device identity rather than a claim.
  const ble = !!n && "bluetooth" in n;
  const usb = !!n && "usb" in n;
  const serial = !!n && "serial" in n;
  const instrumentPathAvailable = ble || usb || serial;
  const routes = [ble && "Bluetooth", usb && "USB", serial && "Serial"].filter(Boolean).join(" · ");

  caps.push({
    id: "instrument", label: "Paired instrument", present: false,
    detail: instrumentPathAvailable
      ? `nothing paired yet — this browser could pair over ${routes}`
      : "this browser cannot reach an instrument",
  });

  return {
    caps,
    reachable: ["inferred", "asserted"],
    unreachable: [
      {
        class: "measured",
        reason: instrumentPathAvailable
          ? "nothing is paired yet — pair a tool and this opens"
          : "requires a paired instrument",
      },
      { class: "specified", reason: "requires a catalogued machine with a published figure" },
    ],
    instrumentPathAvailable,
  };
}

export function DeviceStrip({ onReport }: { onReport?: (r: DeviceReport) => void }) {
  const [report, setReport] = useState<DeviceReport | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    detectDevices().then((r) => {
      if (!alive) return;
      setReport(r);
      onReport?.(r);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!report) return <div className="devices devices--loading">Checking this device…</div>;

  const found = report.caps.filter((c) => c.present).length;

  return (
    <div className={`devices${open ? " devices--open" : ""}`}>
      <button className="devices__bar" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="devices__title">Your devices</span>
        <span className="devices__count">{found} found</span>
        <span className="devices__chev" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="devices__body">
          <ul className="devices__list">
            {report.caps.map((c) => (
              <li className="devices__item" key={c.id} data-present={c.present}>
                <span className="devices__dot" aria-hidden />
                <span className="devices__label">{c.label}</span>
                <span className="devices__detail">{c.detail}</span>
              </li>
            ))}
          </ul>
          <div className="devices__ceiling">
            <p className="gallery__label">So this device can prove</p>
            <div className="gallery__row">
              {report.reachable.map((c) => <EvidenceChip key={c} cls={c} />)}
              {report.unreachable.map((u) => <EvidenceChip key={u.class} cls={u.class} out />)}
            </div>
            <p className="devices__why">{report.unreachable[0]?.reason}</p>
          </div>
        </div>
      )}
    </div>
  );
}
