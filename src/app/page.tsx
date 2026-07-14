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
      <div className="w-full max-w-2xl rounded-xl border border-neutral-800 bg-neutral-900 p-8">
        <h1 className="text-2xl font-semibold text-neutral-100">
          Mock Technical Interview
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          A realistic voice interview with an AI interviewer. Questions marked{" "}
          <code className="text-neutral-300">&quot;surface&quot;: &quot;code&quot;</code> open a
          code editor on your screen and{" "}
          <code className="text-neutral-300">&quot;whiteboard&quot;</code> opens a drawing
          canvas; <code className="text-neutral-300">&quot;verbal&quot;</code> questions are
          answered by speaking.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm text-neutral-300">
              Your name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya"
              autoFocus
              maxLength={60}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-neutral-300">
              Interview questions (JSON)
            </span>
            <textarea
              value={questionsJson}
              onChange={(e) => setQuestionsJson(e.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs leading-relaxed text-neutral-200 outline-none focus:border-neutral-500"
            />
            <span className="mt-1.5 block text-xs text-neutral-500">
              Each question needs an id, text, and a surface flag: verbal, code
              (optional language: java, javascript, python), or whiteboard.
            </span>
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={!name.trim() || isStarting}
            className="w-full rounded-lg bg-white px-4 py-2.5 font-medium text-neutral-950 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStarting ? "Setting up your interview…" : "Start interview"}
          </button>
          <p className="text-xs text-neutral-500">
            Your microphone and camera will be enabled when the session starts.
          </p>
        </form>
      </div>
    </main>
  );
}
