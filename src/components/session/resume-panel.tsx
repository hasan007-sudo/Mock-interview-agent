"use client";
import { useSessionContext } from "@livekit/components-react";
import { RpcError } from "livekit-client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Highlight,
  PdfHighlighter,
  PdfLoader,
  type IHighlight,
  type Scaled,
} from "react-pdf-highlighter";
import "react-pdf-highlighter/dist/style.css";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { PDFJS_WORKER_SRC } from "@/lib/pdf-extraction";
import {
  ResumeDocumentSchema,
  type PdfRectangle,
  type ResumeDocument,
} from "@/lib/resume-document";
const RESUME_RPC_METHOD = "workspace.resume";
const RESUME_RPC_SCHEMA_VERSION = "resume_rpc.v1";
const DocumentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ResumeRpcRequestSchema = z.discriminatedUnion("action", [
  z.object({
    schema_version: z.literal(RESUME_RPC_SCHEMA_VERSION),
    action: z.literal("get_status"),
    payload: z.object({ document_sha256: DocumentHashSchema }).strict(),
  }).strict(),
  z.object({
    schema_version: z.literal(RESUME_RPC_SCHEMA_VERSION),
    action: z.literal("highlight_claim"),
    payload: z.object({
      document_sha256: DocumentHashSchema,
      claim_id: z.string().min(1).max(256),
    }).strict(),
  }).strict(),
]);
type DocumentState =
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; document: ResumeDocument }
  | { status: "document_mismatch" | "error"; key: string };
type ViewerState = { status: "loading" | "ready" | "error"; key: string };
type RuntimeState = {
  agentIdentity: string | null;
  documentKey: string;
  viewerKey: string;
  pdfSha256: string;
  documentState: DocumentState;
};

function serializeResponse(response: Record<string, unknown>) {
  return JSON.stringify({
    schema_version: RESUME_RPC_SCHEMA_VERSION,
    ok: true,
    ...response,
  });
}
function documentCounts(document?: ResumeDocument) {
  return {
    page_count: document?.page_count ?? 0,
    anchor_count: document?.anchor_count ?? 0,
    claim_count: document?.claim_count ?? 0,
  };
}
export function normalizedRectangle({ page, x1, y1, x2, y2 }: PdfRectangle): Scaled {
  return { pageNumber: page, x1, y1, x2, y2, width: 1, height: 1 };
}

export function buildClaimHighlight(
  document: ResumeDocument,
  claimId: string,
): IHighlight | null {
  const claim = document.claims.find(({ id }) => id === claimId);
  if (!claim) return null;
  const anchorsById = new Map(
    document.anchors.map((anchor) => [anchor.id, anchor]),
  );
  const anchors = claim.anchor_ids
    .map((anchorId) => anchorsById.get(anchorId))
    .filter((anchor) => anchor !== undefined);
  const page = anchors[0]?.page;
  if (page === undefined) return null;
  const rects = anchors
    .filter((anchor) => anchor.page === page)
    .flatMap((anchor) =>
      anchor.rectangles
        .filter((rectangle) => rectangle.page === page)
        .map(normalizedRectangle),
    );
  if (rects.length === 0) return null;
  const boundingRect: Scaled = {
    pageNumber: page,
    x1: Math.min(...rects.map(({ x1 }) => x1)),
    y1: Math.min(...rects.map(({ y1 }) => y1)),
    x2: Math.max(...rects.map(({ x2 }) => x2)),
    y2: Math.max(...rects.map(({ y2 }) => y2)),
    width: 1,
    height: 1,
  };
  return {
    id: claim.id,
    position: { pageNumber: page, boundingRect, rects },
    content: {},
    comment: { text: "", emoji: "" },
  };
}

export function scrollToHighlightInViewer(
  highlight: IHighlight,
  scrollToFn?: ((h: IHighlight) => void) | null,
) {
  if (scrollToFn) {
    try {
      scrollToFn(highlight);
      return;
    } catch {
      // Fall through to container scroll if pdfjs internal scroll throws
    }
  }
  const pageNumber = highlight.position.pageNumber;
  const pageEl = (document.querySelector(`[data-page-number="${pageNumber}"]`) ||
    document.querySelectorAll(".page")?.[pageNumber - 1]) as HTMLElement | null;
  const container = (document.querySelector(".PdfHighlighter") ||
    pageEl?.closest(".PdfHighlighter") ||
    document.querySelector(".pdfViewer")?.parentElement) as HTMLElement | null;

  if (container && pageEl) {
    const highlightTopInPage =
      highlight.position.boundingRect.y1 * pageEl.clientHeight;
    const targetScrollTop = pageEl.offsetTop + highlightTopInPage - 40;
    container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: "smooth" });
  } else if (pageEl) {
    pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
function blockExternalPdfLink(event: MouseEvent<HTMLDivElement>) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a");
  if (anchor?.target !== "_blank") return;
  event.preventDefault();
  event.stopPropagation();
}
function PanelMessage({
  children,
  error = false,
}: { children: ReactNode; error?: boolean }) {
  return (
    <div
      className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground"
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
const EMPTY_HIGHLIGHTS: IHighlight[] = [];
const disableAreaSelection = () => false;
const noopScrollChange = () => undefined;
const noopSelectionFinished = () => null;

export type ResumePanelProps = {
  pdfUrl: string;
  documentUrl: string;
  pdfSha256: string;
  agentIdentity: string | null;
  className?: string;
};
export function ResumePanel({
  pdfUrl,
  documentUrl,
  pdfSha256,
  agentIdentity,
  className,
}: ResumePanelProps) {
  const session = useSessionContext();
  const localParticipant = session.room.localParticipant;
  const documentKey = `${documentUrl}\n${pdfSha256}`;
  const viewerKey = `${pdfUrl}\n${documentKey}`;
  const [documentState, setDocumentState] = useState<DocumentState>({
    status: "loading",
    key: documentKey,
  });
  const viewerStateRef = useRef<ViewerState>({
    status: "loading",
    key: viewerKey,
  });
  const [activeHighlight, setActiveHighlight] =
    useState<IHighlight | null>(null);
  const highlights = useMemo(
    () => (activeHighlight ? [activeHighlight] : EMPTY_HIGHLIGHTS),
    [activeHighlight],
  );
  const scrollToHighlightRef = useRef<((highlight: IHighlight) => void) | null>(
    null,
  );
  const runtimeRef = useRef<RuntimeState | null>(null);
  const pdfLoadStartedAtRef = useRef(0);
  const pdfLoadLoggedKeyRef = useRef<string | null>(null);

  const handleViewerReady = useCallback(() => {
    if (
      viewerStateRef.current.status !== "ready" ||
      viewerStateRef.current.key !== viewerKey
    ) {
      viewerStateRef.current = { status: "ready", key: viewerKey };
    }
    if (pdfLoadLoggedKeyRef.current !== viewerKey) {
      pdfLoadLoggedKeyRef.current = viewerKey;
      console.info(
        `[EXT-API:resume-pdf] status=completed elapsed_ms=${Math.round(performance.now() - pdfLoadStartedAtRef.current)}`,
      );
    }
  }, [viewerKey]);

  const handleScrollRef = useCallback(
    (scrollTo: (highlight: IHighlight) => void) => {
      scrollToHighlightRef.current = scrollTo;
    },
    [],
  );

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
  useEffect(() => {
    runtimeRef.current = {
      agentIdentity,
      documentKey,
      viewerKey,
      pdfSha256,
      documentState,
    };
  }, [
    agentIdentity,
    documentKey,
    documentState,
    pdfSha256,
    viewerKey,
  ]);
  useEffect(() => {
    const abortController = new AbortController();
    const startedAt = performance.now();
    scrollToHighlightRef.current = null;
    console.info("[EXT-API:resume-document] status=started");

    async function loadDocument() {
      try {
        const response = await fetch(documentUrl, {
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw Object.assign(new Error(), { name: "ResumeDocumentHttpError" });
        }
        const parsed = ResumeDocumentSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw Object.assign(new Error(), {
            name: "ResumeDocumentValidationError",
          });
        }
        if (parsed.data.pdf_sha256 !== pdfSha256) {
          setActiveHighlight(null);
          setDocumentState({ status: "document_mismatch", key: documentKey });
          console.error(
            `[EXT-API:resume-document] status=failed error_type=document_mismatch elapsed_ms=${Math.round(performance.now() - startedAt)}`,
          );
          return;
        }
        setActiveHighlight(null);
        setDocumentState({
          status: "ready",
          key: documentKey,
          document: parsed.data,
        });
        console.info(
          `[EXT-API:resume-document] status=completed elapsed_ms=${Math.round(performance.now() - startedAt)}`,
        );
      } catch (error) {
        if (abortController.signal.aborted) return;
        const errorType = error instanceof Error ? error.name : "UnknownError";
        setActiveHighlight(null);
        setDocumentState({ status: "error", key: documentKey });
        console.error(
          `[EXT-API:resume-document] status=failed error_type=${errorType} elapsed_ms=${Math.round(performance.now() - startedAt)}`,
        );
      }
    }
    void loadDocument();
    return () => abortController.abort();
  }, [documentKey, documentUrl, pdfSha256, viewerKey]);

  useEffect(() => {
    viewerStateRef.current = { status: "loading", key: viewerKey };
    pdfLoadStartedAtRef.current = performance.now();
    console.info("[EXT-API:resume-pdf] status=started");
  }, [viewerKey]);
  useEffect(() => {
    localParticipant.registerRpcMethod(RESUME_RPC_METHOD, async (invocation) => {
      const runtime = runtimeRef.current;
      const viewerState = viewerStateRef.current;
      if (!runtime || (runtime.agentIdentity && invocation.callerIdentity !== runtime.agentIdentity)) {
        throw new RpcError(2001, "Only the session agent may inspect the resume");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(invocation.payload);
      } catch {
        throw new RpcError(2002, "Invalid resume command");
      }
      const parsed = ResumeRpcRequestSchema.safeParse(payload);
      if (!parsed.success) {
        throw new RpcError(2002, "Invalid resume command");
      }
      const state = runtime.documentState;
      const matchingDocument =
        state.status === "ready" &&
        state.key === runtime.documentKey &&
        state.document.pdf_sha256 === runtime.pdfSha256
          ? state.document
          : undefined;
      const requestedHashMatches =
        parsed.data.payload.document_sha256 === runtime.pdfSha256;
      if (parsed.data.action === "get_status") {
        if (
          requestedHashMatches &&
          matchingDocument &&
          viewerState.status === "ready" &&
          viewerState.key === runtime.viewerKey
        ) {
          console.info("[EXT-API:resume-rpc] action=get_status status=ready");
          return serializeResponse({
            status: "ready",
            ...documentCounts(matchingDocument),
          });
        }
        const isMismatch =
          !requestedHashMatches ||
          state.status === "document_mismatch" ||
          state.status === "error";
        console.info(
          `[EXT-API:resume-rpc] action=get_status status=${isMismatch ? "document_mismatch" : "loading"} matching_doc=${Boolean(matchingDocument)} viewer_status=${viewerState.status}`,
        );
        return serializeResponse({
          status: isMismatch ? "document_mismatch" : "loading",
          ...documentCounts(matchingDocument),
        });
      }

      if (!requestedHashMatches) {
        console.warn("[EXT-API:resume-rpc] action=highlight_claim status=document_mismatch");
        return serializeResponse({ status: "document_mismatch" });
      }
      if (!matchingDocument) {
        const mismatch =
          state.status === "document_mismatch" || state.status === "error";
        console.warn(
          `[EXT-API:resume-rpc] action=highlight_claim status=${mismatch ? "document_mismatch" : "viewer_unavailable"}`,
        );
        return serializeResponse({
          status: mismatch ? "document_mismatch" : "viewer_unavailable",
        });
      }
      if (
        viewerState.status !== "ready" ||
        viewerState.key !== runtime.viewerKey
      ) {
        console.warn(
          `[EXT-API:resume-rpc] action=highlight_claim status=viewer_unavailable viewer_status=${viewerState.status}`,
        );
        return serializeResponse({ status: "viewer_unavailable" });
      }
      const highlight = buildClaimHighlight(
        matchingDocument,
        parsed.data.payload.claim_id,
      );
      if (!highlight) {
        console.warn(
          `[EXT-API:resume-rpc] action=highlight_claim status=not_found claim_id=${parsed.data.payload.claim_id}`,
        );
        return serializeResponse({
          status: "not_found",
          claim_id: parsed.data.payload.claim_id,
        });
      }
      setActiveHighlight(highlight);
      requestAnimationFrame(() => {
        scrollToHighlightInViewer(highlight, scrollToHighlightRef.current);
      });
      console.info(
        `[EXT-API:resume-rpc] action=highlight_claim status=highlighted claim_id=${highlight.id} page=${highlight.position.pageNumber}`,
      );
      return serializeResponse({
        status: "highlighted",
        claim_id: highlight.id,
        page: highlight.position.pageNumber,
      });
    });

    return () => {
      localParticipant.unregisterRpcMethod(RESUME_RPC_METHOD);
    };
  }, [localParticipant]);
  const hasDocumentError =
    documentState.key === documentKey &&
    (documentState.status === "error" ||
      documentState.status === "document_mismatch");

  return (
    <div
      className={cn(
        "relative flex size-full min-h-0 flex-col overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border)]",
        className,
      )}
      aria-label="Resume document"
    >
      {hasDocumentError ? (
        <PanelMessage error>The resume document is unavailable.</PanelMessage>
      ) : (
        <div
          className="relative min-h-0 flex-1 overflow-hidden bg-neutral-900"
          onClickCapture={blockExternalPdfLink}
          onAuxClickCapture={blockExternalPdfLink}
          onContextMenuCapture={blockExternalPdfLink}
        >
          <PdfLoader
            key={viewerKey}
            url={pdfUrl}
            workerSrc={PDFJS_WORKER_SRC}
            beforeLoad={<PanelMessage>Loading resume…</PanelMessage>}
            errorMessage={<PanelMessage error>The resume PDF is unavailable.</PanelMessage>}
            onError={(error) => {
              const errorType =
                error instanceof Error ? error.name : "UnknownError";
              viewerStateRef.current = { status: "error", key: viewerKey };
              console.error(
                `[EXT-API:resume-pdf] status=failed error_type=${errorType} elapsed_ms=${Math.round(performance.now() - pdfLoadStartedAtRef.current)}`,
              );
            }}
          >
            {(pdfDocument) => (
              <PdfViewerInner
                pdfDocument={pdfDocument}
                highlights={highlights}
                scrollRef={handleScrollRef}
                highlightTransform={highlightTransform}
                onViewerReady={handleViewerReady}
              />
            )}
          </PdfLoader>
        </div>
      )}
    </div>
  );
}

function PdfViewerInner({
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
