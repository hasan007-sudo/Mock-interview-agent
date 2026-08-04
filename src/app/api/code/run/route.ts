import { z } from "zod";
import {
  CodeExecutionProviderError,
  executeCode,
} from "@/lib/code-execution";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  language: z.enum(["html", "java", "javascript", "python", "react"]),
  code: z.string().refine((code) => code.trim().length > 0),
});

export async function POST(request: Request) {
  const apiKey = process.env.ONECOMPILER_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      { error: "ONECOMPILER_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "language and non-empty code are required" },
      { status: 400 },
    );
  }

  try {
    return Response.json(
      await executeCode({ ...parsed.data, apiKey, signal: request.signal }),
    );
  } catch (error) {
    if (error instanceof CodeExecutionProviderError) {
      if (error.kind === "quota") {
        return Response.json(
          { error: "Code execution quota exceeded" },
          { status: 429 },
        );
      }
      if (error.kind === "auth") {
        return Response.json(
          { error: "Code execution provider authentication failed" },
          { status: 502 },
        );
      }
    }

    console.error("Code execution failed:", error);
    return Response.json({ error: "Code execution failed" }, { status: 502 });
  }
}
