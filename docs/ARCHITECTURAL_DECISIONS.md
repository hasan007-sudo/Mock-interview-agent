# Architectural Decisions

Decisions and trade-offs made while building the mock interview app (2026-07). Each entry records what we chose, what we rejected, and what we knowingly gave up.

## 1. Whiteboard: Excalidraw (replaced tldraw)

**Decision:** Use `@excalidraw/excalidraw` (MIT) for the whiteboard.

**Context:** We first shipped tldraw for its polish (multi-page canvas, nicer shape tools). tldraw v5 is source-available, not open source: production use requires a license key, the SDK technically enforces this (environment detection, watermark enforcement), and the license terminates automatically on breach. Since this product is intended for commercial use, that meant either paying or carrying legal/runtime risk.

**Trade-offs accepted:**
- Excalidraw's UI is slightly less polished; no multi-page support.
- Excalidraw 0.18.1 declares React 17/18 peer deps; we run React 19. Verified working (build + runtime), but peer warnings appear on install — revisit when Excalidraw ships official React 19 support.
- The swap cost was one component ([src/components/session/whiteboard-panel.tsx](../src/components/session/whiteboard-panel.tsx)) because the export contract (canvas → PNG data URL) was kept identical.

**Do not reintroduce tldraw** without budgeting for a commercial license.

## 2. Code editor: Monaco over CodeMirror

**Decision:** `@monaco-editor/react` for the coding surface (Java / JavaScript / Python).

**Why:** Monaco is the VS Code editor — the most realistic interview-coding feel, first-class syntax support for all three languages, and the React wrapper needs zero bundler config.

**Trade-offs accepted:**
- Monaco loads from the jsDelivr CDN at runtime by default (external dependency, ~larger first load). Acceptable for now; can be self-hosted via `loader.config` if offline/CSP requirements appear.
- Heavier than CodeMirror 6. We valued realism over bundle size.

## 3. Editor content is evaluated in the frontend, not sent to the voice agent

**Decision:** Code and whiteboard content never reach the LiveKit agent. The Next.js app evaluates submissions itself via `/api/evaluate` (ai SDK + OpenRouter; vision model for the whiteboard PNG). The candidate tells the interviewer *out loud* when they're done, and the interviewer probes their verbal explanation.

**Alternatives rejected:**
- Live-syncing editor content into the agent's LLM context (most realistic — interviewer could comment on code as it's written).
- A submit-to-agent flow over RPC/data channel.

**Trade-offs accepted:**
- The interviewer genuinely cannot see the code, so it can only discuss what the candidate says — slightly less realistic than a human screen-share interview.
- Two separate LLM surfaces (agent LLM + evaluation LLM) with no shared state; the spoken interview and the written evaluation can disagree.
- In exchange: no agent-side changes for evaluation, no context-window bloat in the voice pipeline, and evaluation results render instantly in the UI.

## 4. Agent → frontend signaling: data channel events (`publish_data`)

**Decision:** The agent's `open_code_editor` / `open_whiteboard` tools publish JSON over the LiveKit data channel (reliable, no topic); the frontend discriminates on `payload.type` ([src/lib/events.ts](../src/lib/events.ts)).

**Why:** This is the exact pattern the existing intervoo agent already uses (`diagnostic_question_started` in `question_tools.py`), and the diagnostics frontend already consumes it. Consistency across the fleet beat inventing a new mechanism.

**Alternatives rejected:** LiveKit RPC (`performRpc`) — request/response semantics we don't need for fire-and-forget UI triggers; text streams — designed for transcriptions/chat.

**Trade-offs accepted:** No delivery acknowledgment back to the LLM beyond the tool's return value, and no topic scoping (every listener sees every event and must filter by `type`).

## 5. Tool-calling safety: preemptive generation disabled for editor profiles

**Decision:** In the agent (`server.py`), `disable_preemptive_generation` is on for any profile with `editor_events` (as it already was for diagnostic agents).

**Why:** With speculative generation, tools can fire on partial transcripts — the editor could pop open mid-sentence for a question the candidate never got asked.

**Trade-off accepted:** Slightly higher response latency for the interviewer agent.

## 6. Room + dispatch created up front; credentials handed off via sessionStorage

**Decision:** `POST /api/connection-details` (on the home-page submit) creates the room with metadata, dispatches the named agent, and mints the token. The session page reads the credentials from `sessionStorage` and connects with `TokenSource.literal`.

**Alternative rejected:** Letting `useSession`'s token source call the API lazily on the session page. React StrictMode double-invokes the token fetch in dev, which would create two rooms and two agent dispatches per session.

**Trade-offs accepted:**
- Token TTL is 15 minutes with no refresh flow; a candidate who idles on the home page too long gets a dead token (acceptable: sessions start immediately after submit).
- Credentials don't survive a hard tab close (by design — sessions are throwaway).

## 7. Questions are user-configured JSON with per-question surface flags (supersedes: LLM-generated)

**Decision:** Questions are a structured list — `{id, text, surface: "verbal" | "code" | "whiteboard", language?}` — shown as editable JSON on the home page ([src/lib/questions.ts](../src/lib/questions.ts) holds the defaults), validated client- and server-side, and sent to the agent in room metadata. The prompt (`prompts/interview/v3.md`) receives an annotated `{interview_plan}` and instructs the interviewer to ask them in order. For editor/whiteboard questions the agent calls `open_question_editor(question_id)`; the tool resolves the surface flag server-side and publishes the exact configured question text, so the LLM cannot mangle what appears on screen. The prompt also requires the interviewer to explicitly tell the candidate the editor is open on their screen and to type/draw there.

**History:** v1 of this app had fully LLM-invented questions with free-form `open_code_editor(question, language)` / `open_whiteboard(question)` tools. Those free-form tools remain as a fallback when metadata has no questions list.

**Alternatives rejected:** Chroma KB retrieval (infrastructure the mock interview doesn't need); keeping free-form-only tools (no control over which question opens which UI, and the on-screen text depended on the LLM echoing it correctly).

**Trade-offs accepted:** Less adaptive — the interviewer follows the plan rather than inventing questions mid-flight (follow-up probes are still free-form). The candidate sees the question list before the interview starts, which weakens surprise; acceptable for a practice tool, revisit if it becomes an assessment tool.

## 8. Agent selection: reuse the existing profile catalog + named dispatch

**Decision:** New `mock_interview` profile in the agent's `config/agents.json`, selected via `agent_id` in room metadata; the frontend dispatches the worker explicitly by name (`LIVEKIT_AGENT_NAME`, must match the worker's `AGENT_NAME`).

**Why:** The intervoo worker already routes every room this way (`pick_profile`); adding a profile was ~15 lines vs. building a separate agent service.

**Trade-off accepted:** This app is coupled to the intervoo agent repo's conventions (metadata schema, profile flags). A breaking change there breaks this frontend silently — the contract is documented in the README and in `src/lib/events.ts`.

## 9. LiveKit integration: v2 Agents Session API

**Decision:** `useSession` / `SessionProvider` / `useAgent` from `@livekit/components-react` v2, plus prebuilt `RoomAudioRenderer`, `VideoTrack`, `BarVisualizer`, `useTrackToggle`.

**Why:** It's LiveKit's current API and what the diagnostics app's live flow uses. The older `LiveKitRoom` / `useVoiceAssistant` style (still present in diagnostics' component library) is deprecated-adjacent; new code shouldn't adopt it.

## 10. Evaluation LLM: OpenRouter via Vercel ai SDK v7

**Decision:** `generateText` + `Output.object` (zod schema) against `google/gemini-2.5-flash` through `@openrouter/ai-sdk-provider`.

**Why:** OpenRouter key already existed for the agent; one vision-capable model handles both code (text) and whiteboard (image) evaluation; `generateObject` is deprecated as of ai SDK v6, so `Output.object` is the non-legacy path.

**Trade-off accepted:** Model is env-configurable (`OPENROUTER_MODEL`) but must stay vision-capable or whiteboard evaluation breaks — noted in `.env.example`.

## 11. No authentication

**Decision:** Name entry only; no accounts, no persistence of sessions or results.

**Why:** Explicitly out of scope for this phase. Evaluation results live only in component state and are gone on refresh. Revisit when results need to be stored or gated.
