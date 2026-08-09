import { createHmac, createHash } from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { NoObjectGeneratedError, Output, generateText, type ModelMessage } from "ai";
import { z } from "zod";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const LOG_PREFIX = "[LLM:whiteboard-evaluation]";

const shortItem = z.string().trim().min(1).max(120);
const evaluationSchema = z.object({
  drawingSummary: z.object({
    components: z.array(shortItem).max(8),
    connections: z.array(shortItem).max(8),
    flow: z.array(shortItem).max(8),
    unclearAreas: z.array(shortItem).max(8),
  }),
  visualEvaluation: z.object({
    result: z.enum(["correct", "partial", "incorrect", "unclear"]),
    strengths: z.array(z.string().trim().min(1).max(240)).max(3),
    gaps: z.array(z.string().trim().min(1).max(240)).max(3),
    evidence: z.string().trim().min(1).max(500),
    confidence: z.number().min(0).max(1),
  }),
});

const SYSTEM_PROMPT =
  "You evaluate a system-design whiteboard image for a mock interview. " +
  "First report only visible components, labels, connections, direction and unclear areas. " +
  "Then assess how well the visible design addresses the question. Do not invent unlabeled " +
  "services, requirements, tradeoffs, scale assumptions or candidate reasoning. Keep every field concise.";

function requiredString(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const signingSecret = process.env.WHITEBOARD_EVALUATION_SIGNING_SECRET;
  if (!apiKey || !signingSecret) {
    return Response.json({ error: "Whiteboard evaluation is not configured" }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart body" }, { status: 400 });
  }
  const image = formData.get("image");
  const question = requiredString(formData, "question");
  const roomName = requiredString(formData, "roomName");
  const participantIdentity = requiredString(formData, "participantIdentity");
  const questionId = requiredString(formData, "questionId");
  const revisionRaw = requiredString(formData, "revision");
  const expectedHash = requiredString(formData, "imageSha256");
  const revision = revisionRaw === null ? Number.NaN : Number(revisionRaw);
  if (
    !(image instanceof File) ||
    image.type !== "image/png" ||
    image.size <= 0 ||
    image.size > MAX_IMAGE_BYTES ||
    !question ||
    !roomName ||
    !participantIdentity ||
    !questionId ||
    !Number.isInteger(revision) ||
    revision < 0 ||
    !expectedHash?.match(/^[a-f0-9]{64}$/)
  ) {
    return Response.json({ error: "Invalid whiteboard evaluation request" }, { status: 400 });
  }

  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!pngSignature.every((byte, index) => imageBytes[index] === byte)) {
    return Response.json({ error: "Invalid PNG image" }, { status: 400 });
  }
  const actualHash = createHash("sha256").update(imageBytes).digest("hex");
  if (actualHash !== expectedHash) {
    return Response.json({ error: "Whiteboard image hash mismatch" }, { status: 400 });
  }

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: `Interview question:\n${question}` },
        { type: "file", mediaType: "image/png", data: imageBytes },
      ],
    },
  ];
  const modelName = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o";
  const startedAt = Date.now();
  try {
    const openrouter = createOpenRouter({ apiKey });
    const result = await generateText({
      model: openrouter(modelName),
      system: SYSTEM_PROMPT,
      messages,
      output: Output.object({ schema: evaluationSchema }),
    });
    const payload = JSON.stringify({
      version: 1,
      roomName,
      participantIdentity,
      questionId,
      revision,
      imageSha256: actualHash,
      evaluatedAt: Date.now(),
      ...result.output,
    });
    const signature = createHmac("sha256", signingSecret).update(payload).digest("hex");
    console.info(
      `${LOG_PREFIX} completed model=${modelName} question_id=${questionId} elapsed_ms=${Date.now() - startedAt}`,
    );
    return Response.json({ payload, signature });
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      console.error(
        `${LOG_PREFIX} invalid_output model=${modelName} question_id=${questionId} elapsed_ms=${Date.now() - startedAt}`,
      );
    } else {
      console.error(
        `${LOG_PREFIX} failed model=${modelName} question_id=${questionId} elapsed_ms=${Date.now() - startedAt}`,
        error,
      );
    }
    return Response.json({ error: "Whiteboard evaluation failed" }, { status: 502 });
  }
}
