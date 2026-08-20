import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ResumeConnectionDetailsSchema,
  ResumeSessionRequestSchema,
} from "@/lib/connection";
import {
  createAgentDispatchClient,
  createParticipantToken,
  createRoomServiceClient,
  getLiveKitCredentials,
} from "@/lib/livekit";
import {
  RESUME_DOCUMENT_LIMITS,
  ResumeDocumentError,
  validateResumeDocument,
} from "@/lib/resume-document";
import {
  createResumeStorage,
  deleteResumeArtifacts,
  uploadResumeArtifacts,
} from "@/lib/resume-storage";
import { sha256Hex } from "@/lib/source-documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIVEKIT_LOG_PREFIX = "[EXT-API:livekit-resume]";
const MULTIPART_FIELDS = ["request", "document", "file"] as const;
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

const RoomMetadataSchema = z
  .object({
    session: z
      .object({
        id: z.string().uuid(),
        artifact_prefix: z.string().min(1),
        created_at: z.iso.datetime(),
      })
      .strict(),
    interview: z
      .object({
        type: z.literal("resume_mastery"),
        version: z.literal("v1"),
        round: z.enum(["round_1", "round_2", "round_3"]),
      })
      .strict(),
    ui: z.object({ resume_available: z.literal(true) }).strict(),
  })
  .strict();

const DispatchMetadataSchema = z
  .object({
    agent_id: z.literal("mock_interview"),
    user_name: z.string().min(1).max(60),
    interview: ResumeSessionRequestSchema.shape.interview,
    resume: z
      .object({
        pdf_key: z.string().min(1),
        document_key: z.string().min(1),
        pdf_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict();

class ResumeSessionInputError extends Error {}

export async function POST(request: Request) {
  let parsedInput: Awaited<ReturnType<typeof parseMultipartRequest>>;
  try {
    parsedInput = await parseMultipartRequest(request);
  } catch (error) {
    if (
      error instanceof ResumeSessionInputError ||
      error instanceof ResumeDocumentError ||
      error instanceof z.ZodError
    ) {
      return Response.json(
        {
          error: error instanceof z.ZodError
            ? z.prettifyError(error)
            : error.message,
          code: "invalid_resume_session_request",
        },
        { status: 400 },
      );
    }
    console.error(
      `[API:resume-session] event=failure operation=parse error_type=${getErrorType(error)}`,
    );
    return Response.json(
      {
        error: "Could not validate Resume session request",
        code: "resume_session_failed",
      },
      { status: 500 },
    );
  }

  const createdAt = new Date();
  const roomName = randomUUID();
  const participantIdentity = `candidate_${randomUUID()}`;
  let storage: ReturnType<typeof createResumeStorage> | undefined;
  let artifactsUploaded = false;
  let dispatchStarted = false;

  try {
    const { url, agentName } = getLiveKitCredentials();
    storage = createResumeStorage(roomName, createdAt);
    const documentBytes = new TextEncoder().encode(
      JSON.stringify(parsedInput.document),
    );
    const artifacts = {
      pdf: parsedInput.pdfBytes,
      document: documentBytes,
      pdfSha256: parsedInput.pdfSha256,
    };

    await uploadResumeArtifacts(storage, artifacts);
    artifactsUploaded = true;

    const roomMetadata = RoomMetadataSchema.parse({
      session: {
        id: roomName,
        artifact_prefix: storage.prefix,
        created_at: createdAt.toISOString(),
      },
      interview: {
        type: parsedInput.request.interview.type,
        version: parsedInput.request.interview.version,
        round: parsedInput.request.interview.round,
      },
      ui: { resume_available: true },
    });
    const dispatchMetadata = DispatchMetadataSchema.parse({
      agent_id: "mock_interview",
      user_name: parsedInput.request.name,
      interview: parsedInput.request.interview,
      resume: {
        pdf_key: storage.pdfKey,
        document_key: storage.documentKey,
        pdf_sha256: parsedInput.pdfSha256,
      },
    });

    const roomClient = createRoomServiceClient();
    await logLiveKitCall("create_room", roomName, () =>
      roomClient.createRoom({
        name: roomName,
        metadata: JSON.stringify(roomMetadata),
        emptyTimeout: 900,
        maxParticipants: 5,
      }),
    );

    const participantToken = await createParticipantToken({
      identity: participantIdentity,
      name: parsedInput.request.name,
      roomName,
    });

    const response = ResumeConnectionDetailsSchema.parse({
      serverUrl: url,
      roomName,
      participantName: parsedInput.request.name,
      participantToken,
      interview: parsedInput.request.interview,
      resume: {
        pdfUrl: storage.pdfUrl,
        documentUrl: storage.documentUrl,
        pdfSha256: parsedInput.pdfSha256,
      },
    });

    const dispatchClient = createAgentDispatchClient();
    dispatchStarted = true;
    await logLiveKitCall("create_dispatch", roomName, () =>
      dispatchClient.createDispatch(roomName, agentName, {
        metadata: JSON.stringify(dispatchMetadata),
      }),
    );
    return Response.json(response);
  } catch (error) {
    if (storage && artifactsUploaded && !dispatchStarted) {
      await deleteResumeArtifacts(storage, {
        pdf: parsedInput.pdfBytes,
        document: new TextEncoder().encode(JSON.stringify(parsedInput.document)),
      });
    }
    console.error(
      `[API:resume-session] event=failure room_id=${roomName} error_type=${getErrorType(error)}`,
    );
    return Response.json(
      {
        error: "Could not create Resume interview session",
        code: "resume_session_failed",
      },
      { status: 500 },
    );
  }
}

async function parseMultipartRequest(request: Request) {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    throw new ResumeSessionInputError("Expected multipart form data");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new ResumeSessionInputError("Invalid multipart form data");
  }
  const actualFields = Array.from(formData.keys());
  if (
    actualFields.some(
      (field) => !(MULTIPART_FIELDS as readonly string[]).includes(field),
    ) ||
    MULTIPART_FIELDS.some((field) => formData.getAll(field).length !== 1)
  ) {
    throw new ResumeSessionInputError(
      "Multipart form must contain request, document, and file exactly once",
    );
  }

  const requestField = formData.get("request");
  const documentField = formData.get("document");
  const file = formData.get("file");
  if (
    typeof requestField !== "string" ||
    typeof documentField !== "string" ||
    !(file instanceof File)
  ) {
    throw new ResumeSessionInputError("Invalid multipart field types");
  }
  if (
    new TextEncoder().encode(documentField).byteLength >
    RESUME_DOCUMENT_LIMITS.maxDocumentJsonBytes
  ) {
    throw new ResumeSessionInputError("Resume document is larger than 1 MB");
  }
  if (file.type !== "application/pdf") {
    throw new ResumeSessionInputError("Resume file must be application/pdf");
  }
  if (file.size <= 0 || file.size > RESUME_DOCUMENT_LIMITS.maxPdfBytes) {
    throw new ResumeSessionInputError("Resume PDF must be between 1 byte and 10 MB");
  }

  let requestValue: unknown;
  let documentValue: unknown;
  try {
    requestValue = JSON.parse(requestField);
    documentValue = JSON.parse(documentField);
  } catch {
    throw new ResumeSessionInputError("request and document must be valid JSON");
  }
  const parsedRequest = ResumeSessionRequestSchema.parse(requestValue);
  const document = await validateResumeDocument(documentValue);
  const pdfBytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfMagic(pdfBytes)) {
    throw new ResumeSessionInputError("Resume file does not have a PDF header");
  }
  const pdfSha256 = await sha256Hex(pdfBytes);
  if (document.pdf_sha256 !== pdfSha256) {
    throw new ResumeSessionInputError(
      "Resume document hash does not match the uploaded PDF",
    );
  }
  return { request: parsedRequest, document, pdfBytes, pdfSha256 };
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

async function logLiveKitCall<T>(
  operation: "create_room" | "create_dispatch",
  roomName: string,
  call: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  console.info(
    `${LIVEKIT_LOG_PREFIX} event=start operation=${operation} room_id=${roomName}`,
  );
  try {
    const result = await call();
    console.info(
      `${LIVEKIT_LOG_PREFIX} event=end operation=${operation} room_id=${roomName} elapsed_ms=${Date.now() - startedAt}`,
    );
    return result;
  } catch (error) {
    console.error(
      `${LIVEKIT_LOG_PREFIX} event=failure operation=${operation} room_id=${roomName} elapsed_ms=${Date.now() - startedAt} error_type=${getErrorType(error)}`,
    );
    throw error;
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
