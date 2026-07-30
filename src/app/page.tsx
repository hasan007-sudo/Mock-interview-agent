"use client";

import { ChevronDown, FileText, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { CONNECTION_STORAGE_KEY } from "@/lib/connection";
import type { VasanthOpening } from "@/lib/opening";

const TRACK_OPTIONS = [
  "frontend React",
  "backend Java",
  "full-stack",
  "data structures and algorithms",
  "system design",
  "DevOps",
];

export default function Home() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [interviewTrack, setInterviewTrack] = useState("frontend React");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeMarkdown, setResumeMarkdown] = useState<string | null>(null);
  const [parsedOpening, setParsedOpening] = useState<VasanthOpening | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setResumeFile(file);
    setParsedOpening(null);
    setResumeMarkdown(null);
    setError(null);
  }

  async function handleParse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resumeFile || !name.trim() || isParsing) return;

    setIsParsing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", resumeFile);
      formData.append("name", name.trim());
      formData.append("interview_track", interviewTrack);

      const response = await fetch("/api/parse-resume", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed with status ${response.status}`);
      }
      const data = await response.json();
      setParsedOpening(data.opening);
      setResumeMarkdown(data.markdown ?? null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Could not parse resume. Please try again.");
    } finally {
      setIsParsing(false);
    }
  }

  async function handleStartInterview() {
    if (!parsedOpening || !name.trim() || isStarting) return;

    setIsStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/connection-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          opening: parsedOpening,
          markdown: resumeMarkdown,
        }),
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
      <div className="my-auto w-full max-w-2xl rounded-xl bg-card p-5 shadow-[var(--shadow-border)] sm:p-8">
        <h1 className="text-balance text-2xl font-semibold text-foreground">
          Mock Technical Interview
        </h1>
        <p className="mt-2 text-pretty text-sm text-muted-foreground">
          Upload your resume and the interviewer will adapt to your background.
        </p>

        <form onSubmit={handleParse} className="mt-6 space-y-5">
          <label className="block">
            <span className="mb-1.5 block text-sm text-secondary-foreground">Your name</span>
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
            <span className="mb-1.5 block text-sm text-secondary-foreground">Interview track</span>
            <div className="relative">
              <select
                value={interviewTrack}
                onChange={(e) => setInterviewTrack(e.target.value)}
                className="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-8 text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
              >
                {TRACK_OPTIONS.map((track) => (
                  <option key={track} value={track}>
                    {track}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm text-secondary-foreground">Resume</span>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-input px-4 py-4 text-left transition-colors hover:border-primary/45 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {resumeFile ? (
                <>
                  <FileText className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {resumeFile.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {(resumeFile.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <Upload className="size-5 shrink-0 text-muted-foreground" />
                  <div>
                    <span className="block text-sm font-medium text-foreground">
                      Choose a resume file
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      PDF, TXT, or Markdown
                    </span>
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {!parsedOpening ? (
            <button
              type="submit"
              disabled={!name.trim() || !resumeFile || isParsing}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-[background-color,scale] hover:bg-violet-200 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isParsing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Analyzing resume…
                </>
              ) : (
                "Parse resume"
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartInterview}
              disabled={isStarting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-[background-color,scale] hover:bg-violet-200 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStarting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Setting up your interview…
                </>
              ) : (
                "Start interview"
              )}
            </button>
          )}
        </form>

        {parsedOpening && (
          <div className="mt-6 space-y-4 rounded-xl border border-border bg-background/50 p-4 sm:p-5">
            <h2 className="text-sm font-medium text-secondary-foreground">
              Interview plan preview
            </h2>

            <div className="space-y-3">
              <div className="rounded-lg bg-primary/5 p-3">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Opening question
                </span>
                <p className="text-sm text-foreground">
                  {parsedOpening.opening.question}
                </p>
              </div>

              {parsedOpening.follow_up_plans.map((plan, i) => (
                <div key={i} className="rounded-lg bg-secondary/30 p-3">
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Follow-up {i + 1}
                  </span>
                  <p className="text-sm text-foreground">{plan.question}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Ask if: {plan.ask_if[0]}
                  </p>
                </div>
              ))}

              <div className="rounded-lg bg-secondary/30 p-3">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Transition
                </span>
                <p className="text-xs text-muted-foreground">
                  {parsedOpening.transition_to_technical}
                </p>
              </div>
            </div>

            {resumeMarkdown && (
              <details className="group rounded-lg bg-secondary/30 p-3">
                <summary className="cursor-pointer list-none text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
                  Parsed resume
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {resumeMarkdown}
                </pre>
              </details>
            )}

            <button
              type="button"
              onClick={() => {
                setParsedOpening(null);
                setResumeMarkdown(null);
                setResumeFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Parse a different resume
            </button>
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Your microphone and camera will be enabled when the session starts.
        </p>
      </div>
    </main>
  );
}
