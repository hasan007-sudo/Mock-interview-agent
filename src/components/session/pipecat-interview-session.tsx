"use client";

import { PipecatClientAudio, PipecatClientProvider } from "@pipecat-ai/client-react";
import { RTVIEvent, type PipecatClient } from "@pipecat-ai/client-js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type ActiveSurface,
  SessionComplete,
  SessionLayout,
  surfaceFromQuestion,
  type WhiteboardStatus,
} from "@/components/session/session-layout";
import {
  CONNECTION_STORAGE_KEY,
  type ConnectionDetails,
} from "@/lib/connection";
import {
  interviewQuestionSchema,
  type SupportedLanguage,
} from "@/lib/events";
import {
  createPipecatClient,
  getConnectParams,
  sendCodeAnswer,
  sendMcqAnswer,
} from "@/lib/pipecat";

type CodeAnswerDraft = {
  questionId: string;
  language: SupportedLanguage;
  code: string;
  revision: number;
};

type TranscriptMessage = {
  id: string;
  message: string;
  timestamp: number;
  from?: {
    isLocal?: boolean;
    identity?: string;
    name?: string;
  };
};

const MAX_CODE_ANSWER_CHARS = 20_000;

export function PipecatInterviewSession({
  connection,
}: {
  connection: ConnectionDetails;
}) {
  const router = useRouter();
  const client = useMemo(
    () =>
      createPipecatClient({
        serverUrl: connection.serverUrl,
        requestData: connection.requestData,
      }),
    [connection.serverUrl, connection.requestData],
  );

  const hasStartedRef = useRef(false);
  const seenSegmentsRef = useRef<Set<string>>(new Set());
  const codeAnswerRef = useRef<CodeAnswerDraft | null>(null);
  const surfaceRevisionRef = useRef(0);
  const [surface, setSurface] = useState<ActiveSurface>(null);
  const [ended, setEnded] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isScreenSharePending, setIsScreenSharePending] = useState(false);
  const [surfaceRevision, setSurfaceRevision] = useState(0);
  const [whiteboardStatus, setWhiteboardStatus] =
    useState<WhiteboardStatus>("idle");
  const [isWhiteboardLocked, setIsWhiteboardLocked] = useState(false);
  const [transcriptMessages, setTranscriptMessages] = useState<
    TranscriptMessage[]
  >([]);

  const publishCodeAnswer = useCallback(
    async (
      submitted: boolean,
      draft: CodeAnswerDraft | null = codeAnswerRef.current,
    ) => {
      if (!draft || !isConnected) return false;
      if (draft.code.length > MAX_CODE_ANSWER_CHARS) {
        if (submitted) {
          toast.error("Code answers are limited to 20,000 characters.");
        }
        return false;
      }

      try {
        await sendCodeAnswer(client, {
          questionId: draft.questionId,
          surface: "code",
          answerMode: "surface",
          language: draft.language,
          code: draft.code,
          revision: draft.revision,
          submitted,
        });
        return true;
      } catch (error) {
        console.error("Failed to save code answer:", error);
        if (submitted) {
          toast.error("Could not save the code answer. Please try again.");
        }
        return false;
      }
    },
    [client, isConnected],
  );

  const publishMcqAnswer = useCallback(
    async (answer: { optionIndex: number; optionText: string }) => {
      if (surface?.kind !== "choice") return false;
      if (!isConnected) {
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
        await sendMcqAnswer(client, {
          questionId: surface.key,
          optionIndex: answer.optionIndex,
          optionText: answer.optionText,
          submitted: true,
        });
        toast.success("Answer submitted!");
        return true;
      } catch (error) {
        console.error("Failed to submit MCQ answer:", error);
        toast.error("Could not submit the answer. Please try again.");
        return false;
      }
    },
    [client, isConnected, surface],
  );

  const setActiveSurface = useCallback((nextSurface: ActiveSurface) => {
    surfaceRevisionRef.current = 0;
    setSurfaceRevision(0);
    setWhiteboardStatus("idle");
    setIsWhiteboardLocked(false);
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
    (event: Record<string, unknown>) => {
      if (event.type === "interview_question_started") {
        void publishCodeAnswer(false);
        const metadata =
          typeof event.metadata === "object" && event.metadata !== null
            ? (event.metadata as Record<string, unknown>)
            : {};
        const parsed = interviewQuestionSchema.safeParse(metadata.question);
        if (parsed.success) {
          const nextSurface = surfaceFromQuestion(parsed.data);
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
      } else if (event.type === "interview_finished") {
        setEnded(true);
        toast.info("The interview has concluded. Thank you!");
      }
    },
    [publishCodeAnswer, setActiveSurface],
  );

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const connectParams = getConnectParams({
      serverUrl: connection.serverUrl,
      requestData: connection.requestData,
    });
    client
      .connect(connectParams)
      .then(() => {
        setIsConnected(true);
      })
      .catch((error: unknown) => {
        console.error("Failed to connect to Pipecat agent:", error);
        toast.error("Could not connect to the interview room.");
      });

    return () => {
      client.disconnect().catch(() => {});
    };
  }, [client]);

  useEffect(() => {
    const handleConnected = () => {
      setIsConnected(true);
    };

    const handleDisconnected = () => {
      setIsConnected(false);
      sessionStorage.removeItem(CONNECTION_STORAGE_KEY);
      router.replace("/");
    };

    const handleServerMessage = (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const raw = data as Record<string, unknown>;
      const msg = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
      const payload = (msg.type === "workspace-request" && msg.action === "switch_surface"
        ? (msg.payload as Record<string, unknown>)
        : msg) ?? {};
      handleAgentEvent(payload);
    };

    const handleBotOutput = (data: unknown) => {
      if (typeof data !== "object" || data === null) return;
      const d = data as Record<string, unknown>;
      const text = typeof d.text === "string" ? d.text : "";
      if (!text) return;

      const segmentId = typeof d.segment_id === "string" ? d.segment_id : "active-bot";

      setTranscriptMessages((prev) => {
        const index = prev.findIndex((m) => m.id === segmentId);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            message: text,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: segmentId,
            message: text,
            timestamp: Date.now(),
            from: { isLocal: false, identity: "agent", name: "Vasanth" },
          },
        ];
      });
    };

    const handleBotTtsText = (data: unknown) => {
      if (typeof data !== "object" || data === null) return;
      const d = data as Record<string, unknown>;
      const text = typeof d.text === "string" ? d.text : "";
      if (!text) return;

      setTranscriptMessages((prev) => {
        const lastIndex = prev.length - 1;
        const last = prev[lastIndex];
        if (last && !last.from?.isLocal) {
          const updated = [...prev];
          updated[lastIndex] = {
            ...last,
            message: last.message + text,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: `bot-${Date.now()}`,
            message: text,
            timestamp: Date.now(),
            from: { isLocal: false, identity: "agent", name: "Vasanth" },
          },
        ];
      });
    };

    const handleUserTranscript = (data: unknown) => {
      if (typeof data !== "object" || data === null || !("text" in data)) return;
      const text = typeof data.text === "string" ? data.text : "";
      if (!text.trim()) return;
      const isFinal =
        "final" in data && typeof data.final === "boolean" ? data.final : false;

      setTranscriptMessages((prev) => {
        const lastIndex = prev.length - 1;
        const last = prev[lastIndex];
        if (last && last.from?.isLocal && last.id.startsWith("user-active")) {
          const updated = [...prev];
          updated[lastIndex] = {
            ...last,
            id: isFinal ? `user-${Date.now()}` : last.id,
            message: text,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: isFinal ? `user-${Date.now()}` : `user-active-${Date.now()}`,
            message: text,
            timestamp: Date.now(),
            from: { isLocal: true, identity: "candidate", name: connection.participantName },
          },
        ];
      });
    };

    client.on(RTVIEvent.Connected, handleConnected);
    client.on(RTVIEvent.Disconnected, handleDisconnected);
    client.on(RTVIEvent.ServerMessage, handleServerMessage);
    client.on(RTVIEvent.BotOutput, handleBotOutput);
    client.on(RTVIEvent.BotTtsText, handleBotTtsText);
    client.on(RTVIEvent.UserTranscript, handleUserTranscript);

    return () => {
      client.off(RTVIEvent.Connected, handleConnected);
      client.off(RTVIEvent.Disconnected, handleDisconnected);
      client.off(RTVIEvent.ServerMessage, handleServerMessage);
      client.off(RTVIEvent.BotOutput, handleBotOutput);
      client.off(RTVIEvent.BotTtsText, handleBotTtsText);
      client.off(RTVIEvent.UserTranscript, handleUserTranscript);
    };
  }, [client, connection.participantName, handleAgentEvent, router]);

  const handleDisconnect = useCallback(() => {
    sessionStorage.removeItem(CONNECTION_STORAGE_KEY);
    client.disconnect().catch(() => {});
    router.replace("/");
  }, [client, router]);

  const handleLeaveCompleted = useCallback(() => {
    sessionStorage.removeItem(CONNECTION_STORAGE_KEY);
    client.disconnect().catch(() => {});
    router.replace("/");
  }, [client, router]);

  const handleCodeContentChange = useCallback(
    ({ code, language }: { code: string; language: SupportedLanguage }) => {
      if (surface?.kind !== "code") return;
      surfaceRevisionRef.current += 1;
      const nextRevision = surfaceRevisionRef.current;
      setSurfaceRevision(nextRevision);
      codeAnswerRef.current = {
        questionId: surface.key,
        language,
        code,
        revision: nextRevision,
      };
    },
    [surface],
  );

  const handleCodeSubmit = useCallback(
    async ({ code, language }: { code: string; language: SupportedLanguage }) => {
      if (surface?.kind !== "code") return false;
      const draft: CodeAnswerDraft = {
        questionId: surface.key,
        language,
        code,
        revision: surfaceRevisionRef.current + 1,
      };
      codeAnswerRef.current = draft;
      const published = await publishCodeAnswer(true, draft);
      if (published) {
        toast.success("Code answer submitted!");
      }
      return published;
    },
    [publishCodeAnswer, surface],
  );

  const handleSurfaceContentChange = useCallback(() => {
    if (isWhiteboardLocked) return;
    surfaceRevisionRef.current += 1;
    setSurfaceRevision(surfaceRevisionRef.current);
    setWhiteboardStatus("idle");
  }, [isWhiteboardLocked]);

  const handleWhiteboardSubmit = useCallback(
    async ({
      blob,
      imageSha256,
      components,
    }: {
      blob: Blob;
      imageSha256: string;
      components?: string[];
    }) => {
      if (surface?.kind !== "whiteboard" || !isConnected) {
        toast.error("Could not submit the whiteboard while disconnected.");
        return false;
      }
      const questionId = surface.key;
      setWhiteboardStatus("analyzing");
      try {
        await client.sendClientMessage("whiteboard-assessment", {
          questionId,
          imageSha256,
          status: "submitted",
          drawingSummary: {
            components: components ?? [],
          },
        });
        toast.success("Whiteboard submitted!");
        setWhiteboardStatus("ready");
        return true;
      } catch (error) {
        console.error("Failed to submit whiteboard:", error);
        toast.error("Could not submit the whiteboard.");
        setWhiteboardStatus("error");
        return false;
      }
    },
    [client, isConnected, surface],
  );

  const handleCloseSurface = useCallback(() => {
    setActiveSurface(null);
  }, [setActiveSurface]);
  const handleSendChatMessage = useCallback(
    (text: string) => {
      setTranscriptMessages((prev) => [
        ...prev,
        {
          id: `user-chat-${Date.now()}-${Math.random()}`,
          message: text,
          timestamp: Date.now(),
          from: { isLocal: true, identity: "candidate", name: connection.participantName },
        },
      ]);
    },
    [connection.participantName],
  );


  if (ended) {
    return (
      <SessionComplete
        participantName={connection.participantName}
        onLeave={handleLeaveCompleted}
      />
    );
  }

  return (
    <PipecatClientProvider client={client}>
      <PipecatClientAudio />
      <SessionLayout
        connection={connection}
        pipecatClient={client}
        isConnected={isConnected}
        surface={surface}
        transcriptMessages={transcriptMessages}
        isScreenSharing={isScreenSharing}
        isScreenSharePending={isScreenSharePending}
        isWhiteboardLocked={isWhiteboardLocked}
        whiteboardStatus={whiteboardStatus}
        primaryAgentIdentity="vasanth"
        onEnableScreenShare={() => {
          setIsScreenSharePending(true);
          try {
            client.enableScreenShare(true);
            setIsScreenSharing(true);
          } catch (err: unknown) {
            console.error("Screen share error:", err);
            toast.error("Could not start screen share.");
          } finally {
            setIsScreenSharePending(false);
          }
        }}
        onDisconnect={handleDisconnect}
        onCloseSurface={handleCloseSurface}
        onSurfaceContentChange={handleSurfaceContentChange}
        onCodeContentChange={handleCodeContentChange}
        onCodeSubmit={handleCodeSubmit}
        onMcqSubmit={publishMcqAnswer}
        onWhiteboardSubmit={handleWhiteboardSubmit}
        onSendChatMessage={handleSendChatMessage}
      />
    </PipecatClientProvider>
  );
}
