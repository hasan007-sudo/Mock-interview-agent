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
    }
  | { key: string; kind: "whiteboard"; question: string }
  | null;

const LAYOUT_TRANSITION = {
  type: "spring",
  stiffness: 300,
  damping: 32,
  mass: 0.8,
} as const;

const SURFACE_STATE_PUBLISH_INTERVAL_MS = 5_000;

function surfaceFromQuestion(question: InterviewQuestion): ActiveSurface {
  if (question.surface === "code") {
    return {
      key: question.id,
      kind: "code",
      question: question.text,
      language: question.language ?? "javascript",
    };
  }
  if (question.surface === "whiteboard") {
    return {
      key: question.id,
      kind: "whiteboard",
      question: question.text,
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
  const hasQuestionEventsRef = useRef(false);
  const lastSurfaceStatePublishedAtRef = useRef(0);
  const [surface, setSurface] = useState<ActiveSurface>(null);
  const [ended, setEnded] = useState(false);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isScreenSharePending, setIsScreenSharePending] = useState(false);
  const [surfaceRevision, setSurfaceRevision] = useState(0);

  const handleAgentEvent = useCallback((event: AgentDataEvent) => {
    if (event.type === "interview_question_started") {
      hasQuestionEventsRef.current = true;
      const nextSurface = surfaceFromQuestion(event.metadata.question);
      setSurfaceRevision(0);
      setSurface(nextSurface);

      if (nextSurface?.kind === "code") {
        toast.info("The interviewer opened a code editor for you.");
      } else if (nextSurface?.kind === "whiteboard") {
        toast.info("The interviewer opened a whiteboard for you.");
      }
      return;
    }

    // Keep compatibility with workers that have not started publishing the
    // full question event yet. Once that event is seen, it owns UI lifecycle.
    if (hasQuestionEventsRef.current) return;

    if (event.type === "open_code_editor") {
      setSurfaceRevision(0);
      setSurface({
        key: event.metadata.question,
        kind: "code",
        question: event.metadata.question,
        language: event.metadata.language,
      });
      toast.info("The interviewer opened a code editor for you.");
    } else {
      setSurfaceRevision(0);
      setSurface({
        key: event.metadata.question,
        kind: "whiteboard",
        question: event.metadata.question,
      });
      toast.info("The interviewer opened a whiteboard for you.");
    }
  }, []);

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
    const handleParticipantDisconnected = (participant: RemoteParticipant) => {
      if (participant.kind === ParticipantKind.AGENT) {
        setEnded(true);
      }
    };

    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    return () => {
      room.off(
        RoomEvent.ParticipantDisconnected,
        handleParticipantDisconnected,
      );
    };
  }, [session.room]);

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
      publishCandidateSurfaceState().catch((error) => {
        lastSurfaceStatePublishedAtRef.current = 0;
        console.error("Failed to publish candidate surface state:", error);
      });
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [publishCandidateSurfaceState, session.isConnected, surfaceRevision]);

  const handleSurfaceContentChange = useCallback(() => {
    setSurfaceRevision((revision) => revision + 1);
  }, []);

  const handleCloseSurface = useCallback(() => {
    setSurfaceRevision(0);
    setSurface(null);
  }, []);

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
    setEnded(true);
  }

  function leaveToHome() {
    sessionStorage.removeItem(CONNECTION_STORAGE_KEY);
    router.push("/");
  }

  if (ended) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <h1 className="text-2xl font-semibold text-neutral-100">
            Interview complete
          </h1>
          <p className="mt-2 text-sm text-neutral-400">
            Thanks for practicing, {connection.participantName}. You can start
            another session whenever you like.
          </p>
          <button
            type="button"
            onClick={leaveToHome}
            className="mt-6 rounded-lg bg-white px-4 py-2.5 font-medium text-neutral-950 hover:bg-neutral-200"
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
      <div className="dark flex h-dvh flex-col overflow-hidden bg-[#07101c] text-slate-100">
        <header className="session-header flex shrink-0 items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg border border-sky-300/15 bg-sky-400/10 font-mono text-xs font-semibold text-sky-300">
              MI
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-slate-100">
                Mock Technical Interview
              </h1>
              <p className="hidden text-[11px] text-slate-500 sm:block">
                Practice session
              </p>
            </div>
          </div>
          <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <span
              className={`size-1.5 rounded-full ${
                session.isConnected
                  ? "bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.7)]"
                  : "animate-pulse bg-amber-400"
              }`}
            />
            {session.isConnected ? "Connected" : "Connecting…"}
          </span>
        </header>

        {session.isConnected && !isScreenSharing && (
          <div className="flex shrink-0 items-center justify-center gap-3 border-y border-amber-300/15 bg-amber-300/8 px-4 py-2 text-xs text-amber-100">
            <span>
              Share your screen and select Entire Screen so the interviewer can
              assist during coding and whiteboard questions.
            </span>
            <button
              type="button"
              onClick={handleEnableScreenShare}
              disabled={isScreenSharePending}
              className="shrink-0 rounded-md bg-amber-200 px-3 py-1.5 font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-60"
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
                      onContentChange={handleSurfaceContentChange}
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
                  className="absolute inset-0 z-10 bg-slate-950/55 xl:hidden"
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
