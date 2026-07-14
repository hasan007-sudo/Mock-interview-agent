"use client";

import { BarVisualizer, useAgent } from "@livekit/components-react";
import { motion, useReducedMotion } from "motion/react";

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
  const transition = reduceMotion
    ? ({ duration: 0 } as const)
    : ({ type: "spring", stiffness: 300, damping: 32, mass: 0.8 } as const);

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      <motion.div
        layout
        animate={{
          width: compact ? 48 : 96,
          height: compact ? 48 : 96,
          fontSize: compact ? 18 : 30,
        }}
        transition={transition}
        className="flex shrink-0 items-center justify-center rounded-full bg-neutral-800 font-semibold text-neutral-300"
      >
        AI
      </motion.div>
      <motion.div
        layout
        animate={{ marginTop: compact ? 8 : 24, height: compact ? 32 : 48 }}
        transition={transition}
        className="w-full"
      >
        <BarVisualizer
          state={agent.state}
          track={agent.microphoneTrack}
          barCount={5}
          className="agent-visualizer h-full"
        />
      </motion.div>
      <div className="absolute bottom-2 left-3 flex items-center gap-2 text-xs text-neutral-400">
        <span className="font-medium text-neutral-300">Interviewer</span>
        <span>{STATE_LABELS[agent.state] ?? agent.state}</span>
      </div>
    </div>
  );
}
