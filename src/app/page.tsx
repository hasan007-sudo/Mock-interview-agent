"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { CONNECTION_STORAGE_KEY } from "@/lib/connection";
import { DEFAULT_QUESTIONS, validateQuestions } from "@/lib/questions";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [questionsJson, setQuestionsJson] = useState(() =>
    JSON.stringify(DEFAULT_QUESTIONS, null, 2),
  );
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || isStarting) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(questionsJson);
    } catch {
      setError("Questions are not valid JSON.");
      return;
    }
    const result = validateQuestions(parsed);
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-xl bg-card p-8 shadow-[var(--shadow-border)]">
        <h1 className="text-balance text-2xl font-semibold text-foreground">
          Mock Technical Interview
        </h1>
        <p className="mt-2 text-pretty text-sm text-muted-foreground">
          A realistic voice interview with an AI interviewer. Questions marked{" "}
          <code className="text-violet-200">&quot;surface&quot;: &quot;code&quot;</code> open a
          code editor on your screen and{" "}
          <code className="text-violet-200">&quot;whiteboard&quot;</code> opens a drawing
          canvas; <code className="text-violet-200">&quot;verbal&quot;</code> questions are
          answered by speaking.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
          <label className="block">
            <span className="mb-1.5 block text-sm text-secondary-foreground">
              Interview questions (JSON)
            </span>
            <textarea
              value={questionsJson}
              onChange={(e) => setQuestionsJson(e.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
            />
            <span className="mt-1.5 block text-pretty text-xs text-muted-foreground">
              Each question needs an id, text, and a surface flag: verbal, code
              (optional language: java, javascript, python), or whiteboard.
            </span>
          </label>
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
