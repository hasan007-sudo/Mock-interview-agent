import { z } from "zod";
import {
  interviewQuestionSchema,
  type InterviewQuestion,
} from "@/lib/events";

export const DEFAULT_QUESTIONS: InterviewQuestion[] = [
  {
    id: "q2",
    text: "What will be the output of this code, and why?",
    spokenText: "Look at the code shown on your screen. What will it output, and why?",
    surface: "code",
    answerMode: "verbal",
    language: "javascript",
    starterCode: "console.log(a);\nvar a = 5;",
  },
  {
    id: "q3",
    text: "Explain how the event loop works in JavaScript.",
    surface: "verbal",
  },
];

export const SYSTEM_DESIGN_TEST_QUESTIONS: InterviewQuestion[] = [
  {
    id: "system-design-w07-session-14-news-feed",
    text: "Design a News feed system.",
    spokenText: "Design a News feed system.",
    questionType: "verbal",
    responseMode: "surface",
    surface: "whiteboard",
    answerMode: "surface",
    difficulty: "hard",
    domain: ["system-design"],
    topics: ["system-design", "architecture"],
  },
];

const interviewQuestionsSchema = z.array(interviewQuestionSchema).min(1).max(12);

export function validateQuestions(
  value: unknown,
): { questions: InterviewQuestion[] } | { error: string } {
  const parsed = interviewQuestionsSchema.safeParse(value);
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const seenIds = new Set<string>();
  for (const question of parsed.data) {
    if (seenIds.has(question.id)) {
      return { error: `Duplicate question id "${question.id}".` };
    }
    seenIds.add(question.id);
  }
  return {
    questions: parsed.data.map((question) => ({
      ...question,
      answerMode:
        question.answerMode ??
        (question.surface === "verbal" ? "verbal" : "surface"),
      language:
        question.surface === "code"
          ? (question.language ?? "javascript")
          : question.language,
    })),
  };
}

/** Annotated plan string injected into the agent prompt via prompt_context. */
export function buildInterviewPlan(questions: InterviewQuestion[]): string {
  return questions
    .map((q, index) => {
      const annotation =
        q.surface === "code"
          ? q.answerMode === "verbal"
            ? `(code viewer, ${q.language}, verbal answer)`
            : `(code editor, ${q.language}, written answer)`
          : q.surface === "whiteboard"
            ? "(whiteboard)"
            : q.surface === "choice"
              ? "(multiple choice)"
              : "(verbal)";
      return `${index + 1}. [id: ${q.id}] ${annotation} ${q.spokenText ?? q.text}`;
    })
    .join("\n");
}
