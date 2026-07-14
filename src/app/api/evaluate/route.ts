import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { NoObjectGeneratedError, Output, generateText, type ModelMessage } from "ai";
import { z } from "zod";

export const dynamic = "force-dynamic";

const evaluationSchema = z.object({
  score: z.number().min(0).max(10).describe("Overall score out of 10"),
  verdict: z.enum(["strong", "acceptable", "needs_improvement"]),
  feedback: z.string().describe("Two to four sentences of overall feedback"),
  improvements: z
    .array(z.string())
    .describe("Concrete improvement suggestions, at most three"),
});

const SYSTEM_PROMPT =
  "You are a senior software engineer evaluating a candidate's answer in a mock technical interview. " +
  "Judge correctness, approach, and clarity for the candidate's apparent level. " +
  "Be honest but constructive. Score 0-10 where 7+ means a solid pass.";

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENROUTER_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let body: {
    surface?: string;
    question?: string;
    language?: string;
    code?: string;
    imageDataUrl?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

  let messages: ModelMessage[];
  if (body.surface === "whiteboard") {
    if (!body.imageDataUrl?.startsWith("data:image/")) {
      return Response.json(
        { error: "imageDataUrl is required for whiteboard evaluation" },
        { status: 400 },
      );
    }
    messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Interview question:\n${question}\n\n` +
              "The candidate answered by drawing on a whiteboard. " +
              "Evaluate the attached whiteboard image as their answer.",
          },
          { type: "file", mediaType: "image/png", data: body.imageDataUrl },
        ],
      },
    ];
  } else {
    const code = body.code?.trim();
    if (!code) {
      return Response.json({ error: "code is required" }, { status: 400 });
    }
    messages = [
      {
        role: "user",
        content:
          `Interview question:\n${question}\n\n` +
          `Candidate's answer (${body.language ?? "unknown language"}):\n\n${code}`,
      },
    ];
  }

  try {
    const openrouter = createOpenRouter({ apiKey });
    const model = openrouter(
      process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash",
    );
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      messages,
      output: Output.object({ schema: evaluationSchema }),
    });
    return Response.json(result.output);
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      console.error("Evaluation output failed validation:", error.text);
    } else {
      console.error("Evaluation failed:", error);
    }
    return Response.json({ error: "Evaluation failed" }, { status: 502 });
  }
}
