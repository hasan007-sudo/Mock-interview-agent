# Screen Feedback Backlog

Last audited: 2026-07-15

## Current behavior

The frontend and LiveKit agent use two separate channels:

```text
Screen-share video track
  -> ScreenFeedbackRuntime._start_video_stream()
  -> latest frame replaces the previous frame
  -> GPT-5.1 receives one frame only when analysis is triggered

Editor activity event
  -> Monaco or Excalidraw calls onContentChange()
  -> InterviewSession increments surfaceRevision
  -> candidate.surface_state publishes content_revision
  -> backend records when that revision arrived
```

The activity event contains the surface type and revision number. It does not
currently contain Monaco's raw code or Excalidraw's scene.

## How the agent currently measures whether the candidate is stuck

`ScreenFeedbackRuntime._unchanged_since` uses the backend's monotonic clock.
It is reset when:

- A coding or whiteboard question starts.
- The active surface changes.
- A different `content_revision` arrives from the frontend.
- The candidate explicitly requests screen feedback through
  `inspect_shared_screen`.

Every ten seconds, `_run_timer()` calls `_evaluate_latest_frame()`. The method
calculates:

```text
unchanged_seconds = backend monotonic time - _unchanged_since
```

The current automatic stall threshold is sixty seconds, not five minutes. At
the threshold, one screen analysis is performed for that revision. It is not
performed again until the content revision changes. The agent speaks only when
the vision model returns `should_speak=true`, confidence is at least `0.8`, the
agent is listening, and the candidate is not speaking.

This means the current system detects "no revision received for sixty seconds."
It does not prove that the candidate has been actively attempting the problem
for that entire period.

## Timer audit

### What is handled correctly

- The timer is created once per `ScreenFeedbackRuntime`.
- `close()` cancels and awaits the timer task.
- The timer does not start a second overlapping evaluation; it awaits the
  current vision call before continuing.
- Evaluation is disabled for verbal questions and when the coding or whiteboard
  surface is closed.
- A missing screen-share frame, agent speech, or candidate speech prevents an
  automatic evaluation. A later timer tick can try again.
- Backend monotonic time avoids wall-clock changes and does not require clock
  synchronization with the candidate's device.

### Confirmed gaps

The timer lifecycle is safe, but frontend activity synchronization is not yet
fully reliable.

1. Continuous activity can look like inactivity. The frontend uses a trailing
   seven-hundred-fifty-millisecond debounce. Continuous typing or drawing keeps
   cancelling the pending event, so the backend may receive no revision for
   sixty seconds and incorrectly classify an active candidate as stuck.
2. `visible` currently means that the React surface exists. It does not prove
   that the browser tab is foregrounded or that the editor is actually visible
   in the shared desktop frame.
3. The ten-second loop is delay-after-work, not a fixed schedule. If a vision
   request takes four seconds, the next tick occurs about fourteen seconds after
   the previous tick. This prevents overlap but makes timing approximate.
4. `_evaluate_latest_frame()` marks a revision as evaluated before the LLM call
   succeeds. A failed LLM request may postpone its retry until another revision
   or stall condition.
5. There is no frontend/backend acknowledgement or activity diagnostic showing
   the latest revision and last activity age. Production drift is therefore
   difficult to distinguish from a missing data event.

## Backlog

### P0 - Send activity without creating false stalls

Replace the trailing-only activity debounce with a throttled heartbeat:

```text
First content change
  -> publish activity immediately

Continued typing or drawing
  -> publish at most once every five seconds

User pauses
  -> publish the final content revision
```

The backend should maintain separate values:

- `last_activity_at`: reset by the throttled activity heartbeat.
- `content_revision`: identifies a stable editor or whiteboard change.
- `last_analyzed_revision`: prevents duplicate vision calls.

Automatic stuck feedback must use `last_activity_at`, not the absence of a
debounced content event.

### P0 - Define the actual stuck-feedback policy

Choose and document the product threshold:

- Current behavior: one automatic check after sixty seconds without activity.
- Five-minute behavior: set the stall threshold to three hundred seconds.

Do not infer "trying for five minutes" from question age alone. Track these
durations separately:

- `question_elapsed_seconds`: time since the coding/whiteboard question opened.
- `inactive_seconds`: time since the latest real editor/whiteboard activity.
- `time_since_last_hint_seconds`: prevents repeated nudges.

A sensible five-minute policy is:

```text
question elapsed >= five minutes
AND inactive >= sixty seconds
AND no hint was recently given
  -> analyze one current frame
  -> speak only for a high-confidence useful hint
```

### P0 - Provide exact Monaco code to screen inspection

The current screen tool reads code visually from the shared-screen image. Small
text, hidden lines, and horizontal scrolling can make that inaccurate.

Extend the existing `candidate.surface_state` path for coding questions so the
backend stores the latest Monaco text and selected language. Throttle updates,
cap the payload size, and never add the raw code to the main interview chat.

When `inspect_shared_screen` or automatic analysis runs:

```text
Coding question
  -> current question + latest raw Monaco code + one current screen frame

Whiteboard question
  -> current question + one current screen frame
```

The image remains useful for layout, runtime output, and other visible context.
The raw Monaco value provides exact code semantics.

### P1 - Retry failed analysis safely

Update `last_analyzed_revision` only after the vision request succeeds. If the
request fails, keep the revision eligible for a later timer tick and apply a
short retry backoff to avoid rapid repeated failures.

### P1 - Track actual frontend visibility

Include page visibility with the existing surface event. Automatic analysis
should require:

```text
surface exists
AND document visibility is visible
AND screen-share track has a current frame
```

Window focus should be treated carefully because the user may interact with a
screen-sharing control or browser permission dialog without abandoning the
question.

### P1 - Add timer observability

Log one structured record per decision boundary containing:

- Room and question id.
- Surface and content revision.
- Question elapsed seconds.
- Inactive seconds.
- Timer tick result: skipped, analyzed, or spoke.
- Exact skip reason.
- LLM input, cached-input, and output usage when available.

These logs should not include raw code, image contents, credentials, or other
personal information.

### P2 - Decide whether exact ten-second cadence matters

The current sequential loop is safer and cheaper because evaluations cannot
overlap. Keep it if "roughly every ten seconds" is acceptable. If exact cadence
is required, use monotonic deadlines while still enforcing a single in-flight
vision request.

## Intended final call flow

```text
CodeEditorPanel.onChange() / WhiteboardPanel.onChange()
  # Reports real candidate activity without sending anything to the LLM.
  -> InterviewSession.publishCandidateSurfaceState()
      # Sends throttled activity and the latest semantic revision to LiveKit.
      -> ScreenFeedbackRuntime._on_data_received()
          # Updates backend activity time and surface state.
          -> ScreenFeedbackRuntime._run_timer()
              # Checks the policy periodically without overlapping calls.
              -> ScreenFeedbackRuntime._evaluate_latest_frame()
                  # Calls vision only when the stuck policy says it is needed.
                  -> ScreenFeedbackRuntime._analyze_frame()
                      # Uses a temporary frame/code context and returns text only.
```
