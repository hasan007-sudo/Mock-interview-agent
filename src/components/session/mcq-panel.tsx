"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { SupportedLanguage } from "@/lib/events";

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  java: "Java",
  javascript: "JavaScript",
  python: "Python",
};

export function McqPanel({
  question,
  options,
  code,
  language,
  onSubmit,
  onClose,
}: {
  question: string;
  options: string[];
  code?: string;
  language?: SupportedLanguage;
  onSubmit: (answer: {
    optionIndex: number;
    optionText: string;
  }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  async function handleSubmit() {
    if (selectedIndex === null || isSubmitting || isSubmitted) return;
    setIsSubmitting(true);
    try {
      const submitted = await onSubmit({
        optionIndex: selectedIndex,
        optionText: options[selectedIndex],
      });
      if (submitted) {
        setIsSubmitted(true);
        toast.success("Answer submitted.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border)]">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Multiple-choice question
          </h2>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            {question}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {code && (
          <div className="overflow-hidden rounded-lg border border-border bg-background/65">
            <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              {language ? LANGUAGE_LABELS[language] : "Code"}
            </div>
            <pre className="overflow-auto whitespace-pre p-3 font-mono text-sm leading-6 text-foreground">
              {code}
            </pre>
          </div>
        )}

        <div role="radiogroup" aria-label="Answer options" className="space-y-2">
          {options.map((option, index) => {
            const selected = selectedIndex === index;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={isSubmitted}
                onClick={() => setSelectedIndex(index)}
                className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:cursor-default ${
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background/45 text-secondary-foreground hover:bg-accent"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input text-muted-foreground"
                  }`}
                >
                  {String.fromCharCode(65 + index)}
                </span>
                <span>{option}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {isSubmitted
            ? "Your selection has been submitted."
            : "Select one option, then submit your answer."}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={selectedIndex === null || isSubmitting || isSubmitted}
          onClick={handleSubmit}
        >
          {isSubmitting
            ? "Submitting…"
            : isSubmitted
              ? "Submitted"
              : "Submit answer"}
        </Button>
      </div>
    </div>
  );
}
