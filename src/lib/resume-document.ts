import { z } from "zod";
import {
  PdfAnchorSchema,
  type PdfAnchor,
  SHA256_HEX_PATTERN,
  SOURCE_DOCUMENT_LIMITS,
  normalizeSourceText,
  sha256Hex,
  unicodeCharacterCount,
  utf8ByteLength,
} from "@/lib/source-documents";

export {
  PdfAnchorSchema,
  type PdfAnchor,
  PdfRectangleSchema,
  type PdfRectangle,
} from "@/lib/source-documents";

export const RESUME_DOCUMENT_SCHEMA_VERSION = "resume_document.v1" as const;
export const RESUME_DOCUMENT_LIMITS = {
  ...SOURCE_DOCUMENT_LIMITS,
  maxClaims: 200,
  maxAnchorsPerClaim: 8,
} as const;

export const ResumeClaimKindSchema = z.enum([
  "project",
  "experience",
  "impact",
  "architecture",
  "technology",
  "education",
  "other",
]);

const CLAIM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const ResumeClaimSchema = z
  .object({
    id: z.string().regex(CLAIM_ID_PATTERN),
    section: z.string().min(1).max(120),
    kind: ResumeClaimKindSchema,
    text: z.string().min(1).max(RESUME_DOCUMENT_LIMITS.maxExtractedCharacters),
    anchor_ids: z
      .array(z.string().regex(CLAIM_ID_PATTERN))
      .min(1)
      .max(RESUME_DOCUMENT_LIMITS.maxAnchorsPerClaim),
    metric: z.string().min(1).max(500).optional(),
  })
  .strict();

const ResumeDocumentBaseSchema = z
  .object({
    schema_version: z.literal(RESUME_DOCUMENT_SCHEMA_VERSION),
    pdf_sha256: z.string().regex(SHA256_HEX_PATTERN),
    page_count: z.number().int().positive().max(RESUME_DOCUMENT_LIMITS.maxPdfPages),
    extracted_character_count: z
      .number()
      .int()
      .positive()
      .max(RESUME_DOCUMENT_LIMITS.maxExtractedCharacters),
    anchor_count: z
      .number()
      .int()
      .positive()
      .max(RESUME_DOCUMENT_LIMITS.maxAnchors),
    claim_count: z
      .number()
      .int()
      .nonnegative()
      .max(RESUME_DOCUMENT_LIMITS.maxClaims),
    anchors: z.array(PdfAnchorSchema).min(1).max(RESUME_DOCUMENT_LIMITS.maxAnchors),
    claims: z.array(ResumeClaimSchema).max(RESUME_DOCUMENT_LIMITS.maxClaims),
  })
  .strict();

export const ResumeDocumentSchema = ResumeDocumentBaseSchema.superRefine(
  validateDocumentRelationships,
);

export type ResumeClaimKind = z.infer<typeof ResumeClaimKindSchema>;
export type ResumeClaim = z.infer<typeof ResumeClaimSchema>;
export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>;

export class ResumeDocumentError extends Error {}

export async function validateResumeDocument(
  value: unknown,
): Promise<ResumeDocument> {
  const parsed = ResumeDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new ResumeDocumentError(z.prettifyError(parsed.error));
  }
  if (
    utf8ByteLength(JSON.stringify(parsed.data)) >
    RESUME_DOCUMENT_LIMITS.maxDocumentJsonBytes
  ) {
    throw new ResumeDocumentError("Resume document is larger than 1 MB");
  }
  const hashes = await Promise.all(
    parsed.data.anchors.map((anchor) => sha256Hex(anchor.text)),
  );
  const invalidHash = parsed.data.anchors.findIndex(
    (anchor, index) => anchor.text_sha256 !== hashes[index],
  );
  if (invalidHash !== -1) {
    throw new ResumeDocumentError(
      `anchors[${invalidHash}].text_sha256 does not match its exact text`,
    );
  }
  return parsed.data;
}

export function isContactLikeText(value: string): boolean {
  return CONTACT_PATTERNS.some((pattern) => pattern.test(value));
}

export function isControlLikeText(value: string): boolean {
  return CONTROL_PATTERNS.some((pattern) => pattern.test(value));
}

export function isContactSection(value: string): boolean {
  return /^(?:contact|contact information|personal details|personal information)$/iu.test(
    normalizeSourceText(value),
  );
}

function validateDocumentRelationships(
  document: z.infer<typeof ResumeDocumentBaseSchema>,
  context: z.RefinementCtx,
): void {
  if (document.anchor_count !== document.anchors.length) {
    addIssue(context, ["anchor_count"], "anchor_count does not match anchors");
  }
  if (document.claim_count !== document.claims.length) {
    addIssue(context, ["claim_count"], "claim_count does not match claims");
  }
  const extractedCount = document.anchors.reduce(
    (total, anchor) => total + unicodeCharacterCount(anchor.text),
    0,
  );
  if (document.extracted_character_count !== extractedCount) {
    addIssue(
      context,
      ["extracted_character_count"],
      "extracted_character_count does not match anchor text",
    );
  }

  const anchorsById = new Map<string, PdfAnchor>();
  const anchorPositions = new Map<string, number>();
  document.anchors.forEach((anchor, index) => {
    if (anchor.page > document.page_count) {
      addIssue(context, ["anchors", index, "page"], "anchor page exceeds page_count");
    }
    if (anchorsById.has(anchor.id)) {
      addIssue(context, ["anchors", index, "id"], "anchor id is duplicated");
    }
    anchorsById.set(anchor.id, anchor);
    anchorPositions.set(anchor.id, index);
    if (
      isContactSection(anchor.text) ||
      isContactLikeText(anchor.text) ||
      isControlLikeText(anchor.text)
    ) {
      addIssue(context, ["anchors", index, "text"], "anchor contains excluded content");
    }
  });

  const claimIds = new Set<string>();
  document.claims.forEach((claim, index) => {
    if (claimIds.has(claim.id)) {
      addIssue(context, ["claims", index, "id"], "claim id is duplicated");
    }
    claimIds.add(claim.id);
    if (new Set(claim.anchor_ids).size !== claim.anchor_ids.length) {
      addIssue(context, ["claims", index, "anchor_ids"], "anchor_ids contains duplicates");
      return;
    }
    const anchors = claim.anchor_ids.map((id) => anchorsById.get(id));
    if (anchors.some((anchor) => !anchor)) {
      addIssue(context, ["claims", index, "anchor_ids"], "claim references an unknown anchor");
      return;
    }
    const groundedAnchors = anchors as PdfAnchor[];
    if (new Set(groundedAnchors.map((anchor) => anchor.page)).size !== 1) {
      addIssue(context, ["claims", index, "anchor_ids"], "claim anchors must be on one page");
    }
    const positions = claim.anchor_ids.map((id) => anchorPositions.get(id) ?? -1);
    if (positions.some((position, offset) => offset > 0 && position <= positions[offset - 1])) {
      addIssue(context, ["claims", index, "anchor_ids"], "anchor_ids must preserve source order");
    }
    const groundedText = normalizeSourceText(
      groundedAnchors.map((anchor) => anchor.text).join(" "),
    );
    if (claim.text !== groundedText) {
      addIssue(context, ["claims", index, "text"], "claim text is not exact normalized source text");
    }
    if (claim.metric && !claim.text.includes(claim.metric)) {
      addIssue(context, ["claims", index, "metric"], "metric must be an exact claim text substring");
    }
    if (
      isContactSection(claim.section) ||
      isContactLikeText(claim.text) ||
      isControlLikeText(claim.text) ||
      isControlLikeText(claim.section)
    ) {
      addIssue(context, ["claims", index], "claim contains excluded content");
    }
  });
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", message, path });
}

const CONTACT_PATTERNS = [
  /(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?![\w.-])/u,
  /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/u,
  /(?:https?:\/\/|www\.|linkedin\.com\/|github\.com\/)\S+/iu,
  /\b\d{1,6}\s+[\w.'-]+(?:\s+[\w.'-]+){0,5}\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd)\b/iu,
];

const CONTROL_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b/iu,
  /\b(?:system|developer|assistant)\s+prompt\s*:/iu,
  /^\s*(?:system|developer|assistant)\s*:/iu,
  /\bfollow\s+(?:these|the following)\s+instructions\b/iu,
  /\byou are (?:chatgpt|an ai assistant|the interviewer)\b/iu,
];
