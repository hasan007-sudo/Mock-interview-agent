"use client";

import { useAgent } from "@livekit/components-react";
import { motion, useReducedMotion } from "motion/react";
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
  const transition = reduceMotion
    ? ({ duration: 0 } as const)
    : ({ type: "spring", stiffness: 300, damping: 32, mass: 0.8 } as const);

  return (
    <div className="session-tile relative flex h-full flex-col items-center justify-center overflow-hidden">
      <motion.div
        layout
        animate={{
          width: compact ? 48 : 96,
          height: compact ? 48 : 96,
          fontSize: compact ? 18 : 30,
        }}
        transition={transition}
        className="flex shrink-0 items-center justify-center rounded-full border border-sky-300/15 bg-slate-800/80 font-semibold tracking-tight text-slate-100 shadow-[0_0_40px_rgba(56,139,253,0.1)]"
      >
        AI
      </motion.div>
      <motion.div
        layout
        animate={{ marginTop: compact ? 6 : 18 }}
        transition={transition}
        className="flex w-full justify-center"
      >
        <AgentAudioVisualizerBar
          state={agent.state}
          audioTrack={agent.microphoneTrack}
          size={compact ? "icon" : "sm"}
          barCount={5}
          color="#62A8FF"
          className={compact ? "gap-1" : "gap-2"}
        />
      </motion.div>
      <div className="absolute bottom-3 left-4 flex items-center gap-2 text-xs text-slate-400">
        <span className="font-medium text-slate-200">Interviewer</span>
        <span className="size-1 rounded-full bg-slate-600" />
        <span>{STATE_LABELS[agent.state] ?? agent.state}</span>
      </div>
    </div>
  );
}
