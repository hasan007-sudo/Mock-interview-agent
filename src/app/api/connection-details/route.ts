import {
  createAgentDispatchClient,
  createParticipantToken,
  createRoomServiceClient,
  getLiveKitCredentials,
} from "@/lib/livekit";
import { buildAdaptivePlan, type VasanthOpening } from "@/lib/opening";
import {
  buildInterviewPlan,
  DEFAULT_QUESTIONS,
  SYSTEM_DESIGN_TEST_QUESTIONS,
  validateQuestions,
} from "@/lib/questions";

export const dynamic = "force-dynamic";

export const MOCK_INTERVIEW_VERSION = "mock_interview";

/** Room metadata is broadcast to every participant, so cap the embedded resume. */
const MAX_RESUME_METADATA_CHARS = 16000;
const INTERVIEW_QUESTION_MODE =
  process.env.INTERVIEW_QUESTION_MODE ?? "backend";

export async function POST(request: Request) {
  let name = "";
  let body: Record<string, unknown>;
  try {
    body = await request.json();
    name = typeof body?.name === "string" ? body.name.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (
    body.interview &&
    typeof body.interview === "object" &&
    "type" in body.interview &&
    body.interview.type === "resume_mastery"
  ) {
    return Response.json(
      {
        error:
          "Resume Mastery sessions require multipart POST /api/resume-sessions",
      },
      { status: 400 },
    );
  }
  if (!name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const opening = body?.opening as VasanthOpening | undefined;
  const rawQuestions = body?.questions;
  const resumeMarkdown =
    typeof body?.markdown === "string" ? body.markdown.trim() : "";

  const questionResult =
    INTERVIEW_QUESTION_MODE === "system-design-only"
      ? validateQuestions(SYSTEM_DESIGN_TEST_QUESTIONS)
      : INTERVIEW_QUESTION_MODE === "frontend"
        ? rawQuestions === undefined
          ? { questions: DEFAULT_QUESTIONS }
          : validateQuestions(rawQuestions)
        : null;
  if (questionResult && "error" in questionResult) {
    return Response.json({ error: questionResult.error }, { status: 400 });
  }
  const questions = questionResult?.questions;

  let metadata: string;

  if (opening) {
    metadata = JSON.stringify({
      agent_id: MOCK_INTERVIEW_VERSION,
      avatar: true,
      user_name: name,
      interaction_mode: "adaptive",
      screen_feedback_mode: "timer",
      opening,
      ...(questions ? { questions } : {}),
      prompt_context: {
        agent_name: "Vasanth",
        current_round: "adaptive_opening",
        role: "Software Engineer",
        adaptive_plan: buildAdaptivePlan(opening),
        // Rendered by vasanth.md as {resume_markdown}. The agent reads only
        // metadata.prompt_context, so a top-level field would never reach the prompt.
        resume_markdown: resumeMarkdown.slice(0, MAX_RESUME_METADATA_CHARS),
        ...(questions
          ? { interview_plan: buildInterviewPlan(questions) }
          : {}),
      },
    });
  } else {
    metadata = JSON.stringify({
      agent_id: MOCK_INTERVIEW_VERSION,
      avatar: true,
      user_name: name,
      interaction_mode: "auto",
      screen_feedback_mode: "timer",
      ...(questions ? { questions } : {}),
      prompt_context: {
        agent_name: "Vasanth",
        current_round: "technical",
        role: "Software Engineer",
        topics: "data structures, algorithms, and web fundamentals",
        ...(questions
          ? { interview_plan: buildInterviewPlan(questions) }
          : {}),
      },
    });
  }

  try {
    const { url, agentName } = getLiveKitCredentials();
    const roomName = `mock_interview_${Date.now()}`;

    const roomClient = createRoomServiceClient();
    await roomClient.createRoom({
      name: roomName,
      metadata,
      emptyTimeout: 900,
      maxParticipants: 5,
    });

    const dispatchClient = createAgentDispatchClient();
    await dispatchClient.createDispatch(roomName, agentName, { metadata });

    const participantToken = await createParticipantToken({
      identity: `candidate_${Date.now()}`,
      name,
      roomName,
    });

    return Response.json({
      serverUrl: url,
      roomName,
      participantName: name,
      participantToken,
    });
  } catch (error) {
    console.error("Failed to create connection details:", error);
    return Response.json(
      { error: "Failed to create interview session" },
      { status: 500 },
    );
  }
}
