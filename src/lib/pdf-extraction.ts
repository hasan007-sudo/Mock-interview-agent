import {
  RESUME_DOCUMENT_LIMITS,
  RESUME_DOCUMENT_SCHEMA_VERSION,
  type ResumeDocument,
  isContactLikeText,
  isContactSection,
  isControlLikeText,
  validateResumeDocument,
} from "@/lib/resume-document";
import {
  type PdfAnchor,
  type PdfRectangle,
  sha256Hex,
  unicodeCharacterCount,
} from "@/lib/source-documents";

export const PDFJS_WORKER_SRC = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PositionedText = {
  sourceIndex: number;
  text: string;
  direction: string;
  hasEol: boolean;
  baseline: number;
  rectangle: PdfRectangle;
};

type TextRow = {
  baseline: number;
  maxHeight: number;
  items: PositionedText[];
};

type PdfViewport = {
  transform: number[];
  width: number;
  height: number;
  scale: number;
};

export class ResumePdfExtractionError extends Error {}

export async function extractResumeDocument(
  file: File,
): Promise<ResumeDocument> {
  if (file.type !== "application/pdf") {
    throw new ResumePdfExtractionError("Resume must use the application/pdf MIME type");
  }
  if (file.size <= 0 || file.size > RESUME_DOCUMENT_LIMITS.maxPdfBytes) {
    throw new ResumePdfExtractionError("Resume PDF must be between 1 byte and 10 MB");
  }

  const pdfBytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfMagic(pdfBytes)) {
    throw new ResumePdfExtractionError("Resume file does not have a valid PDF header");
  }
  const pdfSha256 = await sha256Hex(pdfBytes);
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  const loadingTask = pdfjs.getDocument({ data: pdfBytes });

  try {
    const pdf = await loadingTask.promise;
    try {
      if (pdf.numPages > RESUME_DOCUMENT_LIMITS.maxPdfPages) {
        throw new ResumePdfExtractionError("Resume PDF contains more than 10 pages");
      }

      const anchors: PdfAnchor[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const positioned: PositionedText[] = [];

        content.items.forEach((item, sourceIndex) => {
          if (!("str" in item) || !item.str.trim()) return;
          const style = content.styles[item.fontName];
          const rectangle = rectangleForItem(
            pdfjs.Util,
            viewport,
            item,
            style,
            pageNumber,
          );
          if (!rectangle) return;
          const transformed = pdfjs.Util.transform(viewport.transform, item.transform);
          positioned.push({
            sourceIndex,
            text: item.str,
            direction: item.dir,
            hasEol: item.hasEOL,
            baseline: clamp(transformed[5] / viewport.height),
            rectangle,
          });
        });

        const groups = groupIntoAnchors(positioned);
        let pageAnchorIndex = 0;
        for (const group of groups) {
          const text = joinPositionedText(group);
          if (!text.trim()) continue;
          if (
            isContactSection(text) ||
            isContactLikeText(text) ||
            isControlLikeText(text)
          ) {
            continue;
          }
          pageAnchorIndex += 1;
          anchors.push({
            id: `p${String(pageNumber).padStart(3, "0")}-a${String(pageAnchorIndex).padStart(4, "0")}`,
            page: pageNumber,
            text,
            text_sha256: await sha256Hex(text),
            rectangles: group.map((item) => item.rectangle),
          });
          assertAnchorLimits(anchors);
        }
      }

      if (anchors.length === 0) {
        throw new ResumePdfExtractionError(
          "No eligible readable text was found in the PDF. Image-only PDFs require OCR, which is not supported.",
        );
      }
      const extractedCharacterCount = anchors.reduce(
        (total, anchor) => total + unicodeCharacterCount(anchor.text),
        0,
      );
      if (extractedCharacterCount > RESUME_DOCUMENT_LIMITS.maxExtractedCharacters) {
        throw new ResumePdfExtractionError("Resume contains more than 50,000 extracted characters");
      }

      return validateResumeDocument({
        schema_version: RESUME_DOCUMENT_SCHEMA_VERSION,
        pdf_sha256: pdfSha256,
        page_count: pdf.numPages,
        extracted_character_count: extractedCharacterCount,
        anchor_count: anchors.length,
        claim_count: 0,
        anchors,
        claims: [],
      });
    } finally {
      await pdf.destroy();
    }
  } catch (error) {
    if (error instanceof ResumePdfExtractionError) throw error;
    throw new ResumePdfExtractionError("Could not extract readable text from the PDF");
  } finally {
    await loadingTask.destroy();
  }
}

function rectangleForItem(
  util: typeof import("pdfjs-dist").Util,
  viewport: PdfViewport,
  item: {
    transform: number[];
    width: number;
  },
  style: { ascent?: number; descent?: number } | undefined,
  page: number,
): PdfRectangle | null {
  const transform = util.transform(viewport.transform, item.transform);
  const fontHeight = Math.hypot(transform[2], transform[3]);
  const width = Math.abs(item.width * viewport.scale);
  if (!Number.isFinite(fontHeight) || !Number.isFinite(width) || fontHeight <= 0 || width <= 0) {
    return null;
  }

  const angle = Math.atan2(transform[1], transform[0]);
  const alongX = Math.cos(angle);
  const alongY = Math.sin(angle);
  const upX = Math.sin(angle);
  const upY = -Math.cos(angle);
  const ascentRatio = style?.ascent ?? (style?.descent ? 1 + style.descent : 0.8);
  const descentRatio = style?.descent ? Math.abs(style.descent) : Math.max(0.2, 1 - ascentRatio);
  const ascent = fontHeight * ascentRatio;
  const descent = fontHeight * descentRatio;
  const baselineX = transform[4];
  const baselineY = transform[5];
  const endX = baselineX + alongX * width;
  const endY = baselineY + alongY * width;
  const points = [
    [baselineX + upX * ascent, baselineY + upY * ascent],
    [endX + upX * ascent, endY + upY * ascent],
    [endX - upX * descent, endY - upY * descent],
    [baselineX - upX * descent, baselineY - upY * descent],
  ];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x1 = clamp(Math.min(...xs) / viewport.width);
  const y1 = clamp(Math.min(...ys) / viewport.height);
  const x2 = clamp(Math.max(...xs) / viewport.width);
  const y2 = clamp(Math.max(...ys) / viewport.height);
  if (x2 - x1 <= Number.EPSILON || y2 - y1 <= Number.EPSILON) return null;
  return { page, x1, y1, x2, y2 };
}

function groupIntoAnchors(items: PositionedText[]): PositionedText[][] {
  const rows = buildRows(items);
  const groups: PositionedText[][] = [];
  for (const row of rows) {
    const rtl = row.items.every((item) => item.direction === "rtl");
    row.items.sort((left, right) => {
      const visual = rtl
        ? right.rectangle.x2 - left.rectangle.x2
        : left.rectangle.x1 - right.rectangle.x1;
      return visual || left.sourceIndex - right.sourceIndex;
    });
    for (const item of row.items) {
      const group = groups.at(-1);
      const previous = group?.at(-1);
      if (
        group &&
        previous &&
        group.length < RESUME_DOCUMENT_LIMITS.maxRectanglesPerAnchor &&
        canJoin(previous, item)
      ) {
        group.push(item);
      } else {
        groups.push([item]);
      }
    }
  }
  return groups;
}

function buildRows(items: PositionedText[]): TextRow[] {
  const rows: TextRow[] = [];
  const ordered = [...items].sort(
    (left, right) =>
      left.baseline - right.baseline ||
      left.rectangle.x1 - right.rectangle.x1 ||
      left.sourceIndex - right.sourceIndex,
  );
  for (const item of ordered) {
    const height = item.rectangle.y2 - item.rectangle.y1;
    const row = rows.at(-1);
    if (
      row &&
      Math.abs(item.baseline - row.baseline) <= Math.max(height, row.maxHeight) * 0.5
    ) {
      const itemCount = row.items.length;
      row.baseline = (row.baseline * itemCount + item.baseline) / (itemCount + 1);
      row.maxHeight = Math.max(row.maxHeight, height);
      row.items.push(item);
    } else {
      rows.push({ baseline: item.baseline, maxHeight: height, items: [item] });
    }
  }
  return rows;
}

function canJoin(previous: PositionedText, next: PositionedText): boolean {
  if (previous.hasEol || previous.direction !== next.direction) return false;
  const height = Math.max(
    previous.rectangle.y2 - previous.rectangle.y1,
    next.rectangle.y2 - next.rectangle.y1,
  );
  const gap =
    previous.direction === "rtl"
      ? previous.rectangle.x1 - next.rectangle.x2
      : next.rectangle.x1 - previous.rectangle.x2;
  return gap >= -height * 0.25 && gap <= Math.max(0.025, height * 2.5);
}

function joinPositionedText(items: PositionedText[]): string {
  return items.reduce((text, item, index) => {
    if (index === 0) return item.text;
    const previous = items[index - 1];
    const height = Math.max(
      previous.rectangle.y2 - previous.rectangle.y1,
      item.rectangle.y2 - item.rectangle.y1,
    );
    const gap =
      previous.direction === "rtl"
        ? previous.rectangle.x1 - item.rectangle.x2
        : item.rectangle.x1 - previous.rectangle.x2;
    const hasWhitespaceBoundary = /\s$/u.test(text) || /^\s/u.test(item.text);
    const separator = !hasWhitespaceBoundary && gap > Math.max(0.001, height * 0.2) ? " " : "";
    return `${text}${separator}${item.text}`;
  }, "");
}

function assertAnchorLimits(anchors: PdfAnchor[]): void {
  if (anchors.length > RESUME_DOCUMENT_LIMITS.maxAnchors) {
    throw new ResumePdfExtractionError("Resume contains more than 2,000 text anchors");
  }
  const extractedCharacters = anchors.reduce(
    (total, anchor) => total + unicodeCharacterCount(anchor.text),
    0,
  );
  if (extractedCharacters > RESUME_DOCUMENT_LIMITS.maxExtractedCharacters) {
    throw new ResumePdfExtractionError("Resume contains more than 50,000 extracted characters");
  }
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
