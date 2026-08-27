"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The lens, full bleed, behind everything — and a handle on it held by whoever owns the shutter.
 *
 * The Kotlin twin is android/…/ui/components/CameraLayer.kt, and this is a port of it rather
 * than a second design. What you are being asked for and what the lens can see are the same
 * question, so the frame gets the whole screen rather than a 4:3 tile with prose stacked above
 * it. The prompt, the step number and the exits are drawn OVER it — see `StepPage`.
 *
 * The handle exists because the shutter is no longer ON the camera. The step page puts one big
 * button at the bottom and that button means something different on every field kind — so the
 * preview cannot own the control, and the control has to be able to reach the preview from the
 * other end of the layout. The handle is that reach, and it is deliberately the only one:
 * nothing else can make this camera take a picture.
 *
 * It is a LIVE camera and never a file picker. An uploaded file says nothing about when it was
 * made, where, or by whom; it is indistinguishable from a photograph taken by somebody else
 * last year. The failure this product exists to catch is work that never happened, and an
 * upload is precisely how that failure gets a photograph attached to it. If there is no camera,
 * or permission is refused, this does not fall back to an upload — it says so, and the step
 * goes out through exit two.
 */

/** What the lens is doing right now. */
export type CameraStatus = "starting" | "live" | "denied" | "unavailable";

/**
 * Which way the camera is pointed.
 *
 * Deliberately the technician's choice and not the procedure's, for the same reason the lamp
 * is: a `FieldDef` declares what a step must PRODUCE — the prompt, the acceptance rule, what
 * good looks like — and says nothing about which piece of glass produces it. Which camera you
 * reach for is a property of where you are standing and what you are pointing at, not of the
 * work, so it stays off the contract entirely: no schema field, no generated type, nothing for
 * a procedure author to get wrong about somebody else's garage.
 *
 * `environment` is the default because most work is in front of you rather than behind the
 * phone. A task whose subject is the person holding it — `proc_smile_v1` is the bundled one —
 * is one tap away, and that tap is the whole reason this exists: before it, the front camera
 * was unreachable on both surfaces and a selfie task could not be performed at all.
 */
export type Lens = "environment" | "user";

export function flip(lens: Lens): Lens {
  return lens === "environment" ? "user" : "environment";
}

export const lensLabel = (lens: Lens): string =>
  lens === "user" ? "Front camera" : "Back camera";

/** A frame, and a URL for it that the caller owns. */
export interface Shot {
  blob: Blob;
  url: string;
}

export interface CameraHandle {
  status: CameraStatus;
  /** True between the tap and the frame landing. Keeps the bar from double-firing. */
  busy: boolean;
  /** The lens is open and a tap would actually take something. */
  ready: boolean;
  /**
   * This device has more than one camera.
   *
   * Read from `enumerateDevices`, and false until permission has been granted — a browser
   * that has not been allowed the camera reports the devices without labels and sometimes
   * without count. The flip control is hidden rather than disabled when this is false: a
   * laptop with one webcam has nothing to flip to, and a dead button on a page whose whole
   * promise is that every control does something is worse than no button.
   */
  canFlip: boolean;
  /**
   * The open track can drive a lamp.
   *
   * `torch` is a MediaTrackCapability that only some platforms implement — Chrome on Android
   * does, Safari and every desktop browser do not — so this is asked of the track that is
   * actually open rather than assumed. See `LampControl` for why the browser gets two states
   * where the phone gets three.
   */
  canLamp: boolean;
  /** Take one. Resolves with the frame, or null if there was nothing to take. */
  capture: () => Promise<Shot | null>;

  /** @internal Wiring for `CameraLayer`. Nothing outside this file may touch these. */
  readonly _wire: {
    setStatus: (s: CameraStatus) => void;
    setBusy: (b: boolean) => void;
    setCanFlip: (b: boolean) => void;
    setCanLamp: (b: boolean) => void;
    shoot: { current: (() => Promise<Shot | null>) | null };
  };
}

export function useCameraHandle(): CameraHandle {
  const [status, setStatus] = useState<CameraStatus>("starting");
  const [busy, setBusy] = useState(false);
  const [canFlip, setCanFlip] = useState(false);
  const [canLamp, setCanLamp] = useState(false);
  const shoot = useRef<(() => Promise<Shot | null>) | null>(null);

  const capture = useCallback(async (): Promise<Shot | null> => {
    const take = shoot.current;
    if (!take) return null;
    return take();
  }, []);

  const wire = useMemo(
    () => ({ setStatus, setBusy, setCanFlip, setCanLamp, shoot }),
    [],
  );

  return useMemo(
    () => ({
      status,
      busy,
      canFlip,
      canLamp,
      ready: status === "live" && !busy,
      capture,
      _wire: wire,
    }),
    [status, busy, canFlip, canLamp, capture, wire],
  );
}

export function CameraLayer({
  handle, lens, lamp,
}: {
  handle: CameraHandle;
  lens: Lens;
  /**
   * Whether the lamp is lit. Owned by the job's state and passed down rather than held here —
   * one owner means the chip and the lamp cannot disagree, which is the whole failure worth
   * preventing.
   */
  lamp: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  /**
   * The frame shape this stream opened with, and the only shape it is allowed to have.
   *
   * Left alone, a phone re-cuts a live camera track whenever its orientation sensor decides
   * the device has turned — the track transposes, and the viewfinder lurches to a different
   * crop of the world mid-step. Nothing asked for that and nothing about the evidence changed,
   * so it is pinned at first frame and held for the life of the stream.
   */
  const geometry = useRef<{ w: number; h: number } | null>(null);
  const { setStatus, setBusy, setCanFlip, setCanLamp, shoot } = handle._wire;

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        // aspectRatio and crop-and-scale say the quiet part out loud: give me this shape and
        // keep giving me this shape. Without them the browser is free to hand back a
        // transposed frame the moment the gyro twitches.
        //
        // `facingMode` is ideal rather than exact on purpose. Exact throws
        // OverconstrainedError on a laptop with one webcam that reports no facing at all,
        // which would turn a flip into a dead camera rather than a no-op.
        video: {
          facingMode: { ideal: lens },
          width: { ideal: 1280 },
          height: { ideal: 960 },
          aspectRatio: { ideal: 4 / 3 },
          resizeMode: "crop-and-scale",
        } as MediaTrackConstraints,
        audio: false,
      });
      geometry.current = null;
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
      }
      setStatus("live");

      // Asked of the track that is actually open, not guessed from the user agent.
      const track = s.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        torch?: boolean;
      };
      setCanLamp(Boolean(caps.torch));

      // Only now, because a browser that has not been granted the camera reports its devices
      // without labels and sometimes without a full count.
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCanFlip(devices.filter((d) => d.kind === "videoinput").length > 1);
      } catch {
        setCanFlip(false);
      }
    } catch (e) {
      const name = (e as DOMException)?.name;
      setStatus(
        name === "NotFoundError" || name === "OverconstrainedError" ? "unavailable" : "denied",
      );
    }
  }, [lens, setStatus, setCanFlip, setCanLamp]);

  // Reopened whenever the lens changes: a facingMode is a property of the track, and a track
  // cannot turn around. Stopping first matters on a phone, where two open cameras is a state
  // the hardware will simply refuse.
  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  /**
   * The lamp, applied to the open track.
   *
   * Separate effect from `start` so that toggling it does not re-open the camera — reopening
   * would black the viewfinder for a beat, which over a lamp control reads as the app breaking
   * rather than as a light coming on.
   */
  useEffect(() => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
    if (!caps.torch) return;
    track
      // Through `unknown` because `torch` is not in TypeScript's DOM lib: it is a real
      // MediaTrackConstraintSet member on the platforms that implement it (the Image Capture
      // spec) and simply absent from the standard `MediaStreamTrack` definitions. The guard
      // above is what makes the cast safe — nothing is asked of a track that did not report
      // the capability.
      .applyConstraints({ advanced: [{ torch: lamp }] } as unknown as MediaTrackConstraints)
      .catch(() => {});
  }, [lamp, handle.status]);

  /**
   * Take the first frame's shape as the truth, and refuse every later one.
   *
   * The video element fires `resize` when the track's own dimensions change, which on a phone
   * means the orientation sensor moved and the browser re-oriented the stream. The constraint
   * is simply asked for again: the track is told to go back to the shape it started in, and
   * the picture stays where the technician left it.
   */
  const pin = useCallback(() => {
    const v = video.current;
    const track = stream.current?.getVideoTracks()[0];
    if (!v || !track || !v.videoWidth) return;
    if (!geometry.current) {
      geometry.current = { w: v.videoWidth, h: v.videoHeight };
      return;
    }
    const { w, h } = geometry.current;
    if (v.videoWidth === w && v.videoHeight === h) return;
    track
      .applyConstraints({
        width: { exact: w },
        height: { exact: h },
        aspectRatio: { exact: w / h },
        resizeMode: "crop-and-scale",
      } as MediaTrackConstraints)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.addEventListener("resize", pin);
    v.addEventListener("loadedmetadata", pin);
    return () => {
      v.removeEventListener("resize", pin);
      v.removeEventListener("loadedmetadata", pin);
    };
  }, [pin, handle.status]);

  // Wired for exactly as long as this layer is on screen. When the active field stops being a
  // camera field the layer leaves, the wire is cut, and a stale tap on a bar that has since
  // changed meaning cannot reach a stream that is no longer open.
  useEffect(() => {
    shoot.current = async () => {
      const v = video.current;
      if (!v || !v.videoWidth) return null;
      setBusy(true);
      try {
        // If a device managed to re-cut the track anyway, the photograph is still the picture
        // the viewfinder was showing: centre-cropped into the shape the stream opened with,
        // never a sideways frame the technician never framed.
        const base = geometry.current ?? { w: v.videoWidth, h: v.videoHeight };
        const c = document.createElement("canvas");
        c.width = base.w;
        c.height = base.h;
        const fill = Math.max(base.w / v.videoWidth, base.h / v.videoHeight);
        const dw = v.videoWidth * fill;
        const dh = v.videoHeight * fill;
        // NOT mirrored, even on the front lens where the preview is. The preview is flipped
        // because a selfie that moves the wrong way is unusable to frame; the FRAME is what
        // the sensor actually saw, and quietly writing a mirrored image to a record would be
        // this screen editing the evidence for cosmetic reasons.
        c.getContext("2d")?.drawImage(v, (base.w - dw) / 2, (base.h - dh) / 2, dw, dh);
        const blob = await new Promise<Blob | null>((resolve) =>
          c.toBlob(resolve, "image/jpeg", 0.9),
        );
        if (!blob) return null;
        return { blob, url: URL.createObjectURL(blob) };
      } finally {
        setBusy(false);
      }
    };
    return () => { shoot.current = null; };
  }, [shoot, setBusy]);

  return (
    <div className={`w-lens w-lens--${handle.status}`}>
      <video
        ref={video}
        playsInline
        muted
        autoPlay
        // Mirrored on the front lens only, which is what every camera app does and what
        // anybody framing their own face expects. See the capture above for why the recorded
        // frame is not.
        className={lens === "user" ? "w-lens__video w-lens__video--mirror" : "w-lens__video"}
      />

      {handle.status === "starting" && (
        <p className="w-lens__hint">Opening the camera…</p>
      )}
      {handle.status === "denied" && (
        <p className="w-lens__hint">
          Camera refused. Nothing here falls back to an upload — a file says nothing about when
          it was taken. Use <b>Can&rsquo;t do this</b> to say so instead; the reason goes on the
          record and the fleet rules on it.
        </p>
      )}
      {handle.status === "unavailable" && (
        <p className="w-lens__hint">
          No camera on this device. Use <b>Can&rsquo;t do this</b> to say so — a stated reason
          is a real outcome, and a weaker kind of proof pretending to be a stronger one is not.
        </p>
      )}
    </div>
  );
}

/**
 * "Live" is a claim about provenance, not a decoration: a frame grabbed from an open stream
 * here and now is a different thing from an uploaded file, and the record records which.
 */
export function LiveMark() {
  return <span className="w-lensmark">Live</span>;
}

/**
 * Turn the camera around.
 *
 * Sits at the foot of the frame beside the lamp: both are statements about the lens rather
 * than about the work, and both come and go with it. Nothing above the primary bar moves to
 * make room, because `StepPage`'s second rule is that the bar never moves — a technician with
 * dirty hands should never have to aim, and a shutter that shifts because a chip appeared is a
 * shutter you have to look for.
 *
 * The label names the lens you are ON, not the one you would get, because the chip is a
 * statement of state before it is a button — and at arm's length in bad light those two read
 * very differently.
 */
export function LensControl({ lens, onFlip }: { lens: Lens; onFlip: () => void }) {
  return (
    <button
      type="button"
      className="w-lenschip"
      onClick={onFlip}
      aria-label={`${lensLabel(lens)}. Switch to the ${lens === "user" ? "back" : "front"} camera`}
    >
      <svg viewBox="0 0 24 24" aria-hidden width="16" height="16">
        <path
          d="M20 5h-3.2l-1.5-2h-6.6L7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
        />
        <path
          d="M9.2 12.5a2.8 2.8 0 0 1 4.9-1.8m.7 2.8a2.8 2.8 0 0 1-4.9 1.8"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
        />
        <path d="m14.6 8.9.3 2.1-2.1-.4M9.4 16.6l-.3-2.1 2.1.4"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
          strokeLinejoin="round" />
      </svg>
      <span>{lensLabel(lens)}</span>
    </button>
  );
}

/**
 * The lamp, and the one control that changes it.
 *
 * TWO states where the phone has three, and the difference is not an omission. CameraX has a
 * shutter-synchronised flash, so `FlashMode.Auto` — "let the device decide at the moment of
 * capture" — is a real thing to ask for there. A browser has no such thing: `getUserMedia`
 * exposes a `torch` capability, which is a lamp you switch on and leave on, and there is
 * nothing to hand the decision to. Drawing a third state the platform cannot honour would be
 * a control that lies about what it does, so the browser gets the two it can actually deliver
 * and the chip says "Lamp" rather than "Flash" to say which one this is.
 *
 * Rendered only where the open track reports the capability — see `CameraHandle.canLamp`.
 */
export function LampControl({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`w-lenschip${on ? " w-lenschip--on" : ""}`}
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? "Lamp on. Turn it off" : "Lamp off. Turn it on"}
    >
      <svg viewBox="0 0 24 24" aria-hidden width="16" height="16">
        <path
          d="M13 2 5 13.2h5.2L10 22l8-11.2h-5.2L13 2Z"
          fill={on ? "currentColor" : "none"}
          stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
        />
      </svg>
      <span>{on ? "Lamp on" : "Lamp off"}</span>
    </button>
  );
}
