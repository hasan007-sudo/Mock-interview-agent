"use client";

import type { ReactNode } from "react";
import { ResumePanel } from "@/components/session/resume-panel";
import type { ResumeConnectionDetails } from "@/lib/connection";
import type { ResumeRound } from "@/lib/interviews";

const RESUME_ROUND_LABELS: Record<ResumeRound, string> = {
  round_1: "Round 1",
  round_2: "Round 2",
  round_3: "Round 3",
};

export function resumeRoundLabel(round: ResumeRound) {
  return RESUME_ROUND_LABELS[round];
}

export function ResumeSessionLayout({
  connection,
  agentIdentity,
  children,
}: {
  connection: ResumeConnectionDetails;
  agentIdentity: string | null;
  children: ReactNode;
}) {
  return (
    <div className="dark h-dvh overflow-x-auto overflow-y-hidden bg-background text-foreground">
      <div className="flex h-full min-w-[56rem]">
        <aside className="h-full w-1/2 min-w-[22rem] shrink-0 border-r border-border p-3 sm:p-4">
          <ResumePanel
            pdfUrl={connection.resume.pdfUrl}
            documentUrl={connection.resume.documentUrl}
            pdfSha256={connection.resume.pdfSha256}
            agentIdentity={agentIdentity}
          />
        </aside>
        <div className="h-full w-1/2 min-w-[22rem] flex-1">{children}</div>
      </div>
    </div>
  );
}
