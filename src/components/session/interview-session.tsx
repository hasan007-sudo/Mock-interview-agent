"use client";

import {
  RoomAudioRenderer,
  SessionProvider,
  useSession,
  useSessionMessages,
} from "@livekit/components-react";
import {
  ParticipantKind,
  RoomEvent,
  TokenSource,
  type RemoteParticipant,
} from "livekit-client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AgentTile } from "@/components/session/agent-tile";
import { CandidateTile } from "@/components/session/candidate-tile";
import { CodeEditorPanel } from "@/components/session/code-editor-panel";
import { ControlBar } from "@/components/session/control-bar";
import { McqPanel } from "@/components/session/mcq-panel";
import { TranscriptSidebar } from "@/components/session/transcript-sidebar";
import { WhiteboardPanel } from "@/components/session/whiteboard-panel";
import { useRoomEventLogger } from "@/hooks/use-room-event-logger";
import { CONNECTION_STORAGE_KEY, type ConnectionDetails } from "@/lib/connection";
import type {
  AgentDataEvent,
  InterviewQuestion,
  SupportedLanguage,
} from "@/lib/events";

type ActiveSurface =
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

type CodeAnswerDraft = {
  questionId: string;
  language: SupportedLanguage;
  code: string;
  revision: number;
};

const LAYOUT_TRANSITION = {
  type: "spring",
  stiffness: 300,
  damping: 32,
  mass: 0.8,
} as const;

const SURFACE_STATE_PUBLISH_INTERVAL_MS = 5_000;
const CODE_ANSWER_TOPIC = "candidate.code_answer";
const MCQ_ANSWER_TOPIC = "candidate.mcq_answer";
const MAX_CODE_ANSWER_CHARS = 20_000;
const PUBLISH_ON_BEHALF_ATTRIBUTE = "lk.publish_on_behalf";

function surfaceFromQuestion(question: InterviewQuestion): ActiveSurface {
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

export function InterviewSession({
  connection,
}: {
  connection: ConnectionDetails;
}) {
  const router = useRouter();
  const tokenSource = useMemo(
    () =>
      TokenSource.literal({
        serverUrl: connection.serverUrl,
        participantToken: connection.participantToken,
      }),
    [connection.serverUrl, connection.participantToken],
  );
  const session = useSession(tokenSource);
  const { messages: transcriptMessages } = useSessionMessages(session);
  const reduceMotion = useReducedMotion();
  const hasStartedRef = useRef(false);
  const lastSurfaceStatePublishedAtRef = useRef(0);
  const codeAnswerRef = useRef<CodeAnswerDraft | null>(null);
  const surfaceRevisionRef = useRef(0);
  const [surface, setSurface] = useState<ActiveSurface>(null);
  const [ended, setEnded] = useState(false);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isScreenSharePending, setIsScreenSharePending] = useState(false);
  const [surfaceRevision, setSurfaceRevision] = useState(0);

  const publishCodeAnswer = useCallback(
    async (
      submitted: boolean,
      draft: CodeAnswerDraft | null = codeAnswerRef.current,
    ) => {
      if (!draft || !session.isConnected) return false;
      if (draft.code.length > MAX_CODE_ANSWER_CHARS) {
        if (submitted) {
          toast.error("Code answers are limited to 20,000 characters.");
        }
        return false;
      }

      try {
        await session.room.localParticipant.sendText(
          JSON.stringify({
            questionId: draft.questionId,
            surface: "code",
            answerMode: "surface",
            language: draft.language,
            code: draft.code,
            revision: draft.revision,
            submitted,
          }),
          { topic: CODE_ANSWER_TOPIC },
        );
        return true;
      } catch (error) {
        console.error("Failed to save code answer:", error);
        if (submitted) {
          toast.error("Could not save the code answer. Please try again.");
        }
        return false;
      }
    },
    [session.isConnected, session.room],
  );

  const publishMcqAnswer = useCallback(
    async (answer: { optionIndex: number; optionText: string }) => {
      if (surface?.kind !== "choice") return false;
      if (!session.isConnected) {
        toast.error("Could not submit the answer while disconnected.");
        return false;
      }
      if (
        answer.optionIndex < 0 ||
        answer.optionIndex >= surface.options.length ||
        surface.options[answer.optionIndex] !== answer.optionText
      ) {
        toast.error("Select a valid answer before submitting.");
        return false;
      }

      try {
        await session.room.localParticipant.sendText(
          JSON.stringify({
            questionId: surface.key,
            optionIndex: answer.optionIndex,
            optionText: answer.optionText,
            submitted: true,
          }),
          { topic: MCQ_ANSWER_TOPIC },
        );
        return true;
      } catch (error) {
        console.error("Failed to submit MCQ answer:", error);
        toast.error("Could not submit the answer. Please try again.");
        return false;
      }
    },
    [session.isConnected, session.room, surface],
  );

  const setActiveSurface = useCallback((nextSurface: ActiveSurface) => {
    surfaceRevisionRef.current = 0;
    setSurfaceRevision(0);
    codeAnswerRef.current =
      nextSurface?.kind === "code" && nextSurface.answerMode === "surface"
        ? {
            questionId: nextSurface.key,
            language: nextSurface.language,
            code: nextSurface.starterCode,
            revision: 0,
          }
        : null;
    setSurface(nextSurface);
  }, []);

  const handleAgentEvent = useCallback(
    (event: AgentDataEvent) => {
      if (event.type === "interview_question_started") {
        void publishCodeAnswer(false);
        const nextSurface = surfaceFromQuestion(event.metadata.question);
        setActiveSurface(nextSurface);

        if (nextSurface?.kind === "code") {
          toast.info(
            nextSurface.answerMode === "verbal"
              ? "The interviewer displayed code for you."
              : "The interviewer opened a code editor for you.",
          );
        } else if (nextSurface?.kind === "whiteboard") {
          toast.info("The interviewer opened a whiteboard for you.");
        } else if (nextSurface?.kind === "choice") {
          toast.info("The interviewer opened a multiple-choice question for you.");
        }
      }
    },
    [publishCodeAnswer, setActiveSurface],
  );

  useRoomEventLogger(session.room, handleAgentEvent);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    session
      .start({
        tracks: {
          microphone: { enabled: true },
          camera: { enabled: true },
        },
      })
      .catch((error) => {
        console.error("Failed to start session:", error);
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          toast.error(
            "Microphone or camera access was denied. Allow access and reload to be heard.",
          );
        } else {
          toast.error("Could not connect to the interview room.");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const room = session.room;
    const handleRoomDisconnected = () => {
      sessionStorage.removeItem(CONNECTION_STORAGE_KEY);
      router.replace("/");
    };
    const handleParticipantDisconnected = (participant: RemoteParticipant) => {
      const isPrimaryAgent =
        participant.kind === ParticipantKind.AGENT &&
        !participant.attributes[PUBLISH_ON_BEHALF_ATTRIBUTE];
      if (isPrimaryAgent) {
        setEnded(true);
      }
    };

    room.on(RoomEvent.Disconnected, handleRoomDisconnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, handleRoomDisconnected);
      room.off(
        RoomEvent.ParticipantDisconnected,
        handleParticipantDisconnected,
      );
    };
  }, [router, session.room]);

  useEffect(() => {
    const room = session.room;
    const syncScreenShareState = () => {
      setIsScreenSharing(room.localParticipant.isScreenShareEnabled);
    };

    syncScreenShareState();
    room.on(RoomEvent.LocalTrackPublished, syncScreenShareState);
    room.on(RoomEvent.LocalTrackUnpublished, syncScreenShareState);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, syncScreenShareState);
      room.off(RoomEvent.LocalTrackUnpublished, syncScreenShareState);
    };
  }, [session.room]);

  const publishCandidateSurfaceState = useCallback(() => {
    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: "candidate_surface_state",
        visible: surface !== null,
        surface: surface?.kind ?? null,
        question_id: surface?.key ?? null,
        content_revision: surfaceRevision,
      }),
    );
    return session.room.localParticipant.publishData(payload, {
      reliable: true,
      topic: "candidate.surface_state",
    });
  }, [session.room, surface, surfaceRevision]);

  useEffect(() => {
    if (!session.isConnected) return;

    const elapsed = Date.now() - lastSurfaceStatePublishedAtRef.current;
    const delay =
      surfaceRevision === 0
        ? 0
        : Math.max(0, SURFACE_STATE_PUBLISH_INTERVAL_MS - elapsed);
    const timeout = window.setTimeout(() => {
      lastSurfaceStatePublishedAtRef.current = Date.now();
      const codeAnswer = codeAnswerRef.current;
      Promise.all([
        publishCandidateSurfaceState(),
        publishCodeAnswer(false, codeAnswer),
      ]).catch((error) => {
        lastSurfaceStatePublishedAtRef.current = 0;
        console.error("Failed to publish candidate surface state:", error);
      });
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [
    publishCandidateSurfaceState,
    publishCodeAnswer,
    session.isConnected,
    surfaceRevision,
  ]);

  const handleSurfaceContentChange = useCallback(() => {
    surfaceRevisionRef.current += 1;
    setSurfaceRevision(surfaceRevisionRef.current);
  }, []);

  const handleCodeContentChange = useCallback(
    (answer: { code: string; language: SupportedLanguage }) => {
      if (
        surface?.kind !== "code" ||
        surface.answerMode !== "surface" ||
        answer.code.length > MAX_CODE_ANSWER_CHARS
      ) {
        return;
      }

      surfaceRevisionRef.current += 1;
      const revision = surfaceRevisionRef.current;
      codeAnswerRef.current = {
        questionId: surface.key,
        language: answer.language,
        code: answer.code,
        revision,
      };
      setSurfaceRevision(revision);
    },
    [surface],
  );

  const handleCodeSubmit = useCallback(
    (answer: { code: string; language: SupportedLanguage }) => {
      if (
        surface?.kind !== "code" ||
        surface.answerMode !== "surface" ||
        answer.code.length > MAX_CODE_ANSWER_CHARS
      ) {
        return Promise.resolve(false);
      }

      const draft: CodeAnswerDraft = {
        questionId: surface.key,
        language: answer.language,
        code: answer.code,
        revision: surfaceRevisionRef.current,
      };
      codeAnswerRef.current = draft;
      return publishCodeAnswer(true, draft);
    },
    [publishCodeAnswer, surface],
  );

  const handleCloseSurface = useCallback(() => {
    void publishCodeAnswer(false);
    setActiveSurface(null);
  }, [publishCodeAnswer, setActiveSurface]);

  async function handleEnableScreenShare() {
    if (isScreenSharePending) return;
    setIsScreenSharePending(true);
    try {
      await session.room.localParticipant.setScreenShareEnabled(true);
    } catch (error) {
      console.error("Failed to share screen:", error);
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        toast.error("Screen sharing was cancelled or denied.");
      } else {
        toast.error("Could not start screen sharing on this device.");
      }
    } finally {
      setIsScreenSharePending(false);
    }
  }

  function handleDisconnect() {
    void publishCodeAnswer(false);
    setEnded(true);
  }

  function leaveToHome() {
    sessionStorage.removeItem(CONNECTION_STORAGE_KEY);
    router.push("/");
  }

  if (ended) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl bg-card p-8 text-center shadow-[var(--shadow-border)]">
          <h1 className="text-balance text-2xl font-semibold text-foreground">
            Interview complete
          </h1>
          <p className="mt-2 text-pretty text-sm text-muted-foreground">
            Thanks for practicing, {connection.participantName}. You can start
            another session whenever you like.
          </p>
          <button
            type="button"
            onClick={leaveToHome}
            className="mt-6 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-[background-color,scale] hover:bg-violet-200 active:scale-[0.96]"
          >
            Back to home
          </button>
        </div>
      </main>
    );
  }

  const hasSurface = surface !== null;
  const layoutTransition = reduceMotion
    ? ({ duration: 0 } as const)
    : LAYOUT_TRANSITION;

  return (
    <SessionProvider session={session}>
      <RoomAudioRenderer room={session.room} />
      <div className="dark flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <header className="session-header flex shrink-0 items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-violet-300/10 font-mono text-xs font-semibold text-violet-200 shadow-[0_0_0_1px_rgba(196,181,253,0.16)]">
              MI
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-foreground">
                Mock Technical Interview
              </h1>
              <p className="hidden text-[11px] text-muted-foreground sm:block">
                Practice session
              </p>
            </div>
          </div>
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span
              className={`size-1.5 rounded-full ${
                session.isConnected
                  ? "bg-violet-300 shadow-[0_0_10px_rgba(196,181,253,0.55)]"
                  : "animate-pulse bg-amber-400"
              }`}
            />
            {session.isConnected ? "Connected" : "Connecting…"}
          </span>
        </header>

        {session.isConnected && !isScreenSharing && (
          <div className="flex shrink-0 items-center justify-center gap-3 border-y border-violet-300/15 bg-violet-300/8 px-4 py-2 text-xs text-violet-100">
            <span>
              Share your screen and select Entire Screen so the interviewer can
              assist during coding and whiteboard questions.
            </span>
            <button
              type="button"
              onClick={handleEnableScreenShare}
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
              <AnimatePresence initial={false} mode="popLayout">
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
                        question={surface.question}
                        initialLanguage={surface.language}
                        initialCode={surface.starterCode}
                        readOnly={surface.answerMode === "verbal"}
                        onContentChange={handleCodeContentChange}
                        onSubmit={handleCodeSubmit}
                        onClose={handleCloseSurface}
                      />
                    ) : surface.kind === "choice" ? (
                      <McqPanel
                        question={surface.question}
                        options={surface.options}
                        code={surface.code}
                        language={surface.language}
                        onSubmit={publishMcqAnswer}
                        onClose={handleCloseSurface}
                      />
                    ) : (
                      <WhiteboardPanel
                        question={surface.question}
                        onContentChange={handleSurfaceContentChange}
                        onClose={handleCloseSurface}
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
                <motion.div
                  layout
                  transition={layoutTransition}
                  className="min-h-0"
                >
                  <AgentTile compact={hasSurface} />
                </motion.div>
                <motion.div
                  layout
                  transition={layoutTransition}
                  className="min-h-0"
                >
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
          isConnected={session.isConnected}
          isTranscriptOpen={isTranscriptOpen}
          onDisconnect={handleDisconnect}
          onTranscriptOpenChange={setIsTranscriptOpen}
        />
      </div>
    </SessionProvider>
  );
}
