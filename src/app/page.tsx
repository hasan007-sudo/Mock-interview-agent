"use client";

import { ChevronDown, Code2, MessageCircle, PenTool, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { CONNECTION_STORAGE_KEY } from "@/lib/connection";
import {
  DEFAULT_QUESTIONS,
  type InterviewQuestion,
  type QuestionAnswerMode,
  type QuestionSurface,
  validateQuestions,
} from "@/lib/questions";

const SURFACE_OPTIONS: {
  value: QuestionSurface;
  label: string;
  description: string;
  icon: typeof MessageCircle;
}[] = [
  {
    value: "verbal",
    label: "Verbal",
    description: "Answer by speaking",
    icon: MessageCircle,
  },
  {
    value: "code",
    label: "Code",
    description: "Open a code surface",
    icon: Code2,
  },
  {
    value: "whiteboard",
    label: "Whiteboard",
    description: "Open a drawing canvas",
    icon: PenTool,
  },
];

function nextQuestionId(questions: InterviewQuestion[]) {
  const existingIds = new Set(questions.map((question) => question.id));
  let number = questions.length + 1;
  while (existingIds.has(`q${number}`)) number += 1;
  return `q${number}`;
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [questions, setQuestions] = useState<InterviewQuestion[]>(() =>
    DEFAULT_QUESTIONS.map((question) => ({ ...question })),
  );
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateQuestion(index: number, updates: Partial<InterviewQuestion>) {
    setQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index ? { ...question, ...updates } : question,
      ),
    );
    setError(null);
  }

  function updateSurface(index: number, surface: QuestionSurface) {
    setQuestions((current) =>
      current.map((question, questionIndex) => {
        if (questionIndex !== index) return question;
        if (surface === "code") {
          return {
            ...question,
            surface,
            answerMode: "surface",
            language: question.language ?? "javascript",
          };
        }
        const nextQuestion: InterviewQuestion = {
          ...question,
          surface,
          answerMode: surface === "verbal" ? "verbal" : "surface",
        };
        delete nextQuestion.language;
        delete nextQuestion.starterCode;
        return nextQuestion;
      }),
    );
    setError(null);
  }

  function addQuestion() {
    setQuestions((current) => [
      ...current,
      {
        id: nextQuestionId(current),
        text: "",
        surface: "verbal",
        answerMode: "verbal",
      },
    ]);
    setError(null);
  }

  function removeQuestion(index: number) {
    setQuestions((current) => current.filter((_, questionIndex) => questionIndex !== index));
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || isStarting) return;

    const result = validateQuestions(questions);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    setIsStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/connection-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), questions: result.questions }),
      });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const details = await response.json();
      sessionStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(details));
      router.push("/session");
    } catch (err) {
      console.error(err);
      setError("Could not start the interview. Please try again.");
      setIsStarting(false);
    }
  }

  return (
    <main className="flex min-h-screen justify-center p-4 sm:p-6">
      <div className="my-auto w-full max-w-4xl rounded-xl bg-card p-5 shadow-[var(--shadow-border)] sm:p-8">
        <h1 className="text-balance text-2xl font-semibold text-foreground">
          Mock Technical Interview
        </h1>
        <p className="mt-2 text-pretty text-sm text-muted-foreground">
          Set how each question should appear to the candidate and how they should answer.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
          <label className="block">
            <span className="mb-1.5 block text-sm text-secondary-foreground">
              Your name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya"
              autoFocus
              maxLength={60}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-2 focus:ring-ring/15"
            />
          </label>
          <details className="group overflow-hidden rounded-xl border border-border bg-background/30">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-5 [&::-webkit-details-marker]:hidden">
              <div>
                <h2 id="questions-heading" className="text-sm font-medium text-secondary-foreground">
                  Interview questions
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose one surface for each question. You can add up to 12.
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
                {questions.length} / 12
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>

            <div className="space-y-4 border-t border-border p-4 sm:p-5">
              <div className="space-y-4">
                {questions.map((question, index) => (
                <fieldset
                  key={index}
                  className="rounded-xl border border-border bg-background/55 p-4 sm:p-5"
                >
                  <legend className="sr-only">Question {index + 1}</legend>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium text-foreground">Question</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeQuestion(index)}
                      disabled={questions.length === 1}
                      aria-label={`Remove question ${index + 1}`}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
                    <label className="block">
                      <span className="mb-1.5 block text-xs text-muted-foreground">ID</span>
                      <input
                        type="text"
                        value={question.id}
                        onChange={(event) => updateQuestion(index, { id: event.target.value })}
                        placeholder="q1"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-2 focus:ring-ring/15"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs text-muted-foreground">
                        Question text
                      </span>
                      <textarea
                        value={question.text}
                        onChange={(event) => updateQuestion(index, { text: event.target.value })}
                        rows={2}
                        placeholder="What would you like to ask?"
                        className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-2 focus:ring-ring/15"
                      />
                    </label>
                  </div>

                  <div className="mt-4">
                    <span className="mb-1.5 block text-xs text-muted-foreground">Surface</span>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {SURFACE_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const isSelected = question.surface === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => updateSurface(index, option.value)}
                            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                              isSelected
                                ? "border-primary/60 bg-primary/10 text-foreground"
                                : "border-input bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground"
                            }`}
                          >
                            <Icon className={`size-4 shrink-0 ${isSelected ? "text-primary" : ""}`} />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium">{option.label}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {option.description}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-xs text-muted-foreground">
                      Spoken text <span className="text-muted-foreground/60">(optional)</span>
                    </span>
                    <textarea
                      value={question.spokenText ?? ""}
                      onChange={(event) =>
                        updateQuestion(index, { spokenText: event.target.value || undefined })
                      }
                      rows={2}
                      placeholder="Defaults to the question text. Use this when the visible question contains code or notation that should not be read aloud."
                      className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-2 focus:ring-ring/15"
                    />
                  </label>

                  {question.surface === "code" && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <span className="mb-1.5 block text-xs text-muted-foreground">
                          Response method
                        </span>
                        <div className="grid grid-cols-2 rounded-lg border border-input bg-background p-1">
                          {(
                            [
                              ["surface", "Write code"],
                              ["verbal", "Answer verbally"],
                            ] as [QuestionAnswerMode, string][]
                          ).map(([answerMode, label]) => (
                            <button
                              key={answerMode}
                              type="button"
                              aria-pressed={question.answerMode === answerMode}
                              onClick={() => updateQuestion(index, { answerMode })}
                              className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                                question.answerMode === answerMode
                                  ? "bg-secondary text-secondary-foreground shadow-sm"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-muted-foreground">Language</span>
                        <select
                          value={question.language ?? "javascript"}
                          onChange={(event) =>
                            updateQuestion(index, {
                              language: event.target.value as InterviewQuestion["language"],
                            })
                          }
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
                        >
                          <option value="javascript">JavaScript</option>
                          <option value="python">Python</option>
                          <option value="java">Java</option>
                        </select>
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="mb-1.5 block text-xs text-muted-foreground">
                          {question.answerMode === "verbal"
                            ? "Code shown to candidate"
                            : "Starter code"}
                          {question.answerMode === "verbal" && (
                            <span className="ml-1 text-primary">Required</span>
                          )}
                        </span>
                        <textarea
                          value={question.starterCode ?? ""}
                          onChange={(event) =>
                            updateQuestion(index, { starterCode: event.target.value })
                          }
                          rows={5}
                          spellCheck={false}
                          placeholder="Add code to display when this question starts."
                          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-2 focus:ring-ring/15"
                        />
                      </label>
                    </div>
                  )}
                  </fieldset>
                ))}
              </div>

              <button
                type="button"
                onClick={addQuestion}
                disabled={questions.length >= 12}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-input px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="size-4" />
                Add question
              </button>
            </div>
          </details>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={!name.trim() || isStarting}
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-[background-color,scale] hover:bg-violet-200 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStarting ? "Setting up your interview…" : "Start interview"}
          </button>
          <p className="text-xs text-muted-foreground">
            Your microphone and camera will be enabled when the session starts.
          </p>
        </form>
      </div>
    </main>
  );
}
