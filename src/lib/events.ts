import { z } from "zod";

const supportedLanguageSchema = z.enum(["java", "javascript", "python"]);
const questionSurfaceSchema = z.enum(["verbal", "code", "whiteboard"]);

export type SupportedLanguage = z.infer<typeof supportedLanguageSchema>;

const interviewQuestionSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1),
  surface: questionSurfaceSchema,
  language: supportedLanguageSchema.optional(),
});

const agentDataEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interview_question_started"),
    status: z.literal("started").optional(),
    timestamp: z.string().optional(),
    metadata: z.object({ question: interviewQuestionSchema }),
  }),
  z.object({
    type: z.literal("open_code_editor"),
    timestamp: z.string().optional(),
    metadata: z.object({
      question: z.string().trim().min(1),
      language: supportedLanguageSchema.catch("javascript"),
    }),
  }),
  z.object({
    type: z.literal("open_whiteboard"),
    timestamp: z.string().optional(),
    metadata: z.object({ question: z.string().trim().min(1) }),
  }),
]);

export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;
export type AgentDataEvent = z.infer<typeof agentDataEventSchema>;

export function parseAgentEvent(payload: Uint8Array): AgentDataEvent | null {
  try {
    const event = JSON.parse(new TextDecoder().decode(payload));
    const result = agentDataEventSchema.safeParse(event);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
