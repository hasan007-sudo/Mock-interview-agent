import type { SupportedLanguage } from "@/lib/events";

export type QuestionSurface = "verbal" | "code" | "whiteboard";

export type InterviewQuestion = {
  id: string;
  text: string;
  /** Which UI the agent opens when asking this question. */
  surface: QuestionSurface;
  /** Starting language for the code editor; only used when surface is "code". */
  language?: SupportedLanguage;
};

export const DEFAULT_QUESTIONS: InterviewQuestion[] = [
  {
    id: "q1",
    text: "Tell me about yourself and one project you are proud of.",
    surface: "verbal",
  },
  {
    id: "q2",
    text: "What is the difference between an array and a linked list, and when would you pick each?",
    surface: "verbal",
  },
  {
    id: "q3",
    text: "How does a hash map handle collisions?",
    surface: "verbal",
  },
  {
    id: "q4",
    text: "Write a function that returns the first non-repeating character in a string.",
    surface: "code",
    language: "javascript",
  },
  {
    id: "q5",
    text: "Sketch the high-level architecture of a URL shortener service.",
    surface: "whiteboard",
  },
];

const SURFACES: QuestionSurface[] = ["verbal", "code", "whiteboard"];
const LANGUAGES: SupportedLanguage[] = ["java", "javascript", "python"];

export function validateQuestions(
  value: unknown,
): { questions: InterviewQuestion[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "Questions must be a JSON array." };
  if (value.length === 0 || value.length > 12) {
    return { error: "Provide between 1 and 12 questions." };
  }

  const questions: InterviewQuestion[] = [];
  const seenIds = new Set<string>();
  for (const [index, item] of value.entries()) {
    const label = `Question ${index + 1}`;
    if (typeof item !== "object" || item === null) {
      return { error: `${label} must be an object.` };
    }
    const { id, text, surface, language } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim()) {
      return { error: `${label} needs a non-empty string "id".` };
    }
    if (seenIds.has(id.trim())) {
      return { error: `Duplicate question id "${id.trim()}".` };
    }
    seenIds.add(id.trim());
    if (typeof text !== "string" || !text.trim()) {
      return { error: `${label} needs a non-empty string "text".` };
    }
    if (!SURFACES.includes(surface as QuestionSurface)) {
      return {
        error: `${label} needs "surface" set to "verbal", "code", or "whiteboard".`,
      };
    }
    const question: InterviewQuestion = {
      id: id.trim(),
      text: text.trim(),
      surface: surface as QuestionSurface,
    };
    if (surface === "code") {
      if (language !== undefined && !LANGUAGES.includes(language as SupportedLanguage)) {
        return {
          error: `${label} "language" must be "java", "javascript", or "python".`,
        };
      }
      question.language = (language as SupportedLanguage) ?? "javascript";
    }
    questions.push(question);
  }
  return { questions };
}

/** Annotated plan string injected into the agent prompt via prompt_context. */
export function buildInterviewPlan(questions: InterviewQuestion[]): string {
  return questions
    .map((q, index) => {
      const annotation =
        q.surface === "code"
          ? `(code editor, ${q.language})`
          : q.surface === "whiteboard"
            ? "(whiteboard)"
            : "(verbal)";
      return `${index + 1}. [id: ${q.id}] ${annotation} ${q.text}`;
    })
    .join("\n");
}
