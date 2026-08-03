"use client";

import { useAgent, VideoTrack } from "@livekit/components-react";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useState } from "react";
import { AgentAudioVisualizerBar } from "@/components/agents-ui/agent-audio-visualizer-bar";

const STATE_LABELS: Record<string, string> = {
  disconnected: "Waiting to join…",
  connecting: "Joining…",
  "pre-connect-buffering": "Joining…",
  initializing: "Getting ready…",
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  failed: "Connection failed",
};

export function AgentTile({ compact = false }: { compact?: boolean }) {
  const agent = useAgent();
  const reduceMotion = useReducedMotion();
  const [readyAvatarTrackSid, setReadyAvatarTrackSid] = useState<string | null>(
    null,
  );
  const avatarVideoTrack = agent.cameraTrack;
  const avatarTrackSid = avatarVideoTrack?.publication.trackSid ?? null;
  const isAvatarVideoReady =
    avatarTrackSid !== null && readyAvatarTrackSid === avatarTrackSid;
  const transition = reduceMotion
    ? ({ duration: 0 } as const)
    : ({ type: "spring", stiffness: 300, damping: 32, mass: 0.8 } as const);

  return (
    <div className="session-tile relative flex h-full flex-col items-center justify-center overflow-hidden">
      {avatarVideoTrack && (
        <VideoTrack
          trackRef={avatarVideoTrack}
          onLoadedData={() => setReadyAvatarTrackSid(avatarTrackSid)}
          onEmptied={() => setReadyAvatarTrackSid(null)}
          onError={() => setReadyAvatarTrackSid(null)}
          className={`absolute inset-0 size-full object-cover transition-opacity ${
            isAvatarVideoReady ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      <motion.div
        layout
        animate={{
          width: compact ? 48 : 160,
          height: compact ? 48 : 160,
          opacity: isAvatarVideoReady ? 0 : 1,
        }}
        transition={transition}
        className="relative shrink-0 overflow-hidden rounded-full bg-violet-300/10 shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_0_44px_rgba(139,92,246,0.13)]"
      >
        <Image
          src="/interviewer-avatar.png"
          alt=""
          fill
          sizes={compact ? "48px" : "96px"}
          className="object-cover"
        />
      </motion.div>
      <motion.div
        layout
        animate={{
          marginTop: compact ? 6 : 18,
          opacity: isAvatarVideoReady ? 0 : 1,
        }}
        transition={transition}
        className="flex w-full justify-center"
      >
        <AgentAudioVisualizerBar
          state={agent.state}
          audioTrack={agent.microphoneTrack}
          size={compact ? "icon" : "sm"}
          barCount={5}
          color="#A78BFA"
          className={compact ? "gap-1" : "gap-2"}
        />
      </motion.div>
      <div className="absolute bottom-3 left-4 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-violet-100">Interviewer</span>
        <span className="size-1 rounded-full bg-violet-400/45" />
        <span>{STATE_LABELS[agent.state] ?? agent.state}</span>
      </div>
    </div>
  );
}
