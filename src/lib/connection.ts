import { z } from "zod";
import { ResumeInterviewRequestSchema } from "@/lib/interviews";
import { SHA256_HEX_PATTERN } from "@/lib/source-documents";

export const CONNECTION_STORAGE_KEY = "mock-interview-connection";

export const BaseConnectionDetailsSchema = z
  .object({
    serverUrl: z.url(),
    roomName: z.string().min(1),
    participantName: z.string().min(1),
    participantToken: z.string().min(1),
  })
  .strict();

export const ResumeSessionRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    interview: ResumeInterviewRequestSchema,
  })
  .strict();

export const ResumeConnectionDetailsSchema = BaseConnectionDetailsSchema.extend({
  interview: ResumeInterviewRequestSchema,
  resume: z
    .object({
      pdfUrl: z.url(),
      documentUrl: z.url(),
      pdfSha256: z.string().regex(SHA256_HEX_PATTERN),
    })
    .strict(),
}).strict();

export const ConnectionDetailsSchema = z.union([
  ResumeConnectionDetailsSchema,
  BaseConnectionDetailsSchema,
]);

export type BaseConnectionDetails = z.infer<
  typeof BaseConnectionDetailsSchema
>;
export type ResumeSessionRequest = z.infer<
  typeof ResumeSessionRequestSchema
>;
export type ResumeConnectionDetails = z.infer<
  typeof ResumeConnectionDetailsSchema
>;
export type ConnectionDetails = z.infer<typeof ConnectionDetailsSchema>;

export function isResumeConnectionDetails(
  connection: ConnectionDetails,
): connection is ResumeConnectionDetails {
  return (
    "interview" in connection &&
    connection.interview.type === "resume_mastery"
  );
}

export function parseConnectionDetails(
  raw: string | null,
): ConnectionDetails | null {
  if (!raw) return null;
  try {
    const parsed = ConnectionDetailsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // ignore malformed storage
  }
  return null;
}
