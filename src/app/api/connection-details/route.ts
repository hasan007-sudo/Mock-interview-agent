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
  validateQuestions,
} from "@/lib/questions";

export const dynamic = "force-dynamic";

/** Room metadata is broadcast to every participant, so cap the embedded resume. */
const MAX_RESUME_METADATA_CHARS = 16000;

export async function POST(request: Request) {
  let name = "";
  let body: Record<string, unknown>;
  try {
    body = await request.json();
    name = typeof body?.name === "string" ? body.name.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const opening = body?.opening as VasanthOpening | undefined;
  const rawQuestions = body?.questions;
  const resumeMarkdown =
    typeof body?.markdown === "string" ? body.markdown.trim() : "";

  let metadata: string;

  if (opening) {
    metadata = JSON.stringify({
      agent_id: "mock_interview",
      avatar: true,
      user_name: name,
      // Rendered by the agent prompt as {user_details}: the parsed resume the
      // opening plan was derived from.
      user_details: resumeMarkdown.slice(0, MAX_RESUME_METADATA_CHARS),
      interaction_mode: "adaptive",
      opening,
      prompt_context: {
        agent_name: "Vasanth",
        current_round: "adaptive_opening",
        role: "Software Engineer",
        adaptive_plan: buildAdaptivePlan(opening),
      },
    });
  } else {
    const result =
      rawQuestions === undefined
        ? { questions: DEFAULT_QUESTIONS }
        : validateQuestions(rawQuestions);
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    const questions = result.questions;

    metadata = JSON.stringify({
      agent_id: "mock_interview",
      avatar: true,
      user_name: name,
      interaction_mode: "auto",
      screen_feedback_mode: "timer",
      questions,
      prompt_context: {
        agent_name: "Vasanth",
        current_round: "technical",
        role: "Software Engineer",
        topics: "data structures, algorithms, and web fundamentals",
        interview_plan: buildInterviewPlan(questions),
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
