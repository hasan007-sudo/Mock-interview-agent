import { URL } from "node:url";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const LOG_PREFIX = "[EXT-API:s3-resume]";
const DEFAULT_BASE_PREFIX = "agents";
const MODE_AGENT_SEGMENT = "mock-interview-agent";
const PDF_CONTENT_TYPE = "application/pdf";
const DOCUMENT_CONTENT_TYPE = "application/json; charset=utf-8";
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export type ResumeStorage = {
  roomName: string;
  prefix: string;
  pdfKey: string;
  documentKey: string;
  pdfUrl: string;
  documentUrl: string;
  bucket: string;
  client: S3Client;
};

type ResumeArtifactBytes = {
  pdf: Uint8Array;
  document: Uint8Array;
  pdfSha256: string;
};

export function createResumeStorage(
  roomName: string,
  createdAt: Date,
): ResumeStorage {
  requireSafeSegment(roomName, "room name");
  requireSafeSegment(MODE_AGENT_SEGMENT, "mode agent segment");

  const bucket = requiredEnv("AWS_S3_BUCKET");
  if (!BUCKET_PATTERN.test(bucket)) {
    throw new Error("AWS_S3_BUCKET must be a valid DNS-style bucket name");
  }

  const region = process.env.AWS_REGION?.trim() || "us-east-1";
  const endpoint = readEndpoint();
  const forcePathStyle = readForcePathStyle();
  const basePrefix = normalizeBasePrefix(
    process.env.S3_BASE_PREFIX ?? DEFAULT_BASE_PREFIX,
  );
  const datePath = [
    createdAt.getUTCFullYear(),
    String(createdAt.getUTCMonth() + 1).padStart(2, "0"),
    String(createdAt.getUTCDate()).padStart(2, "0"),
  ].join("/");
  const prefix = `${basePrefix}/${MODE_AGENT_SEGMENT}/sessions/${datePath}/${roomName}`;
  const pdfKey = `${prefix}/resume/original.pdf`;
  const documentKey = `${prefix}/resume/document.v1.json`;

  return {
    roomName,
    prefix,
    pdfKey,
    documentKey,
    pdfUrl: buildPublicObjectUrl({
      bucket,
      key: pdfKey,
      region,
      endpoint,
      forcePathStyle,
    }),
    documentUrl: buildPublicObjectUrl({
      bucket,
      key: documentKey,
      region,
      endpoint,
      forcePathStyle,
    }),
    bucket,
    client: createS3Client({ endpoint, forcePathStyle, region }),
  };
}

export async function uploadResumeArtifacts(
  storage: ResumeStorage,
  artifacts: ResumeArtifactBytes,
): Promise<void> {
  const startedAt = Date.now();
  logEvent("start", "upload", storage, artifacts);

  try {
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: storage.pdfKey,
        Body: artifacts.pdf,
        ContentType: PDF_CONTENT_TYPE,
        ContentDisposition: "inline",
        Metadata: { sha256: artifacts.pdfSha256 },
      }),
    );
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: storage.documentKey,
        Body: artifacts.document,
        ContentType: DOCUMENT_CONTENT_TYPE,
      }),
    );
    logEvent("end", "upload", storage, artifacts, startedAt);
  } catch (error) {
    logEvent("failure", "upload", storage, artifacts, startedAt, error);
    await deleteResumeArtifacts(storage, artifacts);
    throw error;
  }
}

export async function deleteResumeArtifacts(
  storage: ResumeStorage,
  artifacts: Pick<ResumeArtifactBytes, "pdf" | "document">,
): Promise<void> {
  const startedAt = Date.now();
  logEvent("start", "delete", storage, artifacts);
  const results = await Promise.allSettled([
    storage.client.send(
      new DeleteObjectCommand({ Bucket: storage.bucket, Key: storage.pdfKey }),
    ),
    storage.client.send(
      new DeleteObjectCommand({
        Bucket: storage.bucket,
        Key: storage.documentKey,
      }),
    ),
  ]);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) {
    logEvent(
      "failure",
      "delete",
      storage,
      artifacts,
      startedAt,
      failure.reason,
    );
    return;
  }
  logEvent("end", "delete", storage, artifacts, startedAt);
}

function createS3Client(input: {
  region: string;
  endpoint?: URL;
  forcePathStyle: boolean;
}): S3Client {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error(
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together",
    );
  }
  return new S3Client({
    region: input.region,
    ...(input.endpoint ? { endpoint: input.endpoint.toString() } : {}),
    forcePathStyle: input.forcePathStyle,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
}

function buildPublicObjectUrl(input: {
  bucket: string;
  key: string;
  region: string;
  endpoint?: URL;
  forcePathStyle: boolean;
}): string {
  const encodedKey = input.key.split("/").map(encodeURIComponent).join("/");
  if (input.endpoint) {
    const url = new URL(input.endpoint);
    const endpointPath = url.pathname.replace(/\/+$/u, "");
    if (input.forcePathStyle) {
      url.pathname = `${endpointPath}/${encodeURIComponent(input.bucket)}/${encodedKey}`;
    } else {
      url.hostname = `${input.bucket}.${url.hostname}`;
      url.pathname = `${endpointPath}/${encodedKey}`;
    }
    return url.toString();
  }

  const host = input.region === "us-east-1"
    ? `${input.bucket}.s3.amazonaws.com`
    : `${input.bucket}.s3.${input.region}.amazonaws.com`;
  return `https://${host}/${encodedKey}`;
}

function normalizeBasePrefix(raw: string): string {
  const normalized = raw.trim().replace(/^\/+|\/+$/gu, "");
  if (!normalized) throw new Error("S3_BASE_PREFIX must not be empty");
  normalized.split("/").forEach((segment) =>
    requireSafeSegment(segment, "S3 base prefix segment"),
  );
  return normalized;
}

function readEndpoint(): URL | undefined {
  const raw = process.env.AWS_S3_ENDPOINT?.trim();
  if (!raw) return undefined;
  const endpoint = new URL(raw);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("AWS_S3_ENDPOINT must be a plain HTTP(S) endpoint URL");
  }
  return endpoint;
}

function readForcePathStyle(): boolean {
  return ["1", "true", "yes"].includes(
    process.env.AWS_S3_FORCE_PATH_STYLE?.toLowerCase() ?? "",
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Resume storage`);
  return value;
}

function requireSafeSegment(value: string, label: string): void {
  if (
    !SAFE_SEGMENT_PATTERN.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function logEvent(
  event: "start" | "end" | "failure",
  operation: "upload" | "delete",
  storage: ResumeStorage,
  artifacts: Pick<ResumeArtifactBytes, "pdf" | "document">,
  startedAt?: number,
  error?: unknown,
): void {
  const elapsed = startedAt === undefined
    ? ""
    : ` elapsed_ms=${Date.now() - startedAt}`;
  const errorType = error === undefined
    ? ""
    : ` error_type=${getErrorType(error)}`;
  const message = `${LOG_PREFIX} event=${event} operation=${operation} room_id=${storage.roomName} pdf_bytes=${artifacts.pdf.byteLength} document_bytes=${artifacts.document.byteLength}${elapsed}${errorType}`;
  if (event === "failure") {
    console.error(message);
  } else {
    console.info(message);
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
