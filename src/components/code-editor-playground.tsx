"use client";

import Editor from "@monaco-editor/react";
import { Play, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { ReactCodePreview } from "@/components/react-code-preview";
import { Button } from "@/components/ui/button";
import type { CodeExecutionResult } from "@/lib/code-execution";

const REACT_STARTER = `import React, { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>React execution check</h1>
      <button onClick={() => setCount((value) => value + 1)}>
        Count: {count}
      </button>
    </main>
  );
}
`;

export function CodeEditorPlayground() {
  const [code, setCode] = useState(REACT_STARTER);
  const [result, setResult] = useState<CodeExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  async function runCode() {
    if (!code.trim() || isRunning) return;

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setIsRunning(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/code/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "react", code }),
        signal: abortController.signal,
      });
      const body = (await response.json().catch(() => null)) as
        | (CodeExecutionResult & { error?: string })
        | null;

      if (!response.ok) {
        throw new Error(body?.error ?? `Execution failed (${response.status})`);
      }
      if (!body) {
        throw new Error("OneCompiler returned an empty response.");
      }
      setResult(body);
    } catch (runError) {
      if (!abortController.signal.aborted) {
        setError(
          runError instanceof Error ? runError.message : "Code execution failed.",
        );
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
        setIsRunning(false);
      }
    }
  }

  function resetCode() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setCode(REACT_STARTER);
    setResult(null);
    setError(null);
    setIsRunning(false);
  }

  const status = isRunning
    ? "Running"
    : error
      ? "Request failed"
      : result
        ? result.outcome
        : "Ready";

  return (
    <main className="min-h-screen bg-background p-3 sm:p-5">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-7xl flex-col overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border)] sm:min-h-[calc(100vh-2.5rem)]">
        <header className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="size-2 rounded-full bg-sky-400" aria-hidden="true" />
              React runtime probe
            </div>
            <h1 className="mt-1 text-xl font-semibold text-foreground">
              Monaco → OneCompiler
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={resetCode} disabled={isRunning}>
              <RotateCcw data-icon="inline-start" />
              Reset
            </Button>
            <Button onClick={runCode} disabled={!code.trim() || isRunning}>
              <Play data-icon="inline-start" />
              {isRunning ? "Running…" : "Run React"}
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-2">
          <section className="flex min-h-[32rem] min-w-0 flex-col border-b border-border lg:min-h-0 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between border-b border-border bg-background/45 px-4 py-2 text-sm">
              <span className="font-mono text-secondary-foreground">App.jsx</span>
              <span className="text-muted-foreground">React + JSX</span>
            </div>
            <div className="min-h-0 flex-1">
              <Editor
                height="100%"
                language="javascript"
                theme="vs-dark"
                value={code}
                onChange={(value) => {
                  setCode(value ?? "");
                  setResult(null);
                  setError(null);
                }}
                options={{
                  automaticLayout: true,
                  fontSize: 14,
                  minimap: { enabled: false },
                  padding: { top: 16 },
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  wordWrap: "on",
                }}
                loading={
                  <p className="p-4 text-sm text-muted-foreground">
                    Loading Monaco…
                  </p>
                }
              />
            </div>
          </section>

          <aside className="flex min-h-[32rem] flex-col bg-background/30 lg:min-h-0">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-foreground">Execution</h2>
                <span className="rounded-full border border-border bg-background px-2 py-1 text-xs capitalize text-muted-foreground">
                  {status}
                </span>
              </div>
              <p className="mt-2 text-sm leading-5 text-muted-foreground">
                Your editor content is sent as <span className="font-mono">App.jsx</span> with
                OneCompiler&apos;s required React project files.
              </p>
            </div>

            <div className="min-h-64 flex-1 border-b border-border bg-white">
              {result?.previewUrl ? (
                <ReactCodePreview url={result.previewUrl} />
              ) : (
                <div className="flex size-full items-center justify-center bg-background/95 p-6 text-center text-sm text-muted-foreground">
                  {isRunning
                    ? "Building React preview…"
                    : "Run the component to display its rendered output here."}
                </div>
              )}
            </div>

            <div className="max-h-56 min-h-32 overflow-auto p-4 font-mono text-sm" aria-live="polite">
              {!isRunning && !result && !error && (
                <p className="font-sans text-muted-foreground">
                  Console output and compilation errors appear here.
                </p>
              )}
              {isRunning && <p className="text-sky-300">Running…</p>}
              {error && <pre className="whitespace-pre-wrap text-red-300">{error}</pre>}
              {result && (
                <div className="space-y-3">
                  {result.stdout.trim() && (
                    <pre className="whitespace-pre-wrap text-emerald-300">
                      {result.stdout}
                    </pre>
                  )}
                  {result.stderr.trim() && (
                    <pre className="whitespace-pre-wrap text-red-300">
                      {result.stderr}
                    </pre>
                  )}
                  {result.details?.trim() && result.details !== result.stderr && (
                    <pre className="whitespace-pre-wrap text-amber-300">
                      {result.details}
                    </pre>
                  )}
                  {!result.stdout.trim() &&
                    !result.stderr.trim() &&
                    !result.details?.trim() && (
                      <p className="font-sans text-emerald-300">
                        {result.previewUrl
                          ? "Preview loaded successfully."
                          : "React project completed without console output."}
                      </p>
                    )}
                  <dl className="grid grid-cols-2 gap-2 border-t border-border pt-3 font-sans text-xs text-muted-foreground">
                    <div>
                      <dt>Compile</dt>
                      <dd className="mt-1 text-secondary-foreground">
                        {result.compilationTimeMs === null
                          ? "—"
                          : `${result.compilationTimeMs} ms`}
                      </dd>
                    </div>
                    <div>
                      <dt>Run</dt>
                      <dd className="mt-1 text-secondary-foreground">
                        {result.executionTimeMs === null
                          ? "—"
                          : `${result.executionTimeMs} ms`}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>

            <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              Sent files: App.jsx · index.jsx · index.html · package.json
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
