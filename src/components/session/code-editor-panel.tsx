"use client";

import Editor from "@monaco-editor/react";
import {
  ParticipantKind,
  RpcError,
  type Room,
} from "livekit-client";
import type { editor } from "monaco-editor";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import type { CodeExecutionResult } from "@/lib/code-execution";
import type { SupportedLanguage } from "@/lib/events";

const MAX_CODE_ANSWER_CHARS = 20_000;
const CODE_RPC_METHOD = "workspace.code";
const MAX_CODE_RPC_RESPONSE_BYTES = 14 * 1024;
const PUBLISH_ON_BEHALF_ATTRIBUTE = "lk.publish_on_behalf";

function serializeCodeRangeResponse(result: {
  fromLine: number;
  toLine: number;
  from: number;
  to: number;
  text: string;
}) {
  const response = JSON.stringify({
    ok: true,
    result: { ...result, truncated: false },
  });
  if (new TextEncoder().encode(response).byteLength > MAX_CODE_RPC_RESPONSE_BYTES) {
    throw new RpcError(2002, "Code range is too large; request fewer lines");
  }
  return response;
}

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  html: "HTML/CSS/JavaScript",
  java: "Java",
  javascript: "Plain JavaScript",
  python: "Python",
  react: "React",
};

const browserConsoleMessageSchema = z
  .object({
    source: z.literal("mock-interview-code-preview"),
    type: z.literal("console"),
    channel: z.string().uuid(),
    level: z.enum(["log", "info", "warn", "error", "clear"]),
    values: z.array(z.string().max(4_000)).max(20),
  })
  .strict();

type BrowserConsoleEntry = {
  id: number;
  level: "log" | "info" | "warn" | "error";
  text: string;
};

type PreviewConsoleTarget = {
  channel: string;
  origin: string;
};

const BROWSER_CONSOLE_STYLES: Record<BrowserConsoleEntry["level"], string> = {
  log: "text-foreground",
  info: "text-sky-300",
  warn: "text-amber-300",
  error: "text-red-300",
};

function monacoLanguage(language: SupportedLanguage) {
  return language === "react" ? "javascript" : language;
}

const OUTCOME_STYLES: Record<CodeExecutionResult["outcome"], string> = {
  completed: "bg-emerald-950 text-emerald-300 border-emerald-900",
  error: "bg-red-950 text-red-300 border-red-900",
  timeout: "bg-amber-950 text-amber-300 border-amber-900",
};

function ExecutionConsole({
  result,
  browserEntries,
}: {
  result: CodeExecutionResult;
  browserEntries: BrowserConsoleEntry[];
}) {
  const hasOutput = Boolean(
    result.stdout.trim() ||
      result.stderr.trim() ||
      result.details?.trim() ||
      browserEntries.length,
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
      <div
        className="max-h-44 space-y-2 overflow-auto px-3 py-2 font-mono text-xs leading-5"
        aria-live="polite"
      >
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
        {browserEntries.map((entry) => (
          <pre
            key={entry.id}
            className={`whitespace-pre-wrap break-words ${BROWSER_CONSOLE_STYLES[entry.level]}`}
          >
            {entry.level === "log" ? "" : `[${entry.level}] `}
            {entry.text}
          </pre>
        ))}
        {!hasOutput && result.outcome === "completed" && (
          <p className="text-muted-foreground">
            {result.previewUrl
              ? "Preview loaded. Browser console output will appear here."
              : "Program completed with no output."}
          </p>
        )}
      </div>
    </div>
  );
}

export function CodeEditorPanel({
  room,
  question,
  initialLanguage,
  initialCode,
  readOnly,
  onContentChange,
  onSubmit,
  onClose,
}: {
  room: Room;
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
  const tabId = useId();
  const codeTabId = `${tabId}-code-tab`;
  const codePanelId = `${tabId}-code-panel`;
  const outputTabId = `${tabId}-output-tab`;
  const outputPanelId = `${tabId}-output-panel`;
  const [language, setLanguage] = useState<SupportedLanguage>(initialLanguage);
  const [code, setCode] = useState(initialCode);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const runAbortControllerRef = useRef<AbortController | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const previewConsoleTargetRef = useRef<PreviewConsoleTarget | null>(null);
  const browserConsoleSequenceRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<CodeExecutionResult | null>(null);
  const [activeTab, setActiveTab] = useState<"code" | "output">("code");
  const [isSaving, setIsSaving] = useState(false);
  const [browserConsoleEntries, setBrowserConsoleEntries] = useState<
    BrowserConsoleEntry[]
  >([]);

  useEffect(
    () => () => {
      runAbortControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    room.registerRpcMethod(CODE_RPC_METHOD, async (invocation) => {
      const caller = room.remoteParticipants.get(invocation.callerIdentity);
      if (
        caller?.kind !== ParticipantKind.AGENT ||
        caller.attributes[PUBLISH_ON_BEHALF_ATTRIBUTE]
      ) {
        throw new RpcError(2001, "Only the session agent may inspect the editor");
      }

      let request: {
        action?: string;
        payload?: Record<string, unknown>;
      };
      try {
        request = JSON.parse(invocation.payload) as {
          action?: string;
          payload?: Record<string, unknown>;
        };
      } catch {
        throw new RpcError(2002, "Invalid code command");
      }

      const mountedEditor = editorRef.current;
      const model = mountedEditor?.getModel();
      if (!mountedEditor || !model) {
        throw new RpcError(2002, "Code editor is not ready");
      }

      if (request.action === "get_range") {
        const fromLine = Number(request.payload?.fromLine);
        const requestedToLine = Number(request.payload?.toLine);
        if (
          !Number.isInteger(fromLine) ||
          !Number.isInteger(requestedToLine) ||
          fromLine < 1 ||
          requestedToLine < fromLine ||
          fromLine > model.getLineCount()
        ) {
          throw new RpcError(2002, "Invalid code line range");
        }

        const toLine = Math.min(requestedToLine, model.getLineCount());
        const range = {
          startLineNumber: fromLine,
          startColumn: 1,
          endLineNumber: toLine,
          endColumn: model.getLineMaxColumn(toLine),
        };
        return serializeCodeRangeResponse({
          fromLine,
          toLine,
          from: model.getOffsetAt({ lineNumber: fromLine, column: 1 }),
          to: model.getOffsetAt({
            lineNumber: toLine,
            column: model.getLineMaxColumn(toLine),
          }),
          text: model.getValueInRange(range),
        });
      }

      if (request.action !== "highlight_range") {
        throw new RpcError(2002, "Unsupported code action");
      }

      const fromLine = Number(request.payload?.fromLine);
      const requestedToLine = Number(request.payload?.toLine);
      if (
        !Number.isInteger(fromLine) ||
        !Number.isInteger(requestedToLine) ||
        fromLine < 1 ||
        requestedToLine < fromLine ||
        fromLine > model.getLineCount()
      ) {
        throw new RpcError(2002, "Invalid code line range");
      }

      const toLine = Math.min(requestedToLine, model.getLineCount());
      const range = {
        startLineNumber: fromLine,
        startColumn: 1,
        endLineNumber: toLine,
        endColumn: model.getLineMaxColumn(toLine),
      };
      setActiveTab("code");
      decorationIdsRef.current = mountedEditor.deltaDecorations(
        decorationIdsRef.current,
        [
          {
            range,
            options: {
              isWholeLine: true,
              inlineClassName: "agent-code-highlight",
            },
          },
        ],
      );
      requestAnimationFrame(() => {
        mountedEditor.layout();
        mountedEditor.revealRangeInCenter(range);
      });
      return JSON.stringify({ ok: true });
    });

    return () => {
      room.unregisterRpcMethod(CODE_RPC_METHOD);
      const mountedEditor = editorRef.current;
      if (mountedEditor) {
        mountedEditor.deltaDecorations(decorationIdsRef.current, []);
      }
      decorationIdsRef.current = [];
      editorRef.current = null;
    };
  }, [room]);

  useEffect(() => {
    function handlePreviewMessage(event: MessageEvent) {
      const target = previewConsoleTargetRef.current;
      if (
        !target ||
        event.origin !== target.origin ||
        event.source !== previewFrameRef.current?.contentWindow
      ) {
        return;
      }
      const parsed = browserConsoleMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.channel !== target.channel) return;
      if (parsed.data.level === "clear") {
        setBrowserConsoleEntries([]);
        return;
      }
      browserConsoleSequenceRef.current += 1;
      const entry: BrowserConsoleEntry = {
        id: browserConsoleSequenceRef.current,
        level: parsed.data.level,
        text: parsed.data.values.join(" "),
      };
      setBrowserConsoleEntries((entries) => [...entries.slice(-199), entry]);
    }

    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, []);

  async function handleRun() {
    if (!code.trim() || isRunning) return;
    const abortController = new AbortController();
    runAbortControllerRef.current = abortController;
    setIsRunning(true);
    setRunResult(null);
    previewConsoleTargetRef.current = null;
    setBrowserConsoleEntries([]);
    setActiveTab("output");
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
        previewConsoleTargetRef.current =
          result.previewUrl && result.consoleChannel
            ? {
                channel: result.consoleChannel,
                origin: new URL(result.previewUrl).origin,
              }
            : null;
        setRunResult(result);
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      console.error(error);
      setActiveTab("code");
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

  const webPreviewUrl =
    language === "html" || language === "react"
      ? (runResult?.previewUrl ?? null)
      : null;

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

      <div
        role="tablist"
        aria-label="Code editor views"
        className="flex shrink-0 items-end gap-1 border-b border-border bg-background/35 px-3 pt-2"
      >
        <button
          type="button"
          role="tab"
          id={codeTabId}
          aria-controls={codePanelId}
          aria-selected={activeTab === "code"}
          onClick={() => setActiveTab("code")}
          className="cursor-pointer border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-t-md focus-visible:outline-2 focus-visible:outline-ring aria-selected:border-primary aria-selected:text-foreground"
        >
          Code
        </button>
        <button
          type="button"
          role="tab"
          id={outputTabId}
          aria-controls={outputPanelId}
          aria-selected={activeTab === "output"}
          onClick={() => setActiveTab("output")}
          className="cursor-pointer border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-t-md focus-visible:outline-2 focus-visible:outline-ring aria-selected:border-primary aria-selected:text-foreground"
        >
          Output
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <div
          role="tabpanel"
          id={codePanelId}
          aria-labelledby={codeTabId}
          hidden={activeTab !== "code"}
          className="h-full"
        >
          <Editor
            height="100%"
            theme="vs-dark"
            language={monacoLanguage(language)}
            value={code}
            onMount={(mountedEditor) => {
              editorRef.current = mountedEditor;
            }}
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
              previewConsoleTargetRef.current = null;
              setBrowserConsoleEntries([]);
              setActiveTab("code");
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
        <div
          role="tabpanel"
          id={outputPanelId}
          aria-labelledby={outputTabId}
          hidden={activeTab !== "output"}
          className="h-full overflow-auto bg-background/45 p-4"
        >
          {isRunning ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Running code…
            </div>
          ) : runResult ? (
            <div className="space-y-3">
              {webPreviewUrl && (
                <div className="h-72 overflow-hidden rounded-lg bg-white sm:h-80">
                  <iframe
                    ref={previewFrameRef}
                    src={webPreviewUrl}
                    title="Code preview"
                    className="size-full border-0 bg-white"
                    sandbox="allow-forms allow-modals allow-same-origin allow-scripts"
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}
              <ExecutionConsole
                result={runResult}
                browserEntries={browserConsoleEntries}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Run your code to see its output here.
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          {!readOnly ? (
            <>
              <select
                value={language}
                onChange={(e) => {
                  runAbortControllerRef.current?.abort();
                  runAbortControllerRef.current = null;
                  setIsRunning(false);
                  const nextLanguage = e.target.value as SupportedLanguage;
                  setLanguage(nextLanguage);
                  setRunResult(null);
                  previewConsoleTargetRef.current = null;
                  setBrowserConsoleEntries([]);
                  setActiveTab("code");
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
            </>
          ) : (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleRun}
                disabled={!code.trim() || isRunning}
                className="rounded-lg border border-input bg-secondary px-4 py-1.5 text-sm font-medium text-secondary-foreground transition-[background-color,scale] hover:bg-accent active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRunning ? "Running…" : "Run"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
