"use client";

export type Evaluation = {
  score: number;
  verdict: "strong" | "acceptable" | "needs_improvement";
  feedback: string;
  improvements: string[];
};

const VERDICT_STYLES: Record<Evaluation["verdict"], string> = {
  strong: "bg-green-950 text-green-300 border-green-900",
  acceptable: "bg-yellow-950 text-yellow-300 border-yellow-900",
  needs_improvement: "bg-red-950 text-red-300 border-red-900",
};

const VERDICT_LABELS: Record<Evaluation["verdict"], string> = {
  strong: "Strong",
  acceptable: "Acceptable",
  needs_improvement: "Needs improvement",
};

export function EvaluationResult({ evaluation }: { evaluation: Evaluation }) {
  return (
    <div className="rounded-lg bg-background/65 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex items-center gap-3">
        <span className="text-lg font-semibold">{evaluation.score}/10</span>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${VERDICT_STYLES[evaluation.verdict]}`}
        >
          {VERDICT_LABELS[evaluation.verdict]}
        </span>
      </div>
      <p className="mt-3 text-pretty text-sm text-secondary-foreground">{evaluation.feedback}</p>
      {evaluation.improvements.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {evaluation.improvements.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
