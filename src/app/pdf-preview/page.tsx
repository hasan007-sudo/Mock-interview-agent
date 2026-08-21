"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Highlight,
  PdfHighlighter,
  PdfLoader,
  type IHighlight,
} from "react-pdf-highlighter";
import "react-pdf-highlighter/dist/style.css";
import { DEV_RESUME_DOCUMENT, DEV_RESUME_PDF_URL } from "@/lib/dev-fixtures";
import { PDFJS_WORKER_SRC } from "@/lib/pdf-extraction";
import {
  buildClaimHighlight,
  scrollToHighlightInViewer,
} from "@/components/session/resume-panel";
import { Button } from "@/components/ui/button";

const EMPTY_HIGHLIGHTS: IHighlight[] = [];
const disableAreaSelection = () => false;
const noopScrollChange = () => undefined;
const noopSelectionFinished = () => null;

type RpcLogEntry = {
  id: string;
  time: string;
  type: "info" | "success" | "warning";
  action: string;
  details: unknown;
};

export default function PdfPreviewPage() {
  const [pdfUrl] = useState(DEV_RESUME_PDF_URL);
  const [activeHighlight, setActiveHighlight] = useState<IHighlight | null>(null);
  const [selectedClaimId, setSelectedClaimId] = useState<string>("claim-0001");
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [rpcLogs, setRpcLogs] = useState<RpcLogEntry[]>([]);

  // Manual coordinate inputs
  const [manualPage, setManualPage] = useState(1);
  const [manualX1, setManualX1] = useState(0.08);
  const [manualY1, setManualY1] = useState(0.12);
  const [manualX2, setManualX2] = useState(0.92);
  const [manualY2, setManualY2] = useState(0.18);

  const scrollToHighlightRef = useRef<((highlight: IHighlight) => void) | null>(null);

  const addLog = useCallback((type: RpcLogEntry["type"], action: string, details: unknown) => {
    const time = new Date().toLocaleTimeString();
    setRpcLogs((prev) => [
      { id: `${Date.now()}-${Math.random()}`, time, type, action, details },
      ...prev.slice(0, 49),
    ]);
  }, []);

  const highlights = useMemo(
    () => (activeHighlight ? [activeHighlight] : EMPTY_HIGHLIGHTS),
    [activeHighlight],
  );

  const handleScrollRef = useCallback((scrollTo: (highlight: IHighlight) => void) => {
    scrollToHighlightRef.current = scrollTo;
    setIsViewerReady(true);
    addLog("success", "scrollRef_attached", "PdfHighlighter scrollRef attached");
  }, [addLog]);

  const handleViewerReady = useCallback(() => {
    setIsViewerReady(true);
    addLog("success", "pdf_ready", { pages: DEV_RESUME_DOCUMENT.page_count });
  }, [addLog]);

  const highlightTransform = useCallback<
    React.ComponentProps<typeof PdfHighlighter<IHighlight>>["highlightTransform"]
  >(
    (
      highlight,
      _index,
      _setTip,
      _hideTip,
      _viewportToScaled,
      _screenshot,
      isScrolledTo,
    ) => (
      <Highlight
        position={highlight.position}
        comment={highlight.comment}
        isScrolledTo={isScrolledTo}
      />
    ),
    [],
  );

  const applyHighlight = useCallback((highlight: IHighlight) => {
    setActiveHighlight(highlight);
    requestAnimationFrame(() => {
      scrollToHighlightInViewer(highlight, scrollToHighlightRef.current);
    });
  }, []);

  const handleSelectClaim = useCallback((claimId: string) => {
    setSelectedClaimId(claimId);
    const highlight = buildClaimHighlight(DEV_RESUME_DOCUMENT, claimId);
    if (!highlight) {
      addLog("warning", "highlight_claim_failed", { claimId, reason: "not_found" });
      return;
    }
    applyHighlight(highlight);
    addLog("success", "highlight_claim", {
      claimId,
      page: highlight.position.pageNumber,
      boundingRect: highlight.position.boundingRect,
      rectCount: highlight.position.rects.length,
    });
  }, [addLog, applyHighlight]);

  const handleManualHighlight = useCallback(() => {
    const customHighlight: IHighlight = {
      id: `custom-${Date.now()}`,
      position: {
        pageNumber: manualPage,
        boundingRect: {
          pageNumber: manualPage,
          x1: manualX1,
          y1: manualY1,
          x2: manualX2,
          y2: manualY2,
          width: 1,
          height: 1,
        },
        rects: [
          {
            pageNumber: manualPage,
            x1: manualX1,
            y1: manualY1,
            x2: manualX2,
            y2: manualY2,
            width: 1,
            height: 1,
          },
        ],
      },
      content: {},
      comment: { text: "Manual highlight test", emoji: "📌" },
    };
    applyHighlight(customHighlight);
    addLog("info", "manual_highlight", {
      page: manualPage,
      coords: { x1: manualX1, y1: manualY1, x2: manualX2, y2: manualY2 },
    });
  }, [addLog, applyHighlight, manualPage, manualX1, manualX2, manualY1, manualY2]);

  const handleSimulateGetStatusRpc = useCallback(() => {
    const payload = {
      schema_version: "resume_rpc.v1",
      ok: true,
      status: isViewerReady ? "ready" : "loading",
      page_count: DEV_RESUME_DOCUMENT.page_count,
      anchor_count: DEV_RESUME_DOCUMENT.anchor_count,
      claim_count: DEV_RESUME_DOCUMENT.claim_count,
    };
    addLog("info", "RPC:get_status", payload);
  }, [addLog, isViewerReady]);

  const handleSimulateHighlightRpc = useCallback(() => {
    const highlight = buildClaimHighlight(DEV_RESUME_DOCUMENT, selectedClaimId);
    if (!highlight) {
      addLog("warning", "RPC:highlight_claim", {
        schema_version: "resume_rpc.v1",
        ok: true,
        status: "not_found",
        claim_id: selectedClaimId,
      });
      return;
    }
    applyHighlight(highlight);
    const response = {
      schema_version: "resume_rpc.v1",
      ok: true,
      status: "highlighted",
      claim_id: highlight.id,
      page: highlight.position.pageNumber,
    };
    addLog("success", "RPC:highlight_claim", response);
  }, [addLog, applyHighlight, selectedClaimId]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Left Column: PDF Viewer (50%) */}
      <div className="flex w-1/2 flex-col border-r border-neutral-800">
        <header className="flex h-14 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-sm">PDF Preview & Highlight Tester</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                isViewerReady
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  : "bg-amber-950 text-amber-300 border border-amber-800"
              }`}
            >
              {isViewerReady ? "● Viewer Ready" : "○ Initializing"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActiveHighlight(null)}
              className="text-xs"
            >
              Clear Highlight
            </Button>
          </div>
        </header>

        <div className="relative flex-1 overflow-hidden bg-neutral-900">
          <PdfLoader
            url={pdfUrl}
            workerSrc={PDFJS_WORKER_SRC}
            beforeLoad={
              <div className="flex h-full items-center justify-center text-sm text-neutral-400">
                Loading PDF…
              </div>
            }
            errorMessage={
              <div className="flex h-full items-center justify-center text-sm text-red-400">
                Failed to load PDF.
              </div>
            }
          >
            {(pdfDocument) => (
              <PdfViewerPreviewInner
                pdfDocument={pdfDocument}
                highlights={highlights}
                scrollRef={handleScrollRef}
                highlightTransform={highlightTransform}
                onViewerReady={handleViewerReady}
              />
            )}
          </PdfLoader>
        </div>
      </div>

      {/* Right Column: Controls, Claims, Coordinates & RPC Inspector (50%) */}
      <div className="flex w-1/2 flex-col overflow-hidden bg-neutral-900">
        <div className="border-b border-neutral-800 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">
            LiveKit RPC Simulation
          </h2>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSimulateGetStatusRpc}
              className="flex-1 text-xs"
            >
              Test get_status RPC
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={handleSimulateHighlightRpc}
              className="flex-1 text-xs"
            >
              Test highlight_claim RPC
            </Button>
          </div>
        </div>

        <div className="border-b border-neutral-800 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">
            Manual (X, Y) Coordinates
          </h2>
          <div className="mt-3 grid grid-cols-5 gap-2 text-xs">
            <div>
              <label className="block text-neutral-400">Page</label>
              <input
                type="number"
                min={1}
                max={5}
                value={manualPage}
                onChange={(e) => setManualPage(Number(e.target.value))}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-white"
              />
            </div>
            <div>
              <label className="block text-neutral-400">X1 (0-1)</label>
              <input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={manualX1}
                onChange={(e) => setManualX1(Number(e.target.value))}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-white"
              />
            </div>
            <div>
              <label className="block text-neutral-400">Y1 (0-1)</label>
              <input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={manualY1}
                onChange={(e) => setManualY1(Number(e.target.value))}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-white"
              />
            </div>
            <div>
              <label className="block text-neutral-400">X2 (0-1)</label>
              <input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={manualX2}
                onChange={(e) => setManualX2(Number(e.target.value))}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-white"
              />
            </div>
            <div>
              <label className="block text-neutral-400">Y2 (0-1)</label>
              <input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={manualY2}
                onChange={(e) => setManualY2(Number(e.target.value))}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-white"
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleManualHighlight}
            className="mt-3 w-full text-xs"
          >
            Highlight Custom Box
          </Button>
        </div>

        {/* Claims List */}
        <div className="flex-1 overflow-y-auto border-b border-neutral-800 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">
              Classified Resume Claims ({DEV_RESUME_DOCUMENT.claims.length})
            </h2>
          </div>
          <div className="mt-3 space-y-2">
            {DEV_RESUME_DOCUMENT.claims.map((claim) => {
              const isSelected = claim.id === selectedClaimId;
              const isHighlighted = activeHighlight?.id === claim.id;
              return (
                <div
                  key={claim.id}
                  onClick={() => handleSelectClaim(claim.id)}
                  className={`cursor-pointer rounded-lg border p-3 text-xs transition-colors ${
                    isHighlighted
                      ? "border-amber-500/80 bg-amber-500/10 text-amber-200"
                      : isSelected
                        ? "border-violet-500/60 bg-violet-500/10 text-white"
                        : "border-neutral-800 bg-neutral-950/60 text-neutral-300 hover:border-neutral-700"
                  }`}
                >
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="font-semibold text-violet-300">{claim.id}</span>
                    <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-400">
                      {claim.kind} · {claim.section}
                    </span>
                  </div>
                  <p className="mt-1 text-neutral-200">{claim.text}</p>
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-neutral-400 font-mono">
                    <span>Anchors: {claim.anchor_ids.join(", ")}</span>
                    <span>{isHighlighted ? "● Highlighted" : "Click to highlight"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RPC & Activity Log Inspector */}
        <div className="h-48 overflow-y-auto bg-black p-3 font-mono text-[11px]">
          <span className="text-[10px] uppercase text-neutral-400 tracking-wider block mb-1">
            RPC / Activity Logs
          </span>
          {rpcLogs.length === 0 ? (
            <p className="text-neutral-400 italic">No events yet. Click a claim or RPC test button above.</p>
          ) : (
            rpcLogs.map((log) => (
              <div key={log.id} className="mb-1 leading-tight">
                <span className="text-neutral-400">[{log.time}]</span>{" "}
                <span
                  className={
                    log.type === "success"
                      ? "text-emerald-400"
                      : log.type === "warning"
                        ? "text-amber-400"
                        : "text-sky-400"
                  }
                >
                  {log.action}
                </span>
                <pre className="text-neutral-400 whitespace-pre-wrap break-all text-[10px]">
                  {JSON.stringify(log.details, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PdfViewerPreviewInner({
  pdfDocument,
  highlights,
  scrollRef,
  highlightTransform,
  onViewerReady,
}: {
  pdfDocument: import("pdfjs-dist").PDFDocumentProxy;
  highlights: IHighlight[];
  scrollRef: (scrollTo: (highlight: IHighlight) => void) => void;
  highlightTransform: React.ComponentProps<
    typeof PdfHighlighter<IHighlight>
  >["highlightTransform"];
  onViewerReady: () => void;
}) {
  useEffect(() => {
    onViewerReady();
  }, [onViewerReady]);

  return (
    <PdfHighlighter
      pdfDocument={pdfDocument}
      pdfScaleValue="page-width"
      highlights={highlights}
      enableAreaSelection={disableAreaSelection}
      onScrollChange={noopScrollChange}
      onSelectionFinished={noopSelectionFinished}
      scrollRef={scrollRef}
      highlightTransform={highlightTransform}
    />
  );
}
