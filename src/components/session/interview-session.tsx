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
import { useRoomEventLogger } from "@/hooks/use-room-event-logger";
import { CONNECTION_STORAGE_KEY, type ConnectionDetails } from "@/lib/connection";
import type { AgentDataEvent, SupportedLanguage } from "@/lib/events";

type CodeAnswerDraft = {
  questionId: string;
  language: SupportedLanguage;
  code: string;
  revision: number;
};

type WhiteboardAcknowledgement = {
  accepted: boolean;
  message?: string;
};

const SURFACE_STATE_PUBLISH_INTERVAL_MS = 5_000;
const CODE_ANSWER_TOPIC = "candidate.code_answer";
const MCQ_ANSWER_TOPIC = "candidate.mcq_answer";
const WHITEBOARD_EVALUATION_TOPIC = "candidate.whiteboard_evaluation";
const WHITEBOARD_ACK_TIMEOUT_MS = 15_000;
const MAX_CODE_ANSWER_CHARS = 20_000;
const PUBLISH_ON_BEHALF_ATTRIBUTE = "lk.publish_on_behalf";

function isPrimaryAgent(participant: RemoteParticipant) {
  return (
    participant.kind === ParticipantKind.AGENT &&
    !participant.attributes[PUBLISH_ON_BEHALF_ATTRIBUTE]
  );
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
  const hasStartedRef = useRef(false);
  const lastSurfaceStatePublishedAtRef = useRef(0);
  const codeAnswerRef = useRef<CodeAnswerDraft | null>(null);
  const surfaceRevisionRef = useRef(0);
  const whiteboardAcknowledgementsRef = useRef(
    new Map<string, (acknowledgement: WhiteboardAcknowledgement) => void>(),
  );
  const [surface, setSurface] = useState<ActiveSurface>(null);
  const [ended, setEnded] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isScreenSharePending, setIsScreenSharePending] = useState(false);
  const [primaryAgentIdentity, setPrimaryAgentIdentity] = useState<
    string | null
  >(
    () =>
      Array.from(session.room.remoteParticipants.values()).find(isPrimaryAgent)
        ?.identity ?? null,
  );
  const [surfaceRevision, setSurfaceRevision] = useState(0);
  const [whiteboardStatus, setWhiteboardStatus] =
    useState<WhiteboardStatus>("idle");
  const [isWhiteboardLocked, setIsWhiteboardLocked] = useState(false);

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
      } else if (event.type === "whiteboard_answer_status") {
        const key = `${event.questionId}:${event.revision}`;
        const resolve = whiteboardAcknowledgementsRef.current.get(key);
        if (resolve) {
          whiteboardAcknowledgementsRef.current.delete(key);
          resolve({
            accepted: event.status === "accepted",
            message: event.message,
          });
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
    const handleParticipantConnected = (participant: RemoteParticipant) => {
      if (isPrimaryAgent(participant)) {
        setPrimaryAgentIdentity(participant.identity);
      }
    };
    const handleParticipantDisconnected = (participant: RemoteParticipant) => {
      if (isPrimaryAgent(participant)) {
        setPrimaryAgentIdentity(null);
        setEnded(true);
      }
    };

    room.on(RoomEvent.Disconnected, handleRoomDisconnected);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, handleRoomDisconnected);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
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
    if (isWhiteboardLocked) return;
    surfaceRevisionRef.current += 1;
    setSurfaceRevision(surfaceRevisionRef.current);
    setWhiteboardStatus("idle");
  }, [isWhiteboardLocked]);

  const handleWhiteboardSubmit = useCallback(
    async ({ blob, imageSha256 }: { blob: Blob; imageSha256: string }) => {
      if (surface?.kind !== "whiteboard" || !session.isConnected) {
        toast.error("Could not submit the whiteboard while disconnected.");
        return false;
      }
      const questionId = surface.key;
      const question = surface.question;
      const revision = surfaceRevisionRef.current;
      const acknowledgementKey = `${questionId}:${revision}`;
      let acknowledgementTimeout: number | undefined;
      setWhiteboardStatus("uploading");

      try {
        const file = new File(
          [blob],
          `whiteboard.${revision}.${imageSha256}.png`,
          { type: "image/png" },
        );
        const authorization = { Authorization: `Bearer ${connection.participantToken}` };
        const uploadResponse = await fetch("/api/whiteboard-upload", {
          method: "POST",
          headers: { ...authorization, "Content-Type": "application/json" },
          body: JSON.stringify({
            roomName: connection.roomName,
            participantIdentity: session.room.localParticipant.identity,
            questionId,
            revision,
            imageSha256,
            imageBytes: file.size,
          }),
        });
        if (!uploadResponse.ok) {
          throw new Error(`Whiteboard upload setup failed with ${uploadResponse.status}`);
        }
        const upload = (await uploadResponse.json()) as {
          uploadUrl?: unknown;
          s3Key?: unknown;
          headers?: unknown;
        };
        if (
          typeof upload.uploadUrl !== "string" ||
          typeof upload.s3Key !== "string" ||
          !upload.headers ||
          typeof upload.headers !== "object"
        ) {
          throw new Error("Whiteboard upload setup returned an invalid response");
        }
        const uploadStartedAt = Date.now();
        console.info(
          `[EXT-API:s3-whiteboard] upload_started question_id=${questionId} bytes=${file.size}`,
        );
        let s3Response: Response;
        try {
          s3Response = await fetch(upload.uploadUrl, {
            method: "PUT",
            headers: upload.headers as Record<string, string>,
            body: file,
          });
        } catch (error) {
          console.error(
            `[EXT-API:s3-whiteboard] upload_failed question_id=${questionId} elapsed_ms=${Date.now() - uploadStartedAt}`,
            error,
          );
          throw error;
        }
        if (!s3Response.ok) {
          console.error(
            `[EXT-API:s3-whiteboard] upload_failed question_id=${questionId} status=${s3Response.status} elapsed_ms=${Date.now() - uploadStartedAt}`,
          );
          throw new Error(`Whiteboard S3 upload failed with ${s3Response.status}`);
        }
        console.info(
          `[EXT-API:s3-whiteboard] upload_completed question_id=${questionId} bytes=${file.size} elapsed_ms=${Date.now() - uploadStartedAt}`,
        );

        setWhiteboardStatus("received");
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        setWhiteboardStatus("analyzing");
        const response = await fetch("/api/evaluate", {
          method: "POST",
          headers: { ...authorization, "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            roomName: connection.roomName,
            participantIdentity: session.room.localParticipant.identity,
            questionId,
            revision,
            imageSha256,
            imageBytes: file.size,
            s3Key: upload.s3Key,
          }),
        });
        if (!response.ok) {
          throw new Error(`Whiteboard evaluation failed with ${response.status}`);
        }
        const signedAssessment = (await response.json()) as {
          payload?: unknown;
          signature?: unknown;
        };
        if (
          typeof signedAssessment.payload !== "string" ||
          typeof signedAssessment.signature !== "string"
        ) {
          throw new Error("Whiteboard evaluation returned an invalid response");
        }
        const acknowledgement = new Promise<WhiteboardAcknowledgement>((resolve) => {
          whiteboardAcknowledgementsRef.current.set(acknowledgementKey, resolve);
        });
        acknowledgementTimeout = window.setTimeout(() => {
          const resolve = whiteboardAcknowledgementsRef.current.get(acknowledgementKey);
          if (resolve) {
            whiteboardAcknowledgementsRef.current.delete(acknowledgementKey);
            resolve({
              accepted: false,
              message: "The interviewer did not acknowledge the drawing.",
            });
          }
        }, WHITEBOARD_ACK_TIMEOUT_MS);
        await session.room.localParticipant.sendText(
          JSON.stringify(signedAssessment),
          { topic: WHITEBOARD_EVALUATION_TOPIC },
        );
        const ack = await acknowledgement;
        window.clearTimeout(acknowledgementTimeout);
        acknowledgementTimeout = undefined;
        if (!ack.accepted) {
          setWhiteboardStatus("error");
          toast.error(ack.message ?? "The whiteboard was rejected. Please try again.");
          return false;
        }
        setIsWhiteboardLocked(true);
        setWhiteboardStatus("ready");
        toast.success("Drawing received. Walk through your approach aloud.");
        return true;
      } catch (error) {
        whiteboardAcknowledgementsRef.current.delete(acknowledgementKey);
        console.error("Failed to submit whiteboard:", error);
        setWhiteboardStatus("error");
        toast.error("Could not submit the whiteboard. Please try again.");
        return false;
      } finally {
        if (acknowledgementTimeout !== undefined) {
          window.clearTimeout(acknowledgementTimeout);
        }
      }
    },
    [connection.participantToken, connection.roomName, session.isConnected, session.room, surface],
  );

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
      <SessionComplete
        participantName={connection.participantName}
        onLeave={leaveToHome}
      />
    );
  }

  return (
    <SessionProvider session={session}>
      <RoomAudioRenderer room={session.room} />
      <SessionLayout
        connection={connection}
        room={session.room}
        isConnected={session.isConnected}
        transcriptMessages={transcriptMessages}
        surface={surface}
        isScreenSharing={isScreenSharing}
        isScreenSharePending={isScreenSharePending}
        isWhiteboardLocked={isWhiteboardLocked}
        whiteboardStatus={whiteboardStatus}
        primaryAgentIdentity={primaryAgentIdentity}
        onEnableScreenShare={() => void handleEnableScreenShare()}
        onDisconnect={handleDisconnect}
        onCloseSurface={handleCloseSurface}
        onSurfaceContentChange={handleSurfaceContentChange}
        onCodeContentChange={handleCodeContentChange}
        onCodeSubmit={handleCodeSubmit}
        onMcqSubmit={publishMcqAnswer}
        onWhiteboardSubmit={handleWhiteboardSubmit}
      />
    </SessionProvider>
  );
}
