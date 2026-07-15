# Screen feedback experiment specification

Date: 2026-07-14

Status: implementation-ready specification

This document specifies two independently selectable ways for the LiveKit interviewer to analyze code or Excalidraw work and speak a useful suggestion:

1. A proactive whole-screen observer that checks one frame every 10 seconds.
2. An on-demand **Give Hint** action that sends the current editor answer only when the candidate asks.

The two approaches share one stateless GPT-5.1 analysis and speech pipeline, but their triggers and input sources remain separate so they can be compared fairly. This document is separate from `SCREEN_SHARE_VISION_PLAN.md`; that document remains the capacity estimate, while this document is the authoritative implementation and experiment contract.

LiveKit documentation MCP was unavailable while this specification was written. Current official LiveKit documentation and the installed SDK versions were inspected instead. Implementation-time API signatures must be checked against `livekit-client` 2.20.x and LiveKit Agents 1.5.9 before editing.

## Goals and boundaries

- Keep screen sharing, camera, and microphone active together.
- Never run screen analysis for verbal questions.
- Never retain an image in the main voice-agent conversation.
- Keep only spoken feedback text in the voice-agent history.
- Compare proactive assistance against candidate-controlled assistance without changing the interview questions, model, or voice stack.
- Preserve the existing Submit for evaluation behaviour and results.

Not included:

- Remote control of the candidate's screen.
- Continuous video input to GPT-5.1.
- OCR-based analysis of Monaco when source code is already available as text.
- Automatic support for external IDEs in the on-demand variant.
- Changing the existing MP3 or MP4 egress configuration.

## Experiment modes

Add a validated `screen_feedback_mode` field to room metadata:

```text
off    No observer and no Give Hint button.
timer  Proactive 10-second observer only.
hint   Give Hint button only.
both   Both enabled; internal arbitration/QA only.
```

Default to `off`. Production comparison sessions use only `timer` or `hint`; `both` must not be used to judge preference because proactive nudges can reduce the need to request a hint.

The frontend connection response exposes the resolved mode as `screenFeedbackMode`, and the backend independently validates the room-metadata value. An unknown or missing value resolves to `off`.

## Shared invariants

- `interview_question_started` remains the source of truth for the active question and surface.
- Only `code` and `whiteboard` are visual surfaces. `verbal` immediately disables timer analysis.
- Every LLM analysis receives one current answer/frame plus the current question and evaluation criteria in a fresh context.
- Temporary code/image input, observer instructions, internal reasoning, and negative/no-nudge results are discarded after the request.
- Accepted feedback is spoken with `AgentSession.say(..., add_to_chat_ctx=True)`, so the assistant's short text remains in history without its image.
- Only one feedback analysis may own speech at a time. User-requested hints have priority over timer work.
- Images, base64 payloads, and source code must not be written to logs.

```text
                         interview_question_started
                                     |
                       +-------------+-------------+
                       |                           |
                    verbal                  code / whiteboard
                       |                           |
              disable visual work       enable configured mode
                                                   |
                              +--------------------+--------------------+
                              |                                         |
                      timer trigger                              Give Hint click
                      whole-screen frame                         editor answer
                              |                                         |
                              +--------------------+--------------------+
                                                   |
                                      fresh GPT-5.1 context
                                                   |
                                      short feedback decision
                                                   |
                                  discard input and temporary context
                                                   |
                                     speak accepted text only
```

## Public contracts

### Question schema

Extend configured questions with an optional evaluator rubric:

```ts
type InterviewQuestion = {
  id: string;
  text: string;
  surface: "verbal" | "code" | "whiteboard";
  language?: "java" | "javascript" | "python";
  evaluationCriteria?: string[];
};
```

Validation rules:

- `evaluationCriteria` is optional.
- When supplied, it contains 1–8 non-empty strings, each limited to 300 characters.
- Criteria travel in room metadata and are normalized by `editor_tools.py` with the rest of the question.
- Without criteria, GPT-5.1 may identify only clear correctness, progress, or approach problems and must avoid claiming that an unspecified design choice is wrong.

### Hint request stream

Use a LiveKit byte/file stream with topic `interview.hint.request`. Do not put images in RPC: LiveKit RPC request and response payloads are limited to 15 KiB.

The stream contains one UTF-8 JSON document:

```ts
type HintRequest = {
  requestId: string;
  questionId: string;
  answer:
    | {
        kind: "code";
        language: "java" | "javascript" | "python";
        code: string;
      }
    | {
        kind: "whiteboard_image";
        mimeType: "image/png";
        dataBase64: string;
      };
};
```

Backend validation:

- Accept only the linked candidate participant.
- Require the request's `questionId` to match the backend's current active code/whiteboard question.
- Resolve question text and evaluation criteria from backend state, not from candidate payload.
- Limit decoded request size to 5 MiB, code to 100,000 characters, and image MIME type to PNG.
- Reject duplicate `requestId` values and more than one in-flight request per participant.

### Hint status event

The existing frontend data-event union expands by one event so the button can stop loading and report failures:

```ts
type InterviewHintStatusEvent = {
  type: "interview_hint_status";
  timestamp: string;
  metadata: {
    requestId: string;
    status: "accepted" | "speaking" | "failed";
    message?: string;
  };
};
```

`accepted` means the backend validated and queued the request. `speaking` means feedback text was produced and handed to the voice session. `failed` contains a safe user-facing message and no provider details.

### Stateless analyzer result

Both trigger types use the same internal result shape:

```python
class ScreenFeedbackResult:
    should_speak: bool
    confidence: float
    reason: str
    feedback: str
```

- `feedback` is at most two short spoken sentences and must not reveal a complete solution.
- Timer analysis may return `should_speak=False`.
- An explicit hint request should normally return feedback; it returns `should_speak=False` only when the answer is empty, unreadable, stale, or unrelated to the active question.
- `reason` is internal, logged only as a bounded category or hash, and never added to agent history.

## Variant A: proactive 10-second observer

### Frontend changes

1. Replace automatic camera/microphone-only startup with a user-initiated start action that requests microphone, camera, and whole-screen sharing together. Browser screen selection still requires explicit user consent.
2. Enable the screen-share control in `src/components/session/control-bar.tsx`.
3. Remove the camera/screen mutual-exclusion behaviour from `src/hooks/agents-ui/use-agent-control-bar.ts`; starting screen share must not disable camera, and enabling camera must not stop screen share.
4. Keep the screen track published across all question types. Show a persistent sharing/recording indicator and a warning when sharing stops.
5. Do not create a frontend screenshot timer. The frontend publishes the LiveKit screen track; the agent samples the remote track.

### Backend changes

Create a focused `src/screen_feedback.py` runtime owned by the room session. It is responsible for active-question state, remote screen-track lifecycle, sampling, standalone GPT-5.1 calls, and speech arbitration.

`server.py`:

- Create the runtime only for the `mock_interview` profile when mode is `timer` or `both`.
- Pass its question-state callback into `build_editor_tools(...)`.
- Attach it to the linked participant, session, and room before editor tools can activate a surface.
- Close all runtime tasks and release the latest frame when the room ends.

`editor_tools.py`:

- After a question is normalized and before its frontend event is published, notify the feedback runtime of the new question.
- A verbal question stops sampling and removes the retained latest frame immediately.
- A code/whiteboard question starts the visual timer state.

`screen_feedback.py`:

- Subscribe only to the linked participant's `screen_share` video track while a code/whiteboard question is active.
- Keep only the most recent decoded frame; overwriting it releases the previous frame.
- Take the first candidate sample 10 seconds after the visual question starts, then at most once every 10 seconds.
- Resize the sampled frame to at most 1920×1080 while preserving aspect ratio.
- Skip a frame when its downscaled perceptual difference from the last analyzed frame is below threshold. Cursor-only changes should not count as meaningful progress.
- Analyze changed frames with source `timer` using a fresh GPT-5.1 context.
- Speak only high-confidence, actionable deviations. Do not narrate normal progress or repeatedly praise the candidate.
- Apply a 60-second timer-speech cooldown per question. A user-requested hint resets this cooldown.
- Before speaking, confirm that the request's question generation still matches the active question; discard stale results.
- On a verbal transition, unsubscribe from screen video so the agent receives no screen bytes or decoded frames for that question.

### Timer call stack

```text
open_question_editor()/mark_question_started()
  # Activates the backend question and publishes the existing UI event.
  -> ScreenFeedbackRuntime.set_active_question()
       # Starts or stops visual observation based on the surface.
       -> ScreenFeedbackRuntime.run_timer_loop()
            # Selects the latest changed frame every 10 seconds.
            -> ScreenFeedbackRuntime.analyze_once(source="timer")
                 # Builds and runs a temporary GPT-5.1 context.
                 -> ScreenFeedbackRuntime.offer_speech()
                      # Applies staleness, confidence, cooldown and priority rules.
                      -> AgentSession.say(feedback, add_to_chat_ctx=True)
                           # Speaks and retains only assistant text.
```

## Variant B: on-demand Give Hint

### Frontend changes

`src/components/session/code-editor-panel.tsx`:

- Add a secondary **Give Hint** button beside **Submit for evaluation**.
- Disable it when code is empty, a hint is pending, or evaluation is running.
- Send Monaco's current source text, language, and current question ID. Do not capture a code screenshot.

`src/components/session/whiteboard-panel.tsx`:

- Add the same secondary button beside **Submit for evaluation**.
- Reuse the current `getSceneElements()` and `exportToBlob()` path to produce a clean PNG.
- Reject an empty scene locally and keep the existing evaluation flow unchanged.

`src/components/session/interview-session.tsx`:

- Own `requestHint(...)` because it has the LiveKit room/session.
- Serialize the request into the `interview.hint.request` byte stream.
- Track pending requests by ID, listen for `interview_hint_status`, and pass pending state back to the active panel.
- Show `Getting hint…` while pending, re-enable on `speaking`, and show a toast on `failed` or timeout.
- Remove pending state if the question changes, the panel closes, or the room disconnects.

This variant does not require agent subscription to screen video. It remains usable for the in-app Monaco and Excalidraw surfaces even if screen sharing is unavailable or the candidate stops sharing.

### Backend changes

`screen_feedback.py` also owns the byte-stream handler when mode is `hint` or `both`:

- Register topic `interview.hint.request` when the agent enters the room.
- Read and validate one complete request without logging its content.
- Publish `accepted`, then run a source=`hint` analysis with the backend's active question and rubric.
- For code, place the source text in the temporary context.
- For whiteboard, add one `ImageContent` item to the temporary context with high image detail.
- Discard the request payload and temporary context immediately after extracting feedback.
- Publish `speaking`, then speak with `add_to_chat_ctx=True`.
- On failure, publish `failed`; do not speak provider or parsing errors.

### Hint call stack

```text
CodeEditorPanel.handleGiveHint()
  # Packages current Monaco text as a user-requested hint.
  -> InterviewSession.requestHint()
       # Sends one LiveKit byte-stream request and tracks its request ID.
       -> ScreenFeedbackRuntime.handle_hint_stream()
            # Validates the participant, question and payload.
            -> ScreenFeedbackRuntime.analyze_once(source="hint")
                 # Runs current code in a temporary GPT-5.1 context.
                 -> ScreenFeedbackRuntime.offer_speech(priority="user")
                      # Supersedes timer work and speaks the requested hint.

WhiteboardPanel.handleGiveHint()
  # Exports the current Excalidraw scene as PNG.
  -> exportToBlob()
  -> InterviewSession.requestHint()
  -> ScreenFeedbackRuntime.handle_hint_stream()
  -> ScreenFeedbackRuntime.analyze_once(source="hint")
  -> ScreenFeedbackRuntime.offer_speech(priority="user")
  -> AgentSession.say(feedback, add_to_chat_ctx=True)
```

## Arbitration when mode is `both`

- Maintain one analysis lock per room.
- A hint request is queued ahead of any timer request that has not started.
- If a timer inference is already running when a hint arrives, mark the timer result stale and do not speak it.
- Skip timer inference while a hint is queued or running.
- After a hint is spoken, block timer speech for 60 seconds to avoid repeating the same advice.
- Disable the hint button until its request reaches `speaking` or `failed`.
- If the agent is already speaking, a user-requested hint may interrupt existing agent speech; a timer nudge must wait until the session is idle.
- Never play two feedback utterances concurrently.

## Prompt behaviour

Shared instructions:

- Evaluate only the active configured question and visible/current answer.
- Prefer Socratic guidance and one next step.
- Do not provide a complete implementation or full system design.
- Do not comment on unrelated windows, notifications, personal content, or browser tabs visible in a whole-screen frame.
- If the frame is unreadable or the answer is not visible, return no feedback.

Timer-specific instructions:

- Speak only when the candidate is materially blocked, pursuing an incorrect approach, or missing a critical requirement.
- Normal typing, incomplete work, blank work during the early stage, and alternative valid approaches are not deviations.

Hint-specific instructions:

- The candidate explicitly requested help. Return one concrete clue based on their current progress.
- Start from what they have already done; do not restart the solution from scratch.

## Failure behaviour

| Condition | Timer behaviour | Hint behaviour |
| --- | --- | --- |
| Screen share denied/stopped | Disable timer and show frontend warning | Continue using Monaco/Excalidraw state |
| Verbal question | Unsubscribe and make zero vision calls | Button is not rendered |
| No changed frame | Skip request | Not applicable |
| Empty code/canvas | No nudge | Disable/reject locally |
| Question changes mid-request | Discard result | Mark request failed/stale |
| GPT-5.1 timeout/rate limit | Log bounded metric; retry next interval | Publish `failed`; user may retry |
| Candidate disconnects | Cancel tasks and release frame | Cancel stream task and pending state |
| MP4 recording enabled | Screen may still be recorded | No change |

Do not automatically retry a user hint because that can produce duplicate speech. Timer mode naturally tries a future changed frame at a later interval.

## Privacy and resource handling

- Continuous screen publication still consumes client encoding, upload bandwidth, LiveKit traffic, and MP4 egress resources even while agent analysis is off.
- Timer mode subscribes/decodes the screen only during code/whiteboard questions.
- Hint mode sends only an explicit editor answer and does not need remote screen subscription.
- Hold at most one timer frame and one active hint payload per room.
- Clear byte buffers and temporary contexts in `finally` blocks.
- Record sizes, token counts, latency, and result category; never record image bytes, base64, source code, or internal reasoning.
- Obtain explicit consent that whole-screen sharing can expose unrelated content to the room recording.

## Experiment and observability

Compare session-level variants rather than enabling both for candidates:

```text
Variant A: screen_feedback_mode=timer
Variant B: screen_feedback_mode=hint
Internal QA only: screen_feedback_mode=both
```

Keep the question set, duration, GPT-5.1 model, prompt version, TTS voice, and evaluation model identical across variants.

Record per session:

- Feedback mode and active visual duration.
- Timer frames sampled, unchanged frames skipped, GPT requests, and spoken nudges.
- Hint clicks, accepted requests, failures, and spoken hints.
- Time from trigger/click to `speaking`.
- Prompt/completion tokens, model cost, and provider errors by source.
- Speech overlap/interruption count.
- Existing submission evaluation score and time to submission after feedback.

For the first UX comparison, run at least 10 internal sessions per pure variant using the same coding and whiteboard tasks. After each session, collect 1–5 ratings for:

- Helpfulness.
- Interruptiveness.
- Feeling of control.
- Perceived response speed.

Select the preferred default based on UX rating first, then cost and request volume. Do not select timer mode merely because it produces more feedback or hint mode merely because it is cheaper.

## Verification checks

1. Camera remains published when screen sharing starts.
2. Verbal questions produce zero timer frames and zero visual LLM requests.
3. Timer mode makes at most six candidate image calls per active visual minute and retains no historical frame.
4. Hint mode makes exactly one request per accepted click.
5. Monaco hints use code text; Excalidraw hints use the exported canvas PNG.
6. The main agent history contains the spoken feedback text but no image or temporary observer message.
7. A question transition makes outstanding timer and hint results stale before speech.
8. `both` mode never produces concurrent or back-to-back duplicate feedback.
9. Screen-share failure disables timer mode without breaking the interview or hint mode.
10. MP4 recording continues under the existing egress configuration.

## Implementation order

1. Add the shared mode, question-rubric, request, result, and status contracts.
2. Add the backend `ScreenFeedbackRuntime` with stateless GPT-5.1 analysis, speech, cleanup, and metrics.
3. Add the Give Hint buttons and byte-stream request flow; verify hint-only mode first.
4. Add simultaneous camera/screen publication and backend screen-track sampling; verify timer-only mode.
5. Add arbitration and exercise `both` mode internally.
6. Run the two pure experiment variants and choose a production default from the recorded UX and cost results.

## Documentation references

- [LiveKit images and frontend byte streams](https://docs.livekit.io/agents/multimodality/vision/images/)
- [LiveKit video-frame sampling](https://docs.livekit.io/agents/multimodality/vision/video/)
- [LiveKit selective subscription](https://docs.livekit.io/transport/media/subscribe/)
- [LiveKit RPC limits and timeouts](https://docs.livekit.io/transport/data/rpc/)
- [LiveKit temporary and standalone chat contexts](https://docs.livekit.io/agents/logic/chat-context/)
- [LiveKit AgentSession speech API](https://docs.livekit.io/reference/python/livekit/agents/index.html)
- [OpenAI GPT-5.1 model limits](https://developers.openai.com/api/docs/models/gpt-5.1)
- [OpenAI image-input metering](https://developers.openai.com/api/docs/guides/images-vision)
