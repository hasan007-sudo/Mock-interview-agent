"use client";

import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import dynamic from "next/dynamic";
import { ParticipantKind, RpcError, type Room } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const WHITEBOARD_RPC_METHOD = "workspace.whiteboard";
const PUBLISH_ON_BEHALF_ATTRIBUTE = "lk.publish_on_behalf";

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

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
  room,
  question,
  locked,
  status,
  onContentChange,
  onSubmit,
  onClose,
}: {
  room: Room;
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

  useEffect(() => {
    room.registerRpcMethod(WHITEBOARD_RPC_METHOD, async (invocation) => {
      const caller = room.remoteParticipants.get(invocation.callerIdentity);
      if (
        caller?.kind !== ParticipantKind.AGENT ||
        caller.attributes[PUBLISH_ON_BEHALF_ATTRIBUTE]
      ) {
        throw new RpcError(2001, "Only the session agent may highlight the whiteboard");
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
        throw new RpcError(2002, "Invalid whiteboard command");
      }

      const componentLabel = request.payload?.componentLabel;
      if (
        request.action !== "highlight_component" ||
        typeof componentLabel !== "string" ||
        !componentLabel.trim() ||
        !excalidrawApi
      ) {
        throw new RpcError(2002, "Whiteboard is not ready");
      }

      const requestedLabel = normalizeLabel(componentLabel);
      const elements = excalidrawApi.getSceneElements();
      const textElement = elements.find((element) => {
        if (element.type !== "text") return false;
        const visibleLabel = normalizeLabel(element.originalText || element.text);
        return (
          visibleLabel === requestedLabel ||
          visibleLabel.includes(requestedLabel) ||
          requestedLabel.includes(visibleLabel)
        );
      });
      if (!textElement || textElement.type !== "text") {
        throw new RpcError(2002, "Whiteboard component label was not found");
      }

      const selectedIds: Record<string, true> = { [textElement.id]: true };
      if (textElement.containerId) selectedIds[textElement.containerId] = true;
      const selectedElements = elements.filter((element) => selectedIds[element.id]);
      excalidrawApi.updateScene({
        appState: { selectedElementIds: selectedIds },
      });
      excalidrawApi.scrollToContent(selectedElements, {
        animate: true,
        fitToContent: true,
      });
      return JSON.stringify({ ok: true, componentLabel: textElement.text });
    });

    return () => {
      room.unregisterRpcMethod(WHITEBOARD_RPC_METHOD);
    };
  }, [excalidrawApi, room]);

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
