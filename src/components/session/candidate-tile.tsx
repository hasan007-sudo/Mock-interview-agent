"use client";

import { useSessionContext, VideoTrack } from "@livekit/components-react";

export function CandidateTile({ name }: { name: string }) {
  const session = useSessionContext();
  const cameraTrack = session.local.cameraTrack;

  return (
    <div className="relative h-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      {cameraTrack ? (
        <VideoTrack
          trackRef={cameraTrack}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-neutral-500">
          Camera off
        </div>
      )}
      <div className="absolute bottom-2 left-3 rounded bg-neutral-950/70 px-2 py-0.5 text-xs font-medium text-neutral-200">
        {name}
      </div>
    </div>
  );
}
