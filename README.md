# Mock Interview Agent

A realistic mock technical interview app: a LiveKit voice agent interviews the candidate over audio, with two video tiles (candidate camera + interviewer placeholder). When the interviewer asks a coding or design question, the Python agent calls a tool that publishes a data-channel event, and the frontend opens a **Monaco code editor** (Java / JavaScript / Python) or an **Excalidraw whiteboard** in real time. Submitted code — and the whiteboard exported as an image — are evaluated by an LLM via OpenRouter directly from this app (`/api/evaluate`); nothing is sent back to the voice agent.

## How it works

```
Home (name entry + editable questions JSON)
  └─ POST /api/connection-details
       ├─ validates questions [{id, text, surface: "verbal"|"code"|"whiteboard", language?}]
       ├─ RoomServiceClient.createRoom(metadata: { agent_id: "mock_interview",
       │     avatar: true, questions, prompt_context: { interview_plan, ... } })
       ├─ AgentDispatchClient.createDispatch(room, LIVEKIT_AGENT_NAME)
       └─ mints participant token
Session page
  ├─ useSession + SessionProvider (@livekit/components-react v2)
  ├─ RoomEvent.DataReceived → { type: "open_code_editor" | "open_whiteboard" }
  └─ Submit → POST /api/evaluate (ai SDK + OpenRouter, vision model for whiteboard)
```

The agent asks the configured questions in order. For questions with `surface: "code"` or `"whiteboard"` it calls the `open_question_editor(question_id)` tool, which publishes the matching data-channel event, and the prompt requires it to tell the candidate the editor is open on their screen and to type/draw there. Questions default to [src/lib/questions.ts](src/lib/questions.ts) and are editable on the home page before starting.

The agent side lives in `intervoo-agents/agent`:

- `src/editor_tools.py` — `open_question_editor` (id-based, when metadata has questions) or free-form `open_code_editor` / `open_whiteboard` tools (publish data events)
- `config/agents.json` — `mock_interview` profile
- `prompts/interview/v3.md` — interviewer system prompt (drives the `{interview_plan}`)

## Setup

1. Copy `.env.example` to `.env.local` and fill in the LiveKit credentials (same project as the agent) and an OpenRouter key. `LIVEKIT_AGENT_NAME` must match the worker's `AGENT_NAME`.
2. In `intervoo-agents/agent`, copy `.env.example` to `.env.local`, set `AVATAR_PROVIDER` to `liveavatar` or `simli`, and fill in that provider's credentials. If the provider is disabled, misconfigured, or cannot start, the session continues with the existing audio agent and static interviewer image.

   Hedra cannot be selected: Hedra shut down its Realtime Avatar service on April 15, 2026, and the current LiveKit plugin intentionally rejects new sessions.
3. Start the agent worker (first run downloads model files):

   ```bash
   cd ../intervoo-agents/agent
   uv run src/server.py download-files   # once
   TTS_PROVIDER=sarvam uv run src/server.py dev
   ```

4. Start the app:

   ```bash
   bun install
   bun dev
   ```

5. Open http://localhost:3000, enter your name, and allow microphone + camera.

## Notes

See [docs/ARCHITECTURAL_DECISIONS.md](docs/ARCHITECTURAL_DECISIONS.md) for the trade-offs behind the library and design choices.

- The candidate tells the interviewer *verbally* when they finish coding — editor content never goes to the agent.
- The whiteboard is Excalidraw (MIT licensed — free for commercial production use; it replaced tldraw, whose license requires a paid key in production).
- Monaco loads from the jsDelivr CDN by default.
