import { z } from "zod";

export const supportedLanguageSchema = z.enum([
  "java",
  "javascript",
  "python",
  "react",
]);
export const questionSurfaceSchema = z.enum([
  "verbal",
  "code",
  "choice",
  "whiteboard",
]);
export const questionAnswerModeSchema = z.enum(["verbal", "surface"]);
export const questionTypeSchema = z.enum([
  "verbal",
  "code-output",
  "coding",
  "machine-coding",
  "mcq",
  "whiteboard",
]);
export const questionResponseModeSchema = z.enum([
  "verbal",
  "code",
  "choice",
  "surface",
]);

export type SupportedLanguage = z.infer<typeof supportedLanguageSchema>;

export const interviewQuestionSchema = z
  .object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
    spokenText: z.string().trim().min(1).optional(),
    questionType: questionTypeSchema.optional(),
    responseMode: questionResponseModeSchema.optional(),
    surface: questionSurfaceSchema,
    answerMode: questionAnswerModeSchema.optional(),
    difficulty: z.string().trim().min(1).optional(),
    domain: z.array(z.string().trim().min(1)).optional(),
    topics: z.array(z.string().trim().min(1)).optional(),
    options: z.array(z.string().trim().min(1)).min(2).optional(),
    language: supportedLanguageSchema.optional(),
    starterCode: z.string().optional(),
  })
  .strict()
  .superRefine((question, context) => {
    const answerMode =
      question.answerMode ??
      (question.surface === "verbal" ? "verbal" : "surface");
    if (question.surface === "verbal" && answerMode !== "verbal") {
      context.addIssue({
        code: "custom",
        path: ["answerMode"],
        message: "Verbal questions require a verbal answer.",
      });
    }
    if (question.surface === "whiteboard" && answerMode !== "surface") {
      context.addIssue({
        code: "custom",
        path: ["answerMode"],
        message: "Whiteboard questions require a surface answer.",
      });
    }
    if (
      question.surface === "choice" &&
      (question.questionType !== "mcq" ||
        question.responseMode !== "choice" ||
        answerMode !== "surface" ||
        !question.options)
    ) {
      context.addIssue({
        code: "custom",
        path: ["surface"],
        message: "Choice questions require MCQ metadata and options.",
      });
    }
    if (question.questionType === "mcq" && question.surface !== "choice") {
      context.addIssue({
        code: "custom",
        path: ["questionType"],
        message: "MCQ questions require the choice surface.",
      });
    }
    if (
      question.starterCode !== undefined &&
      question.surface !== "code" &&
      question.surface !== "choice"
    ) {
      context.addIssue({
        code: "custom",
        path: ["starterCode"],
        message: "Starter code requires the code or choice surface.",
      });
    }
    if (
      question.surface === "code" &&
      answerMode === "verbal" &&
      !question.starterCode?.trim()
    ) {
      context.addIssue({
        code: "custom",
        path: ["starterCode"],
        message: "Verbal code questions require starter code.",
      });
    }
  });

const agentDataEventSchema = z.object({
  type: z.literal("interview_question_started"),
  status: z.literal("started").optional(),
  timestamp: z.string().optional(),
  metadata: z.object({ question: interviewQuestionSchema }).strict(),
});

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
