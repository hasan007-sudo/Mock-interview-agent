"use client";

import Editor from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { CodeExecutionResult } from "@/lib/code-execution";
import type { SupportedLanguage } from "@/lib/events";

const MAX_CODE_ANSWER_CHARS = 20_000;

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  java: "Java",
  javascript: "JavaScript",
  python: "Python",
};

const OUTCOME_STYLES: Record<CodeExecutionResult["outcome"], string> = {
  completed: "bg-emerald-950 text-emerald-300 border-emerald-900",
  error: "bg-red-950 text-red-300 border-red-900",
  timeout: "bg-amber-950 text-amber-300 border-amber-900",
};

function ExecutionConsole({ result }: { result: CodeExecutionResult }) {
  const hasOutput = Boolean(
    result.stdout.trim() || result.stderr.trim() || result.details?.trim(),
  );

  return (
    <div className="overflow-hidden rounded-lg bg-background/65 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">Console</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${OUTCOME_STYLES[result.outcome]}`}
          >
            {result.outcome}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
          {result.compilationTimeMs !== null && (
            <span>Compile {result.compilationTimeMs} ms</span>
          )}
          {result.executionTimeMs !== null && (
            <span>Run {result.executionTimeMs} ms</span>
          )}
          {result.memoryKb !== null && <span>{result.memoryKb} KB</span>}
        </div>
      </div>
      <div className="max-h-44 space-y-2 overflow-auto px-3 py-2 font-mono text-xs leading-5">
        {result.stdout.trim() && (
          <pre className="whitespace-pre-wrap break-words text-emerald-300">
            {result.stdout}
          </pre>
        )}
        {result.stderr.trim() && (
          <pre className="whitespace-pre-wrap break-words text-red-300">
            {result.stderr}
          </pre>
        )}
        {result.details?.trim() && result.details !== result.stderr && (
          <pre className="whitespace-pre-wrap break-words text-amber-300">
            {result.details}
          </pre>
        )}
        {!hasOutput && result.outcome === "completed" && (
          <p className="text-muted-foreground">
            Program completed with no output.
          </p>
        )}
      </div>
    </div>
  );
}

export function CodeEditorPanel({
  question,
  initialLanguage,
  initialCode,
  readOnly,
  onContentChange,
  onSubmit,
  onClose,
}: {
  question: string;
  initialLanguage: SupportedLanguage;
  initialCode: string;
  readOnly: boolean;
  onContentChange: (answer: {
    code: string;
    language: SupportedLanguage;
  }) => void;
  onSubmit: (answer: {
    code: string;
    language: SupportedLanguage;
  }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [language, setLanguage] = useState<SupportedLanguage>(initialLanguage);
  const [code, setCode] = useState(initialCode);
  const runAbortControllerRef = useRef<AbortController | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<CodeExecutionResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(
    () => () => {
      runAbortControllerRef.current?.abort();
    },
    [],
  );

  async function handleRun() {
    if (!code.trim() || isRunning) return;
    const abortController = new AbortController();
    runAbortControllerRef.current = abortController;
    setIsRunning(true);
    setRunResult(null);
    try {
      const response = await fetch("/api/code/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, code }),
        signal: abortController.signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Code execution failed: ${response.status}`);
      }
      const result = (await response.json()) as CodeExecutionResult;
      if (runAbortControllerRef.current === abortController) {
        setRunResult(result);
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Code execution failed.",
      );
    } finally {
      if (runAbortControllerRef.current === abortController) {
        runAbortControllerRef.current = null;
        setIsRunning(false);
      }
    }
  }

  async function handleSubmit() {
    if (!code.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const saved = await onSubmit({ language, code });
      if (saved) {
        toast.success("Answer saved for final feedback.");
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border)]">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            {readOnly ? "Code output question" : "Coding question"}
          </h2>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">{question}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-input px-3 py-1.5 text-xs text-secondary-foreground hover:bg-accent"
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
          onChange={(value) => {
            if (readOnly) return;
            const nextCode = value ?? "";
            if (nextCode.length > MAX_CODE_ANSWER_CHARS) {
              toast.error("Code answers are limited to 20,000 characters.");
              return;
            }
            runAbortControllerRef.current?.abort();
            runAbortControllerRef.current = null;
            setIsRunning(false);
            setCode(nextCode);
            setRunResult(null);
            onContentChange({ code: nextCode, language });
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            readOnly,
            domReadOnly: readOnly,
          }}
          loading={
            <p className="text-sm text-muted-foreground">Loading editor…</p>
          }
        />
      </div>

      {!readOnly && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <select
              value={language}
              onChange={(e) => {
                runAbortControllerRef.current?.abort();
                runAbortControllerRef.current = null;
                setIsRunning(false);
                const nextLanguage = e.target.value as SupportedLanguage;
                setLanguage(nextLanguage);
                setRunResult(null);
                onContentChange({ code, language: nextLanguage });
              }}
              className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
            >
              {(Object.keys(LANGUAGE_LABELS) as SupportedLanguage[]).map(
                (lang) => (
                  <option key={lang} value={lang}>
                    {LANGUAGE_LABELS[lang]}
                  </option>
                ),
              )}
            </select>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRun}
                disabled={!code.trim() || isRunning}
                className="rounded-lg border border-input bg-secondary px-4 py-1.5 text-sm font-medium text-secondary-foreground transition-[background-color,scale] hover:bg-accent active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRunning ? "Running…" : "Run"}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!code.trim() || isSaving}
                className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-[background-color,scale] hover:bg-violet-200 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? "Saving…" : "Save answer"}
              </button>
            </div>
          </div>
          {runResult && <ExecutionConsole result={runResult} />}
        </div>
      )}
    </div>
  );
}
