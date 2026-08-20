"use client";

import { type ReceivedMessage } from "@livekit/components-react";
import type { Room } from "livekit-client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { AgentTile } from "@/components/session/agent-tile";
import { CandidateTile } from "@/components/session/candidate-tile";
import { CodeEditorPanel } from "@/components/session/code-editor-panel";
import { ControlBar } from "@/components/session/control-bar";
import { McqPanel } from "@/components/session/mcq-panel";
import {
  resumeRoundLabel,
  ResumeSessionLayout,
} from "@/components/session/resume-session-layout";
import { TranscriptSidebar } from "@/components/session/transcript-sidebar";
import { WhiteboardPanel } from "@/components/session/whiteboard-panel";
import {
  isResumeConnectionDetails,
  type ConnectionDetails,
} from "@/lib/connection";
import type { InterviewQuestion, SupportedLanguage } from "@/lib/events";

export type ActiveSurface =
  | {
      key: string;
      kind: "code";
      question: string;
      language: SupportedLanguage;
      answerMode: "verbal" | "surface";
      starterCode: string;
    }
  | {
      key: string;
      kind: "choice";
      question: string;
      options: string[];
      code?: string;
      language?: SupportedLanguage;
    }
  | { key: string; kind: "whiteboard"; question: string }
  | null;

export type WhiteboardStatus =
  | "idle"
  | "uploading"
  | "received"
  | "analyzing"
  | "ready"
  | "error";

const LAYOUT_TRANSITION = {
  type: "spring",
  stiffness: 300,
  damping: 32,
  mass: 0.8,
} as const;

export function surfaceFromQuestion(
  question: InterviewQuestion,
): ActiveSurface {
  if (question.surface === "code") {
    return {
      key: question.id,
      kind: "code",
      question: question.text,
      language: question.language ?? "javascript",
      answerMode: question.answerMode ?? "surface",
      starterCode: question.starterCode ?? "",
    };
  }
  if (question.surface === "whiteboard") {
    return {
      key: question.id,
      kind: "whiteboard",
      question: question.text,
    };
  }
  if (question.surface === "choice") {
    return {
      key: question.id,
      kind: "choice",
      question: question.text,
      options: question.options ?? [],
      code: question.starterCode,
      language: question.language,
    };
  }
  return null;
}

export function SessionComplete({
  participantName,
  onLeave,
}: {
  participantName: string;
  onLeave: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl bg-card p-8 text-center shadow-[var(--shadow-border)]">
        <h1 className="text-balance text-2xl font-semibold text-foreground">
          Interview complete
        </h1>
        <p className="mt-2 text-pretty text-sm text-muted-foreground">
          Thanks for practicing, {participantName}. You can start another session
          whenever you like.
        </p>
        <button
          type="button"
          onClick={onLeave}
          className="mt-6 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-[background-color,scale] hover:bg-violet-200 active:scale-[0.96]"
        >
          Back to home
        </button>
      </div>
    </main>
  );
}

type SessionLayoutProps = {
  connection: ConnectionDetails;
  room: Room;
  isConnected: boolean;
  transcriptMessages: ReceivedMessage[];
  surface: ActiveSurface;
  isScreenSharing: boolean;
  isScreenSharePending: boolean;
  isWhiteboardLocked: boolean;
  whiteboardStatus: WhiteboardStatus;
  primaryAgentIdentity: string | null;
  onEnableScreenShare: () => void;
  onDisconnect: () => void;
  onCloseSurface: () => void;
  onSurfaceContentChange: () => void;
  onCodeContentChange: (answer: {
    code: string;
    language: SupportedLanguage;
  }) => void;
  onCodeSubmit: (answer: {
    code: string;
    language: SupportedLanguage;
  }) => Promise<boolean>;
  onMcqSubmit: (answer: {
    optionIndex: number;
    optionText: string;
  }) => Promise<boolean>;
  onWhiteboardSubmit: (submission: {
    blob: Blob;
    imageSha256: string;
  }) => Promise<boolean>;
};

export function SessionLayout({
  connection,
  room,
  isConnected,
  transcriptMessages,
  surface,
  isScreenSharing,
  isScreenSharePending,
  isWhiteboardLocked,
  whiteboardStatus,
  primaryAgentIdentity,
  onEnableScreenShare,
  onDisconnect,
  onCloseSurface,
  onSurfaceContentChange,
  onCodeContentChange,
  onCodeSubmit,
  onMcqSubmit,
  onWhiteboardSubmit,
}: SessionLayoutProps) {
  const reduceMotion = useReducedMotion();
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const resumeConnection = isResumeConnectionDetails(connection)
    ? connection
    : null;
  const hasSurface = surface !== null;
  const layoutTransition = reduceMotion
    ? ({ duration: 0 } as const)
    : LAYOUT_TRANSITION;
  const roundLabel = resumeConnection
    ? resumeRoundLabel(resumeConnection.interview.round)
    : null;

  const session = (
    <div className="dark flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="session-header flex shrink-0 items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-violet-300/10 font-mono text-xs font-semibold text-violet-200 shadow-[0_0_0_1px_rgba(196,181,253,0.16)]">
            {resumeConnection ? "RM" : "MI"}
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-foreground">
              {resumeConnection
                ? `Resume Mastery · ${roundLabel}`
                : "Mock Technical Interview"}
            </h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              {resumeConnection ? "Resume session" : "Practice session"}
            </p>
          </div>
        </div>
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span
            className={`size-1.5 rounded-full ${
              isConnected
                ? "bg-violet-300 shadow-[0_0_10px_rgba(196,181,253,0.55)]"
                : "animate-pulse bg-amber-400"
            }`}
          />
          {isConnected ? "Connected" : "Connecting…"}
        </span>
      </header>

      {!resumeConnection && isConnected && !isScreenSharing && (
        <div className="flex shrink-0 items-center justify-center gap-3 border-y border-violet-300/15 bg-violet-300/8 px-4 py-2 text-xs text-violet-100">
          <span>
            Share your screen and select Entire Screen so the interviewer can
            assist during coding and whiteboard questions.
          </span>
          <button
            type="button"
            onClick={onEnableScreenShare}
            disabled={isScreenSharePending}
            className="shrink-0 rounded-md bg-violet-200 px-3 py-1.5 font-semibold text-violet-950 transition-[background-color,scale] hover:bg-violet-100 active:scale-[0.96] disabled:opacity-60"
          >
            {isScreenSharePending ? "Starting…" : "Share screen"}
          </button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 p-3 sm:p-4">
          <motion.div
            layout
            data-has-surface={hasSurface}
            transition={layoutTransition}
            className="interview-stage h-full min-h-0 gap-4"
          >
            <AnimatePresence initial={false} mode="wait">
              {surface && (
                <motion.div
                  key={`${surface.kind}:${surface.key}`}
                  layout
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }
                  }
                  className="interview-surface min-h-0 min-w-0"
                >
                  {surface.kind === "code" ? (
                    <CodeEditorPanel
                      room={room}
                      question={surface.question}
                      initialLanguage={surface.language}
                      initialCode={surface.starterCode}
                      readOnly={surface.answerMode === "verbal"}
                      onContentChange={onCodeContentChange}
                      onSubmit={onCodeSubmit}
                      onClose={onCloseSurface}
                    />
                  ) : surface.kind === "choice" ? (
                    <McqPanel
                      question={surface.question}
                      options={surface.options}
                      code={surface.code}
                      language={surface.language}
                      onSubmit={onMcqSubmit}
                      onClose={onCloseSurface}
                    />
                  ) : (
                    <WhiteboardPanel
                      room={room}
                      question={surface.question}
                      locked={isWhiteboardLocked}
                      status={whiteboardStatus}
                      onContentChange={onSurfaceContentChange}
                      onSubmit={onWhiteboardSubmit}
                      onClose={onCloseSurface}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              layout
              data-compact={hasSurface}
              transition={layoutTransition}
              className="interview-participants min-h-0 gap-4"
            >
              <motion.div layout transition={layoutTransition} className="min-h-0">
                <AgentTile compact={hasSurface} />
              </motion.div>
              <motion.div layout transition={layoutTransition} className="min-h-0">
                <CandidateTile
                  name={connection.participantName}
                  compact={hasSurface}
                />
              </motion.div>
            </motion.div>
          </motion.div>
        </div>

        <AnimatePresence initial={false}>
          {isTranscriptOpen && (
            <>
              <motion.button
                type="button"
                aria-label="Close transcript"
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsTranscriptOpen(false)}
                className="absolute inset-0 z-10 bg-[#09060f]/65 xl:hidden"
              />
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }
                }
                className="absolute inset-y-3 right-3 z-20 w-[min(22rem,calc(100%-1.5rem))] xl:static xl:inset-auto xl:z-auto xl:my-4 xl:mr-4 xl:w-[22rem] xl:shrink-0"
              >
                <TranscriptSidebar
                  messages={transcriptMessages}
                  onClose={() => setIsTranscriptOpen(false)}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <ControlBar
        isConnected={isConnected}
        isTranscriptOpen={isTranscriptOpen}
        onDisconnect={onDisconnect}
        onTranscriptOpenChange={setIsTranscriptOpen}
      />
    </div>
  );

  return resumeConnection ? (
    <ResumeSessionLayout
      connection={resumeConnection}
      agentIdentity={primaryAgentIdentity}
    >
      {session}
    </ResumeSessionLayout>
  ) : (
    session
  );
}
