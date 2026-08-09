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
  locked,
  status,
  onContentChange,
  onSubmit,
  onClose,
}: {
  question: string;
  locked: boolean;
  status: "idle" | "uploading" | "received" | "analyzing" | "ready" | "error";
  onContentChange: () => void;
  onSubmit: (submission: {
    blob: Blob;
    imageSha256: string;
  }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [excalidrawApi, setExcalidrawApi] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const sceneVersionRef = useRef<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  async function handleDone() {
    if (!excalidrawApi || locked || isExporting) return;

    const elements = excalidrawApi.getSceneElements();
    if (elements.length === 0) {
      toast.warning("Draw something on the whiteboard first.");
      return;
    }

    setIsExporting(true);
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob = await exportToBlob({
        elements,
        appState: {
          ...excalidrawApi.getAppState(),
          exportBackground: true,
          exportEmbedScene: false,
          exportWithDarkMode: false,
          viewBackgroundColor: "#ffffff",
        },
        files: excalidrawApi.getFiles(),
        maxWidthOrHeight: 2048,
        mimeType: "image/png",
      });
      if (blob.size > 4 * 1024 * 1024) {
        toast.error("The whiteboard image is over 4 MB. Simplify it and try again.");
        return;
      }
      const imageSha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
      )
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      await onSubmit({ blob, imageSha256 });
    } catch (error) {
      console.error("Failed to export whiteboard:", error);
      toast.error("Could not prepare the whiteboard image. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }

  const statusText = {
    idle: "",
    uploading: "Uploading…",
    received: "Drawing received",
    analyzing: "Analyzing…",
    ready: "Ready",
    error: "Submission failed",
  }[status];

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
          viewModeEnabled={locked}
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
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {statusText}
          </span>
          <button
            type="button"
            onClick={() => void handleDone()}
            disabled={locked || isExporting || status === "uploading"}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-[background-color,scale] hover:bg-violet-200 active:scale-[0.96]"
          >
            {locked ? "Submitted" : isExporting ? "Preparing…" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
