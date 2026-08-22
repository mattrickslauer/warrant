"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EvidenceChip, type ProvenanceClass } from "./EvidenceChip";

type Phase = "starting" | "live" | "captured" | "denied" | "unavailable";

/**
 * The primary exit — and it is a LIVE camera, never a file picker.
 *
 * An uploaded file says nothing about when it was made, where, or by whom; it is
 * indistinguishable from a photograph taken by somebody else last year. The failure this
 * product exists to catch is work that never happened, and an upload is precisely how that
 * failure gets a photograph attached to it. A frame grabbed from an open stream at least
 * binds the evidence to this device at this moment.
 *
 * If there is no camera, or permission is refused, this does not fall back to an upload.
 * It says so, and the step goes out through the other exit — stating why it could not be
 * done is a real outcome, and a weaker kind of proof pretending to be a stronger one is not.
 */
export function CaptureTile({
  hint, facing = "environment", provenance, onCapture, disabled,
}: {
  hint: string;
  facing?: "environment" | "user";
  provenance?: ProvenanceClass;
  onCapture: (blob: Blob, objectUrl: string) => void;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  /**
   * The frame shape this stream opened with, and the only shape it is allowed to have.
   *
   * Left alone, a phone re-cuts a live camera track whenever its orientation sensor decides
   * the device has turned — the track transposes, and the viewfinder lurches to a different
   * crop of the world mid-step. Nothing asked for that and nothing about the evidence
   * changed, so it is pinned here at first frame and held for the life of the stream.
   */
  const geometry = useRef<{ w: number; h: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [shot, setShot] = useState<string | null>(null);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("unavailable");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        // aspectRatio and crop-and-scale say the quiet part out loud: give me this shape and
        // keep giving me this shape. Without them the browser is free to hand back a
        // transposed frame the moment the gyro twitches.
        video: {
          facingMode: facing,
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
      setPhase("live");
    } catch (e) {
      const name = (e as DOMException)?.name;
      setPhase(name === "NotFoundError" || name === "OverconstrainedError" ? "unavailable" : "denied");
    }
  }, [facing]);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

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
  }, [pin, phase]);

  function grab() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // If a device managed to re-cut the track anyway, the photograph is still the picture the
    // viewfinder was showing: centre-cropped into the shape the stream opened with, never a
    // sideways frame the technician never framed.
    const base = geometry.current ?? { w: v.videoWidth, h: v.videoHeight };
    const c = document.createElement("canvas");
    c.width = base.w;
    c.height = base.h;
    const fill = Math.max(base.w / v.videoWidth, base.h / v.videoHeight);
    const dw = v.videoWidth * fill;
    const dh = v.videoHeight * fill;
    c.getContext("2d")?.drawImage(v, (base.w - dw) / 2, (base.h - dh) / 2, dw, dh);
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setShot(url);
      setPhase("captured");
      stop();
      onCapture(blob, url);
    }, "image/jpeg", 0.9);
  }

  return (
    <div className={`w-capture w-capture--${phase}`}>
      {phase === "captured" && shot ? (
        <img src={shot} alt="" />
      ) : (
        <video ref={video} playsInline muted autoPlay />
      )}

      {phase === "starting" && <span className="w-capture__hint">Opening the camera…</span>}

      {phase === "denied" && (
        <span className="w-capture__hint">
          Camera refused. Nothing here falls back to an upload — a file says nothing about when
          it was taken. Use <b>I can&rsquo;t do this</b> instead.
        </span>
      )}
      {phase === "unavailable" && (
        <span className="w-capture__hint">
          No camera on this device. Use <b>I can&rsquo;t do this</b> to say so.
        </span>
      )}

      {phase === "live" && (
        <>
          <span className="w-capture__prompt">{hint}</span>
          <button
            type="button"
            className="w-capture__shutter"
            onClick={grab}
            disabled={disabled}
            aria-label={`Capture: ${hint}`}
          >
            <span aria-hidden />
          </button>
          <span className="w-capture__live">live</span>
        </>
      )}

      {phase === "captured" && (
        <span className="w-capture__flag">
          {provenance && <EvidenceChip cls={provenance} />}
          <button
            type="button"
            className="w-btn w-btn--ghost w-capture__retake"
            onClick={() => { setShot(null); setPhase("starting"); start(); }}
          >
            Retake
          </button>
        </span>
      )}
    </div>
  );
}
