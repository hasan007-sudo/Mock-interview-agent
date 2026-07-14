"use client";

import {
  RoomAudioRenderer,
  SessionProvider,
  useSession,
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
  const reduceMotion = useReducedMotion();
  const hasStartedRef = useRef(false);
  const hasQuestionEventsRef = useRef(false);
  const [surface, setSurface] = useState<ActiveSurface>(null);
  const [ended, setEnded] = useState(false);

  const handleAgentEvent = useCallback((event: AgentDataEvent) => {
    if (event.type === "interview_question_started") {
      hasQuestionEventsRef.current = true;
      const nextSurface = surfaceFromQuestion(event.metadata.question);
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
      setSurface({
        key: event.metadata.question,
        kind: "code",
        question: event.metadata.question,
        language: event.metadata.language,
      });
      toast.info("The interviewer opened a code editor for you.");
    } else {
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

  async function endInterview() {
    try {
      await session.end();
    } catch (error) {
      console.error("Failed to end session:", error);
    }
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
      <div className="flex h-screen flex-col">
        <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h1 className="text-sm font-medium text-neutral-100">
            Mock Technical Interview
          </h1>
          <span className="text-xs text-neutral-500">
            {session.isConnected ? "Connected" : "Connecting…"}
          </span>
        </header>

        <div className="min-h-0 flex-1 p-4">
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
                      onClose={() => setSurface(null)}
                    />
                  ) : (
                    <WhiteboardPanel
                      question={surface.question}
                      onClose={() => setSurface(null)}
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
                <CandidateTile name={connection.participantName} />
              </motion.div>
            </motion.div>
          </motion.div>
        </div>

        <ControlBar onEnd={endInterview} />
      </div>
    </SessionProvider>
  );
}
