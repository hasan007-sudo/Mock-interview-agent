"use client";

import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import {
  type Evaluation,
  EvaluationResult,
} from "@/components/session/evaluation-result";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  {
    ssr: false,
    loading: () => (
      <p className="p-4 text-sm text-neutral-500">Loading whiteboard…</p>
    ),
  },
);

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function WhiteboardPanel({
  question,
  onClose,
}: {
  question: string;
  onClose: () => void;
}) {
  const [excalidrawApi, setExcalidrawApi] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);

  async function handleSubmit() {
    if (!excalidrawApi || isEvaluating) return;

    const elements = excalidrawApi.getSceneElements();
    if (elements.length === 0) {
      toast.warning("Draw something on the whiteboard first.");
      return;
    }

    setIsEvaluating(true);
    setEvaluation(null);
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob = await exportToBlob({
        elements,
        appState: { exportBackground: true, exportWithDarkMode: false },
        files: excalidrawApi.getFiles(),
        mimeType: "image/png",
      });
      const imageDataUrl = await blobToDataUrl(blob);
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface: "whiteboard", question, imageDataUrl }),
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
            Whiteboard question
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

      <div className="relative min-h-0 flex-1">
        <Excalidraw excalidrawAPI={setExcalidrawApi} />
      </div>

      <div className="space-y-3 border-t border-neutral-800 px-4 py-3">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isEvaluating}
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
