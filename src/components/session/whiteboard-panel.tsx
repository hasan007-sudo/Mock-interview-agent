"use client";

import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { toast } from "sonner";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  {
    ssr: false,
    loading: () => (
      <p className="p-4 text-sm text-muted-foreground">Loading whiteboard…</p>
    ),
  },
);

export function WhiteboardPanel({
  question,
  onContentChange,
  onClose,
}: {
  question: string;
  onContentChange: () => void;
  onClose: () => void;
}) {
  const [excalidrawApi, setExcalidrawApi] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const sceneVersionRef = useRef<string | null>(null);

  function handleDone() {
    if (!excalidrawApi) return;

    const elements = excalidrawApi.getSceneElements();
    if (elements.length === 0) {
      toast.warning("Draw something on the whiteboard first.");
      return;
    }

    toast.success("Whiteboard ready. Walk through your approach aloud.");
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border)]">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Whiteboard question
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

      <div className="relative min-h-0 flex-1">
        <Excalidraw
          theme="dark"
          excalidrawAPI={setExcalidrawApi}
          onChange={(elements) => {
            const sceneVersion = elements
              .map((element) => `${element.id}:${element.version}`)
              .join(",");
            if (sceneVersionRef.current === null) {
              sceneVersionRef.current = sceneVersion;
              return;
            }
            if (sceneVersionRef.current !== sceneVersion) {
              sceneVersionRef.current = sceneVersion;
              onContentChange();
            }
          }}
        />
      </div>

      <div className="space-y-3 border-t border-border px-4 py-3">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleDone}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-[background-color,scale] hover:bg-violet-200 active:scale-[0.96]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
