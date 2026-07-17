import type { SupportedLanguage } from "@/lib/events";

export type QuestionSurface = "verbal" | "code" | "whiteboard";
export type QuestionAnswerMode = "verbal" | "surface";

export type InterviewQuestion = {
  id: string;
  /** Question wording shown on screen. */
  text: string;
  /** TTS-safe wording spoken by the interviewer; defaults to text. */
  spokenText?: string;
  /** Which UI the agent opens when asking this question. */
  surface: QuestionSurface;
  /** Whether the candidate answers aloud or through the opened surface. */
  answerMode?: QuestionAnswerMode;
  /** Starting language for the code editor; only used when surface is "code". */
  language?: SupportedLanguage;
  /** Code displayed in the editor when the question starts. */
  starterCode?: string;
};

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
  {
    id: "q4",
    text: "Write a closure that returns a function which increments a counter each time it is called.",
    surface: "code",
    answerMode: "surface",
    language: "javascript",
  },
  {
    id: "q5",
    text: "Write code that deliberately triggers a TDZ ReferenceError and explain why it happens.",
    surface: "code",
    answerMode: "surface",
    language: "javascript",
  },
  {
    id: "q6",
    text: "Implement a function that demonstrates block scope using `let`.",
    surface: "code",
    answerMode: "surface",
    language: "javascript",
  },
  {
    id: "q7",
    text: "What will be the output of this code, and why?",
    spokenText: "Look at the code shown on your screen. What will it output, and why?",
    surface: "code",
    answerMode: "verbal",
    language: "javascript",
    starterCode:
      "console.log('Start');\nsetTimeout(() => console.log('Timeout'), 0);\nPromise.resolve().then(() => console.log('Promise'));\nconsole.log('End');",
  },
  {
    id: "q8",
    text: "What will be the output of this code, and why?",
    spokenText: "Look at the code shown on your screen. What will it output, and why?",
    surface: "code",
    answerMode: "verbal",
    language: "javascript",
    starterCode: "console.log(foo());\nfunction foo() { return 'Hello'; }",
  },
  {
    id: "q9",
    text: "Write a function using lexical scoping where the inner function reads a variable from the outer scope after the outer function has returned. Also, use an array data structure to store multiple closures.",
    surface: "code",
    answerMode: "surface",
    language: "javascript",
  },
  {
    id: "q10",
    text: "What will be the output of this code, and why?",
    spokenText: "Look at the code shown on your screen. What will it output, and why?",
    surface: "code",
    answerMode: "verbal",
    language: "javascript",
    starterCode:
      "let x = 10;\nfunction outer() {\n  let x = 20;\n  function inner() {\n    console.log(x);\n  }\n  return inner;\n}\nconst fn = outer();\nfn();",
  },
];

const SURFACES: QuestionSurface[] = ["verbal", "code", "whiteboard"];
const ANSWER_MODES: QuestionAnswerMode[] = ["verbal", "surface"];
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
    const { id, text, spokenText, surface, answerMode, language, starterCode } =
      item as Record<string, unknown>;
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
    if (
      answerMode !== undefined &&
      !ANSWER_MODES.includes(answerMode as QuestionAnswerMode)
    ) {
      return {
        error: `${label} "answerMode" must be "verbal" or "surface".`,
      };
    }
    const normalizedAnswerMode =
      (answerMode as QuestionAnswerMode | undefined) ??
      (surface === "verbal" ? "verbal" : "surface");
    if (
      (surface === "verbal" && normalizedAnswerMode !== "verbal") ||
      (surface === "whiteboard" && normalizedAnswerMode !== "surface")
    ) {
      return {
        error: `${label} has an incompatible "surface" and "answerMode".`,
      };
    }
    if (spokenText !== undefined && (typeof spokenText !== "string" || !spokenText.trim())) {
      return { error: `${label} "spokenText" must be a non-empty string.` };
    }
    if (starterCode !== undefined && typeof starterCode !== "string") {
      return { error: `${label} "starterCode" must be a string.` };
    }
    if (starterCode !== undefined && surface !== "code") {
      return { error: `${label} "starterCode" requires "surface": "code".` };
    }
    if (
      surface === "code" &&
      normalizedAnswerMode === "verbal" &&
      (typeof starterCode !== "string" || !starterCode.trim())
    ) {
      return {
        error: `${label} needs non-empty "starterCode" for a verbal code question.`,
      };
    }
    const question: InterviewQuestion = {
      id: id.trim(),
      text: text.trim(),
      surface: surface as QuestionSurface,
      answerMode: normalizedAnswerMode,
    };
    if (typeof spokenText === "string") question.spokenText = spokenText.trim();
    if (surface === "code") {
      if (language !== undefined && !LANGUAGES.includes(language as SupportedLanguage)) {
        return {
          error: `${label} "language" must be "java", "javascript", or "python".`,
        };
      }
      question.language = (language as SupportedLanguage) ?? "javascript";
      if (typeof starterCode === "string") question.starterCode = starterCode.trim();
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
          ? q.answerMode === "verbal"
            ? `(code viewer, ${q.language}, verbal answer)`
            : `(code editor, ${q.language}, written answer)`
          : q.surface === "whiteboard"
            ? "(whiteboard)"
            : "(verbal)";
      return `${index + 1}. [id: ${q.id}] ${annotation} ${q.spokenText ?? q.text}`;
    })
    .join("\n");
}
