"use client";

import {
  useSessionContext,
  useTrackToggle,
  VideoTrack,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { UserRound } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

function CandidatePlaceholder({ compact }: { compact: boolean }) {
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion
    ? ({ duration: 0 } as const)
    : ({ type: "spring", stiffness: 300, damping: 32, mass: 0.8 } as const);

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background/35">
      <motion.div
        layout
        animate={{
          width: compact ? 48 : 96,
          height: compact ? 48 : 96,
        }}
        transition={transition}
        className="flex shrink-0 items-center justify-center rounded-full bg-violet-300/8 text-violet-200 shadow-[0_0_0_1px_rgba(196,181,253,0.13)]"
      >
        <UserRound
          aria-hidden="true"
          className={compact ? "size-5" : "size-10"}
          strokeWidth={1.6}
        />
      </motion.div>
      {!compact && (
        <span className="mt-4 text-xs font-medium text-muted-foreground">
          Camera off
        </span>
      )}
    </div>
  );
}

function CandidateVideo({
  trackRef,
  compact,
}: {
  trackRef: NonNullable<ReturnType<typeof useSessionContext>["local"]["cameraTrack"]>;
  compact: boolean;
}) {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <>
      <VideoTrack
        trackRef={trackRef}
        onPlaying={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsPlaying(false)}
        className="h-full w-full object-cover"
      />
      <div
        aria-hidden={isPlaying}
        className={`absolute inset-0 transition-opacity duration-150 ${
          isPlaying ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <CandidatePlaceholder compact={compact} />
      </div>
    </>
  );
}

export function CandidateTile({
  name,
  compact = false,
}: {
  name: string;
  compact?: boolean;
}) {
  const session = useSessionContext();
  const cameraTrack = session.local.cameraTrack;
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const showVideo = camera.enabled && cameraTrack;

  return (
    <div className="session-tile relative h-full overflow-hidden">
      {showVideo ? (
        <CandidateVideo
          trackRef={cameraTrack}
          compact={compact}
        />
      ) : (
        <CandidatePlaceholder compact={compact} />
      )}
      <div className="absolute bottom-3 left-4 rounded-md bg-[#0d0915]/80 px-2 py-1 text-xs font-medium text-violet-50 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] backdrop-blur-sm">
        {name}
      </div>
    </div>
  );
}
