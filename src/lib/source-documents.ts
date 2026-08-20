import { z } from "zod";

export const SOURCE_DOCUMENT_LIMITS = {
  maxPdfBytes: 10 * 1024 * 1024,
  maxPdfPages: 10,
  maxExtractedCharacters: 50_000,
  maxAnchors: 2_000,
  maxRectanglesPerAnchor: 8,
  maxDocumentJsonBytes: 1024 * 1024,
} as const;

export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const PdfRectangleSchema = z
  .object({
    page: z.number().int().positive().max(SOURCE_DOCUMENT_LIMITS.maxPdfPages),
    x1: z.number().finite().min(0).max(1),
    y1: z.number().finite().min(0).max(1),
    x2: z.number().finite().min(0).max(1),
    y2: z.number().finite().min(0).max(1),
  })
  .strict()
  .superRefine((rectangle, context) => {
    if (rectangle.x1 >= rectangle.x2) {
      context.addIssue({
        code: "custom",
        message: "x1 must be less than x2",
        path: ["x2"],
      });
    }
    if (rectangle.y1 >= rectangle.y2) {
      context.addIssue({
        code: "custom",
        message: "y1 must be less than y2",
        path: ["y2"],
      });
    }
  });

export const PdfAnchorSchema = z
  .object({
    id: z.string().regex(SOURCE_ID_PATTERN),
    page: z.number().int().positive().max(SOURCE_DOCUMENT_LIMITS.maxPdfPages),
    text: z.string().min(1).max(SOURCE_DOCUMENT_LIMITS.maxExtractedCharacters),
    text_sha256: z.string().regex(SHA256_HEX_PATTERN),
    rectangles: z
      .array(PdfRectangleSchema)
      .min(1)
      .max(SOURCE_DOCUMENT_LIMITS.maxRectanglesPerAnchor),
  })
  .strict()
  .superRefine((anchor, context) => {
    anchor.rectangles.forEach((rectangle, index) => {
      if (rectangle.page !== anchor.page) {
        context.addIssue({
          code: "custom",
          message: "rectangle page must match anchor page",
          path: ["rectangles", index, "page"],
        });
      }
    });
  });

const SourceDocumentBaseSchema = z
  .object({
    pdf_sha256: z.string().regex(SHA256_HEX_PATTERN),
    page_count: z.number().int().positive().max(SOURCE_DOCUMENT_LIMITS.maxPdfPages),
    extracted_character_count: z
      .number()
      .int()
      .positive()
      .max(SOURCE_DOCUMENT_LIMITS.maxExtractedCharacters),
    anchor_count: z
      .number()
      .int()
      .positive()
      .max(SOURCE_DOCUMENT_LIMITS.maxAnchors),
    anchors: z
      .array(PdfAnchorSchema)
      .min(1)
      .max(SOURCE_DOCUMENT_LIMITS.maxAnchors),
  })
  .strict();

export const SourceDocumentSchema = SourceDocumentBaseSchema.superRefine(
  validateSourceRelationships,
);

export type PdfRectangle = z.infer<typeof PdfRectangleSchema>;
export type PdfAnchor = z.infer<typeof PdfAnchorSchema>;
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

export class SourceDocumentError extends Error {}

export async function validateSourceDocument(
  value: unknown,
): Promise<SourceDocument> {
  const parsed = SourceDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new SourceDocumentError(z.prettifyError(parsed.error));
  }
  if (
    utf8ByteLength(JSON.stringify(parsed.data)) >
    SOURCE_DOCUMENT_LIMITS.maxDocumentJsonBytes
  ) {
    throw new SourceDocumentError("Source document is larger than 1 MB");
  }
  const hashes = await Promise.all(
    parsed.data.anchors.map((anchor) => sha256Hex(anchor.text)),
  );
  const invalidHash = parsed.data.anchors.findIndex(
    (anchor, index) => anchor.text_sha256 !== hashes[index],
  );
  if (invalidHash !== -1) {
    throw new SourceDocumentError(
      `anchors[${invalidHash}].text_sha256 does not match its exact text`,
    );
  }
  return parsed.data;
}

export function normalizeSourceText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function unicodeCharacterCount(value: string): number {
  return Array.from(value).length;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function sha256Hex(
  value: string | Uint8Array,
): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function validateSourceRelationships(
  document: z.infer<typeof SourceDocumentBaseSchema>,
  context: z.RefinementCtx,
): void {
  if (document.anchor_count !== document.anchors.length) {
    context.addIssue({
      code: "custom",
      message: "anchor_count does not match anchors",
      path: ["anchor_count"],
    });
  }
  const characterCount = document.anchors.reduce(
    (total, anchor) => total + unicodeCharacterCount(anchor.text),
    0,
  );
  if (document.extracted_character_count !== characterCount) {
    context.addIssue({
      code: "custom",
      message: "extracted_character_count does not match anchor text",
      path: ["extracted_character_count"],
    });
  }
  const ids = new Set<string>();
  document.anchors.forEach((anchor, index) => {
    if (ids.has(anchor.id)) {
      context.addIssue({
        code: "custom",
        message: "anchor id is duplicated",
        path: ["anchors", index, "id"],
      });
    }
    ids.add(anchor.id);
    if (anchor.page > document.page_count) {
      context.addIssue({
        code: "custom",
        message: "anchor page exceeds page_count",
        path: ["anchors", index, "page"],
      });
    }
  });
}
