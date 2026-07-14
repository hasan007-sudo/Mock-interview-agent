"use client";

import { useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { useState } from "react";

function ToggleButton({
  enabled,
  onLabel,
  offLabel,
  buttonProps,
}: {
  enabled: boolean;
  onLabel: string;
  offLabel: string;
  buttonProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <button
      {...buttonProps}
      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
        enabled
          ? "border-neutral-700 bg-neutral-800 text-neutral-100 hover:bg-neutral-700"
          : "border-red-900 bg-red-950 text-red-300 hover:bg-red-900"
      }`}
    >
      {enabled ? onLabel : offLabel}
    </button>
  );
}

export function ControlBar({ onEnd }: { onEnd: () => Promise<void> }) {
  const microphone = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const [isEnding, setIsEnding] = useState(false);

  async function handleEnd() {
    if (isEnding) return;
    setIsEnding(true);
    try {
      await onEnd();
    } finally {
      setIsEnding(false);
    }
  }

  return (
    <footer className="flex items-center justify-center gap-3 border-t border-neutral-800 px-4 py-3">
      <ToggleButton
        enabled={microphone.enabled}
        onLabel="Mute mic"
        offLabel="Unmute mic"
        buttonProps={microphone.buttonProps}
      />
      <ToggleButton
        enabled={camera.enabled}
        onLabel="Turn off camera"
        offLabel="Turn on camera"
        buttonProps={camera.buttonProps}
      />
      <button
        type="button"
        onClick={handleEnd}
        disabled={isEnding}
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
      >
        {isEnding ? "Ending…" : "End interview"}
      </button>
    </footer>
  );
}
