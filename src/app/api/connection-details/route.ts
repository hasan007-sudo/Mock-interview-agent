import {
  createAgentDispatchClient,
  createParticipantToken,
  createRoomServiceClient,
  getLiveKitCredentials,
} from "@/lib/livekit";
import {
  buildInterviewPlan,
  DEFAULT_QUESTIONS,
  validateQuestions,
} from "@/lib/questions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let name = "";
  let rawQuestions: unknown;
  try {
    const body = await request.json();
    name = typeof body?.name === "string" ? body.name.trim() : "";
    rawQuestions = body?.questions;
  } catch {
    // fall through to validation error
  }
  if (!name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const result =
    rawQuestions === undefined
      ? { questions: DEFAULT_QUESTIONS }
      : validateQuestions(rawQuestions);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  const questions = result.questions;

  try {
    const { url, agentName } = getLiveKitCredentials();
    const roomName = `mock_interview_${Date.now()}`;
    const metadata = JSON.stringify({
      agent_id: "mock_interview",
      user_name: name,
      interaction_mode: "auto",
      screen_feedback_mode: "timer",
      questions,
      prompt_context: {
        agent_name: "Ishita",
        current_round: "technical",
        role: "Software Engineer",
        topics: "data structures, algorithms, and web fundamentals",
        interview_plan: buildInterviewPlan(questions),
      },
    });

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
