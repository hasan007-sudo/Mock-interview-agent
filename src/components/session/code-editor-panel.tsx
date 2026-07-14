"use client";

import Editor from "@monaco-editor/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  type Evaluation,
  EvaluationResult,
} from "@/components/session/evaluation-result";
import type { SupportedLanguage } from "@/lib/events";

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  java: "Java",
  javascript: "JavaScript",
  python: "Python",
};

export function CodeEditorPanel({
  question,
  initialLanguage,
  onClose,
}: {
  question: string;
  initialLanguage: SupportedLanguage;
  onClose: () => void;
}) {
  const [language, setLanguage] = useState<SupportedLanguage>(initialLanguage);
  const [code, setCode] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);

  async function handleSubmit() {
    if (!code.trim() || isEvaluating) return;
    setIsEvaluating(true);
    setEvaluation(null);
    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface: "code", question, language, code }),
      });
      if (!response.ok) throw new Error(`Evaluation failed: ${response.status}`);
      setEvaluation(await response.json());
    } catch (error) {
      console.error(error);
      toast.error("Evaluation failed. Please try again.");
    } finally {
      setIsEvaluating(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-neutral-200">
            Coding question
          </h2>
          <p className="mt-1 text-sm text-neutral-400">{question}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          Close
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          theme="vs-dark"
          language={language}
          value={code}
          onChange={(value) => setCode(value ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
          loading={
            <p className="text-sm text-neutral-500">Loading editor…</p>
          }
        />
      </div>

      <div className="space-y-3 border-t border-neutral-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 outline-none"
          >
            {(Object.keys(LANGUAGE_LABELS) as SupportedLanguage[]).map(
              (lang) => (
                <option key={lang} value={lang}>
                  {LANGUAGE_LABELS[lang]}
                </option>
              ),
            )}
          </select>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!code.trim() || isEvaluating}
            className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-neutral-950 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isEvaluating ? "Evaluating…" : "Submit for evaluation"}
          </button>
        </div>
        {evaluation && <EvaluationResult evaluation={evaluation} />}
      </div>
    </div>
  );
}
