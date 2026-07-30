import { NoObjectGeneratedError } from "ai";
import { ResumeInputError, parseResume } from "@/lib/resume-parser";

export const dynamic = "force-dynamic";

const DEFAULT_INTERVIEW_TRACK = "frontend React";
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENROUTER_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  const name = readField(formData, "name");
  const interviewTrack =
    readField(formData, "interview_track") || DEFAULT_INTERVIEW_TRACK;

  if (!file || !(file instanceof File)) {
    return Response.json({ error: "A resume file is required" }, { status: 400 });
  }
  if (file.size > MAX_RESUME_BYTES) {
    return Response.json(
      { error: "Resume is larger than 10 MB" },
      { status: 400 },
    );
  }
  if (!name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const result = await parseResume(file, {
      apiKey,
      model:
        process.env.RESUME_MODEL ??
        process.env.OPENROUTER_MODEL ??
        "google/gemini-2.5-flash",
      interviewTrack,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof ResumeInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (NoObjectGeneratedError.isInstance(error)) {
      console.error("Resume parsing failed validation:", error.text);
    } else {
      console.error("Resume parsing failed:", error);
    }
    return Response.json(
      { error: "Failed to generate interview plan" },
      { status: 502 },
    );
  }
}

function readField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
