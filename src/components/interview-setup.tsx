"use client";

import { ChevronDown, FileText, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  BaseConnectionDetailsSchema,
  CONNECTION_STORAGE_KEY,
  ResumeConnectionDetailsSchema,
  ResumeSessionRequestSchema,
} from "@/lib/connection";
import {
  DEV_INTERVIEW_TRACK,
  DEV_NAME,
  DEV_OPENING,
  DEV_RESUME_DOCUMENT,
  DEV_RESUME_MARKDOWN,
  loadDevResumeFile,
} from "@/lib/dev-fixtures";
import {
  type InterviewRequest,
  ResumeInterviewRequestSchema,
  type ResumeRound,
} from "@/lib/interviews";
import type { VasanthOpening } from "@/lib/opening";
import { extractResumeDocument } from "@/lib/pdf-extraction";
import { ResumeDocumentSchema, type ResumeDocument } from "@/lib/resume-document";

const TRACK_OPTIONS = [
  "frontend React",
  "backend Java",
  "full-stack",
  "data structures and algorithms",
  "system design",
  "DevOps",
];
const RESUME_ROUNDS: ReadonlyArray<{ value: ResumeRound; label: string }> = [
  { value: "round_1", label: "Round 1 — Project & Experience Deep Dive" },
  { value: "round_2", label: "Round 2 — Impact & Quantification" },
  { value: "round_3", label: "Round 3 — Resume Defense & Cross-Examination" },
];
const SHOW_DEV_DEBUG = process.env.NEXT_PUBLIC_DEV_DEBUG === "true";
type InterviewMode = InterviewRequest["type"];

export function InterviewSetup() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<InterviewMode>("mock_interview");
  const [name, setName] = useState(SHOW_DEV_DEBUG ? DEV_NAME : "");
  const [interviewTrack, setInterviewTrack] = useState(
    SHOW_DEV_DEBUG ? DEV_INTERVIEW_TRACK : "frontend React",
  );
  const [resumeRound, setResumeRound] = useState<ResumeRound | "">("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeDocument, setResumeDocument] = useState<ResumeDocument | null>(
    SHOW_DEV_DEBUG ? DEV_RESUME_DOCUMENT : null,
  );
  const [resumeMarkdown, setResumeMarkdown] = useState<string | null>(
    SHOW_DEV_DEBUG ? DEV_RESUME_MARKDOWN : null,
  );
  const [parsedOpening, setParsedOpening] = useState<VasanthOpening | null>(
    SHOW_DEV_DEBUG ? DEV_OPENING : null,
  );
  const [isParsing, setIsParsing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!SHOW_DEV_DEBUG) return;
    let cancelled = false;
    loadDevResumeFile()
      .then((file) => {
        if (!cancelled) setResumeFile(file);
      })
      .catch((caught) => {
        console.error("[IO:dev-resume] failed", caught);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isResumeMastery = mode === "resume_mastery";
  const isParsed = isResumeMastery ? resumeDocument !== null : parsedOpening !== null;

  function clearParsedResume() {
    setResumeDocument(null);
    setResumeMarkdown(null);
    setParsedOpening(null);
  }

  function clearFile() {
    setResumeFile(null);
    clearParsedResume();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleModeChange(nextMode: InterviewMode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    setResumeRound("");
    clearFile();
    setError(null);
    if (SHOW_DEV_DEBUG) {
      setResumeMarkdown(DEV_RESUME_MARKDOWN);
      setParsedOpening(DEV_OPENING);
      setResumeDocument(DEV_RESUME_DOCUMENT);
      loadDevResumeFile()
        .then(setResumeFile)
        .catch((caught) => console.error("[IO:dev-resume] failed", caught));
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setResumeFile(event.target.files?.[0] ?? null);
    clearParsedResume();
    setError(null);
  }

  function buildResumeInterview() {
    return ResumeInterviewRequestSchema.parse({
      type: "resume_mastery",
      version: "v1",
      round: resumeRound,
      config: { max_follow_ups: 3 },
    });
  }

  async function handleParse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isParsing) return;
    if (!name.trim()) return setError("Enter your name before parsing the resume.");
    if (!resumeFile) {
      return setError(isResumeMastery ? "Choose a PDF resume." : "Choose a resume file.");
    }
    if (isResumeMastery && !resumeRound) {
      return setError("Select a Resume Mastery round.");
    }

    setIsParsing(true);
    setError(null);
    try {
      if (isResumeMastery) {
        const interview = buildResumeInterview();
        const extractionStartedAt = Date.now();
        console.info(`[IO:resume-pdf] started bytes=${resumeFile.size}`);
        let document: ResumeDocument;
        try {
          document = await extractResumeDocument(resumeFile);
          console.info(
            `[IO:resume-pdf] completed pages=${document.page_count} anchors=${document.anchor_count} elapsed_ms=${Date.now() - extractionStartedAt}`,
          );
        } catch (extractionError) {
          console.error(
            `[IO:resume-pdf] failed elapsed_ms=${Date.now() - extractionStartedAt} error_type=${extractionError instanceof Error ? extractionError.name : "UnknownError"}`,
          );
          throw extractionError;
        }
        const response = await fetch("/api/parse-resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interview, document }),
        });
        if (!response.ok) throw new Error(await responseError(response));
        const payload = await response.json();
        setResumeDocument(ResumeDocumentSchema.parse(payload.document));
      } else {
        const formData = new FormData();
        formData.append("file", resumeFile);
        formData.append("name", name.trim());
        formData.append("interview_track", interviewTrack);
        const response = await fetch("/api/parse-resume", { method: "POST", body: formData });
        if (!response.ok) throw new Error(await responseError(response));
        const payload = await response.json();
        setParsedOpening(payload.opening);
        setResumeMarkdown(payload.markdown ?? null);
      }
    } catch (caught) {
      console.error(caught);
      setError(caught instanceof Error ? caught.message : "Could not parse resume. Please try again.");
    } finally {
      setIsParsing(false);
    }
  }

  async function handleStartInterview() {
    if (isStarting) return;
    if (!name.trim()) return setError("Enter your name before starting the interview.");
    if (isResumeMastery && !resumeRound) return setError("Select a Resume Mastery round.");
    if (isResumeMastery && (!resumeFile || !resumeDocument)) {
      return setError("Parse the PDF resume before starting.");
    }
    if (!isResumeMastery && !parsedOpening) {
      return setError("Parse the resume before starting.");
    }

    setIsStarting(true);
    setError(null);
    try {
      let details;
      if (isResumeMastery) {
        const file = resumeFile;
        const document = resumeDocument;
        if (!file || !document) throw new Error("Parse the PDF resume before starting.");
        const interview = buildResumeInterview();
        const request = ResumeSessionRequestSchema.parse({ name: name.trim(), interview });
        const formData = new FormData();
        formData.append("request", JSON.stringify(request));
        formData.append("document", JSON.stringify(document));
        formData.append("file", file);
        const response = await fetch("/api/resume-sessions", { method: "POST", body: formData });
        if (!response.ok) throw new Error(await responseError(response));
        details = ResumeConnectionDetailsSchema.parse(await response.json());
      } else {
        const response = await fetch("/api/connection-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            opening: parsedOpening,
            markdown: resumeMarkdown,
          }),
        });
        if (!response.ok) throw new Error(await responseError(response));
        details = BaseConnectionDetailsSchema.parse(await response.json());
      }
      sessionStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(details));
      router.push("/session");
    } catch (caught) {
      console.error(caught);
      setError(caught instanceof Error ? caught.message : "Could not start the interview. Please try again.");
      setIsStarting(false);
    }
  }

  return (
    <div className="my-auto w-full max-w-2xl rounded-xl bg-card p-5 shadow-[var(--shadow-border)] sm:p-8">
      <h1 className="text-balance text-2xl font-semibold text-foreground">
        {isResumeMastery ? "Resume Mastery Interview" : "Mock Technical Interview"}
      </h1>
      <p className="mt-2 text-pretty text-sm text-muted-foreground">
        {isResumeMastery
          ? "Choose one focused round and prepare to defend the claims in your resume."
          : "Upload your resume and the interviewer will adapt to your background."}
      </p>

      <form onSubmit={handleParse} className="mt-6 space-y-5">
        <fieldset>
          <legend className="mb-1.5 text-sm text-secondary-foreground">Interview type</legend>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" aria-pressed={!isResumeMastery} variant={isResumeMastery ? "outline" : "default"} onClick={() => handleModeChange("mock_interview")}>
              Mock Interview
            </Button>
            <Button type="button" aria-pressed={isResumeMastery} variant={isResumeMastery ? "default" : "outline"} onClick={() => handleModeChange("resume_mastery")}>
              Resume Mastery
            </Button>
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-1.5 block text-sm text-secondary-foreground">Your name</span>
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Priya" autoFocus maxLength={60} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-2 focus:ring-ring/15" />
        </label>

        {isResumeMastery ? (
          <label className="block">
            <span className="mb-1.5 block text-sm text-secondary-foreground">Resume Mastery round</span>
            <div className="relative">
              <select value={resumeRound} onChange={(event) => { setResumeRound(event.target.value as ResumeRound); clearParsedResume(); setError(null); }} className="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-8 text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/15">
                <option value="">Select one round</option>
                {RESUME_ROUNDS.map((round) => <option key={round.value} value={round.value}>{round.label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1.5 block text-sm text-secondary-foreground">Interview track</span>
            <div className="relative">
              <select value={interviewTrack} onChange={(event) => setInterviewTrack(event.target.value)} className="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-8 text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/15">
                {TRACK_OPTIONS.map((track) => <option key={track} value={track}>{track}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </label>
        )}

        <label className="block">
          <span className="mb-1.5 block text-sm text-secondary-foreground">Resume</span>
          <div role="button" tabIndex={0} onClick={() => fileInputRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInputRef.current?.click(); } }} className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-input px-4 py-4 text-left transition-colors hover:border-primary/45 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {resumeFile ? <><FileText className="size-5 shrink-0 text-primary" /><div className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{resumeFile.name}</span><span className="block text-xs text-muted-foreground">{(resumeFile.size / 1024).toFixed(0)} KB</span></div></> : <><Upload className="size-5 shrink-0 text-muted-foreground" /><div><span className="block text-sm font-medium text-foreground">Choose a resume file</span><span className="block text-xs text-muted-foreground">{isResumeMastery ? "PDF only" : "PDF, TXT, or Markdown"}</span></div></>}
          </div>
          <input ref={fileInputRef} type="file" accept={isResumeMastery ? ".pdf,application/pdf" : ".pdf,.txt,.md"} onChange={handleFileChange} className="hidden" />
        </label>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!isParsed ? (
          <Button type="submit" size="lg" disabled={isParsing} className="w-full">
            {isParsing ? <><Loader2 className="size-4 animate-spin" />Analyzing resume…</> : "Parse resume"}
          </Button>
        ) : (
          <Button type="button" size="lg" onClick={handleStartInterview} disabled={isStarting} className="w-full">
            {isStarting ? <><Loader2 className="size-4 animate-spin" />Setting up your interview…</> : "Start interview"}
          </Button>
        )}
      </form>

      {isResumeMastery && resumeDocument && <p className="mt-4 text-sm text-muted-foreground">Resume ready. The PDF will remain visible during this round.</p>}
      {SHOW_DEV_DEBUG && !isResumeMastery && parsedOpening && <MockInterviewPreview opening={parsedOpening} markdown={resumeMarkdown} onReset={clearFile} />}
      {SHOW_DEV_DEBUG && isResumeMastery && resumeDocument && (
        <ResumeMasteryPreview
          document={resumeDocument}
          round={resumeRound}
          onReset={clearFile}
        />
      )}
      <p className="mt-4 text-xs text-muted-foreground">Your microphone and camera will be enabled when the session starts.</p>
    </div>
  );
}

function MockInterviewPreview({ opening, markdown, onReset }: { opening: VasanthOpening; markdown: string | null; onReset: () => void }) {
  return (
    <div className="mt-6 space-y-4 rounded-xl border border-border bg-background/50 p-4 sm:p-5">
      <h2 className="text-sm font-medium text-secondary-foreground">Interview plan preview</h2>
      <div className="space-y-3">
        <div className="rounded-lg bg-primary/5 p-3"><span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Opening question</span><p className="text-sm text-foreground">{opening.opening.question}</p></div>
        {opening.follow_up_plans.map((plan, index) => <div key={index} className="rounded-lg bg-secondary/30 p-3"><span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Follow-up {index + 1}</span><p className="text-sm text-foreground">{plan.question}</p><p className="mt-1 text-xs text-muted-foreground">Ask if: {plan.ask_if[0]}</p></div>)}
        <div className="rounded-lg bg-secondary/30 p-3"><span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Transition</span><p className="text-xs text-muted-foreground">{opening.transition_to_technical}</p></div>
      </div>
      {markdown && <details className="group rounded-lg bg-secondary/30 p-3"><summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">Parsed resume</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{markdown}</pre></details>}
      <Button type="button" variant="link" size="xs" onClick={onReset}>Parse a different resume</Button>
    </div>
  );
}

function ResumeMasteryPreview({
  document,
  round,
  onReset,
}: {
  document: ResumeDocument;
  round: ResumeRound | "";
  onReset: () => void;
}) {
  const sectionCounts = new Map<string, number>();
  const kindCounts = new Map<string, number>();
  for (const claim of document.claims) {
    sectionCounts.set(claim.section, (sectionCounts.get(claim.section) ?? 0) + 1);
    kindCounts.set(claim.kind, (kindCounts.get(claim.kind) ?? 0) + 1);
  }
  return (
    <div className="mt-6 space-y-4 rounded-xl border border-border bg-background/50 p-4 sm:p-5">
      <h2 className="text-sm font-medium text-secondary-foreground">Resume mastery preview</h2>
      <div className="space-y-3">
        <div className="rounded-lg bg-primary/5 p-3">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Round</span>
          <p className="text-sm text-foreground">
            {round ? RESUME_ROUNDS.find((entry) => entry.value === round)?.label ?? round : "No round selected"}
          </p>
        </div>
        <div className="rounded-lg bg-secondary/30 p-3">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Claims</span>
          <p className="text-sm text-foreground">{document.claim_count} classified claims across {sectionCounts.size} sections</p>
        </div>
        <div className="rounded-lg bg-secondary/30 p-3">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Sections</span>
          <ul className="mt-1 space-y-1">
            {[...sectionCounts.entries()].map(([section, count]) => (
              <li key={section} className="flex items-baseline justify-between gap-3 text-sm text-foreground">
                <span>{section}</span>
                <span className="text-xs text-muted-foreground">{count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg bg-secondary/30 p-3">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Claim kinds</span>
          <ul className="mt-1 space-y-1">
            {[...kindCounts.entries()].map(([kind, count]) => (
              <li key={kind} className="flex items-baseline justify-between gap-3 text-sm text-foreground">
                <span>{kind}</span>
                <span className="text-xs text-muted-foreground">{count}</span>
              </li>
            ))}
          </ul>
        </div>
        <details className="group rounded-lg bg-secondary/30 p-3">
          <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">Sample claims</summary>
          <ul className="mt-2 space-y-2">
            {document.claims.slice(0, 3).map((claim) => (
              <li key={claim.id} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{claim.section}</span>
                {" — "}
                {claim.text}
              </li>
            ))}
          </ul>
        </details>
      </div>
      <Button type="button" variant="link" size="xs" onClick={onReset}>Parse a different resume</Button>
    </div>
  );
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : `Request failed with status ${response.status}`;
}
