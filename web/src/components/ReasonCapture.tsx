"use client";
import { useState } from "react";

/**
 * The second exit. A step can be satisfied or it can be explained — it can never be
 * silently abandoned, and nothing here is styled as a failure.
 *
 * Voice is the default because hands are dirty. Typing is always available, and the
 * microphone is offered rather than required.
 */
export function ReasonCapture({
  onSubmit, busy,
}: { onSubmit: (r: { kind: "voice" | "text"; transcript: string }) => void; busy?: boolean }) {
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState("");

  // Held-button voice. Until the Instructor is live, releasing writes what was said as
  // text — the shape is identical, so nothing here changes when transcription arrives.
  const stop = () => {
    setRecording(false);
    if (text.trim()) onSubmit({ kind: "voice", transcript: text.trim() });
  };

  return (
    <div className="w-reason">
      {mode === "voice" ? (
        <>
          <button
            type="button"
            className="w-reason__hold"
            data-recording={recording}
            disabled={busy}
            onPointerDown={() => setRecording(true)}
            onPointerUp={stop}
            onPointerLeave={() => recording && stop()}
          >
            <span className="w-reason__dot" aria-hidden />
            {recording ? "listening — release to send" : "hold and say why"}
          </button>
          <textarea
            className="w-reason__text"
            placeholder="What stopped you?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="What stopped you"
          />
        </>
      ) : (
        <textarea
          className="w-reason__text"
          placeholder="What stopped you?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="What stopped you"
        />
      )}

      <button
        type="button"
        className="w-reason__switch"
        onClick={() => setMode(mode === "voice" ? "text" : "voice")}
      >
        {mode === "voice" ? "type it instead" : "say it instead"}
      </button>

      <button
        type="button"
        className="w-btn w-btn--block"
        disabled={busy || !text.trim()}
        onClick={() => onSubmit({ kind: mode, transcript: text.trim() })}
      >
        {busy ? "recording the reason…" : "record this reason"}
      </button>
    </div>
  );
}
