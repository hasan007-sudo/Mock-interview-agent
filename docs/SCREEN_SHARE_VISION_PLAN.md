# Screen-share vision capacity and implementation plan

Date: 2026-07-14

## Decision summary

- Ask the candidate to share their entire screen at interview start and keep the screen, camera, and microphone published until the session ends or the candidate stops sharing.
- Do not send screen images to the LLM during verbal questions.
- During code or whiteboard questions, inspect at most one frame every 10 seconds and skip frames that have not changed meaningfully.
- Run screen analysis as independent, stateless GPT-5.1 observer calls. Never append screenshots to the voice agent's conversation history.
- Send only a short structured nudge to the voice agent when the observer detects a meaningful deviation. Discard all other observer output.

This separation is required. Appending every screenshot to the main conversation would exhaust the usable prompt budget in roughly 10–15 minutes of visual work and would repeatedly rebill the growing history.

## Verified current state

- The LiveKit agent defaults to `openai/gpt-5.1` through OpenRouter in `intervoo-agents/agent/src/session.py`.
- OpenRouter currently reports that model as accepting text, image, and file input, with:
  - 400,000-token total context window.
  - 272,000-token maximum prompt and 128,000-token maximum completion.
  - $1.25 per million input tokens and $10 per million output tokens for the default OpenAI endpoint.
- GPT-5.1 accepts individual image inputs, not a video stream. Screen video therefore has to be sampled into images.
- The frontend accepts 1–12 configured questions. The default set has five questions: three verbal, one code, and one whiteboard.
- `interview_question_started` already identifies the active question surface. It is the source of truth for turning screen observation on and off.
- MP4 room-composite recording is independent of agent observation. An always-published screen may still appear in the recording during verbal questions even when no image is sent to GPT-5.1.

References:

- [OpenAI GPT-5.1 model limits](https://developers.openai.com/api/docs/models/gpt-5.1)
- [OpenAI image input and token-metering guidance](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenRouter image-input format](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding)
- [LiveKit selective track subscription](https://docs.livekit.io/transport/media/subscribe/)

## Interview duration and question capacity

Each question is assumed to take 3–10 minutes, including explanation and follow-up discussion.

### Current product limits

| Configuration | Total duration | Visual duration | Maximum 10-second samples |
| --- | ---: | ---: | ---: |
| One question | 3–10 min | 0–10 min | 0–60 |
| Current default: 5 questions, 2 visual | 15–50 min | 6–20 min | 36–120 |
| Maximum: 12 questions, all visual | 36–120 min | 36–120 min | 216–720 |

The present 12-question validation cap means the longest representable interview is 120 minutes. The recommended production target is 45–60 minutes with 6–10 questions, of which 15–30 minutes should normally be coding or whiteboarding.

### Practical interview presets

| Interview duration | Timing-only question range | Recommended question count | Recommended visual time | Maximum visual samples |
| --- | ---: | ---: | ---: | ---: |
| 30 min | 3–10 | 4–6 | 10–15 min | 60–90 |
| 45 min | 5–15 | 6–8 | 15–25 min | 90–150 |
| 60 min | 6–20 | 8–10 | 20–30 min | 120–180 |
| 90 min | 9–30 | 10–12 | 30–45 min | 180–270 |

The timing-only range ignores the current 12-question cap. The recommended count leaves time for greeting, transitions, clarification, follow-ups, and closing feedback.

## GPT-5.1 image capacity estimate

### Planning assumptions

- The client sends a resized whole-screen image no larger than 1920×1080 using high detail so code remains readable.
- One observer request contains the current image, question, evaluation criteria, and compact observer instructions.
- Budget 2,500–3,500 input tokens per observer request. This is a planning range, not a guaranteed tokenizer result; production must record the API's actual usage.
- Limit observer output to 50–100 tokens.
- Sampling every 10 seconds produces six potential requests per active visual minute.

### Rejected: screenshots in the main voice context

OpenRouter exposes a 272,000-token prompt ceiling for the configured GPT-5.1 route. Reserving about 50,000 tokens for the system prompt, transcript, tools, questions, and responses leaves roughly 222,000 tokens for images.

At 2,500–3,500 tokens per sampled frame:

```text
222,000 / 3,500 = 63 frames = about 10.5 visual minutes
222,000 / 2,500 = 88 frames = about 14.7 visual minutes
```

Therefore, the accumulated-context approach supports only about 10–15 minutes of coding or Excalidraw work, approximately 2–5 visual questions depending on question length. It would not reliably support the current default's worst case of two 10-minute visual questions.

### Selected: stateless observer calls

Each screen observation starts with a fresh context containing only one image and the current question criteria. The 400,000-token context window is therefore not an interview-duration limit.

With this design GPT-5.1 can process the full current product maximum of 120 visual minutes and 720 potential samples, subject to OpenRouter rate limits, cost, network health, and provider latency. Interview duration does not consume a cumulative vision context window.

```text
Screen track
    |
    +-- verbal question ------> agent screen subscription off
    |                           zero image requests
    |
    +-- code / whiteboard ---> one candidate frame every 10 seconds
                                |
                                +-- unchanged --> discard
                                |
                                +-- changed ----> stateless GPT-5.1 observer
                                                    |
                                                    +-- no deviation --> discard
                                                    +-- deviation ----> short nudge only
```

## Cost and concurrency estimate

At the current listed GPT-5.1 rates and the planning token range:

| Active visual time | Potential calls | Estimated vision cost before deduplication |
| --- | ---: | ---: |
| 10 min | 60 | $0.22–$0.32 |
| 20 min | 120 | $0.44–$0.65 |
| 30 min | 180 | $0.65–$0.97 |
| 60 min | 360 | $1.31–$1.94 |
| 120 min | 720 | $2.61–$3.87 |

These estimates include observer input and a 50–100 token structured output per call. They exclude the voice agent's LLM usage, STT, TTS, LiveKit bandwidth, egress recording, and OpenRouter credit-purchase fees. Actual image tokenization and provider routing can move the result, so billed usage is the final source of truth.

Potential observer load before unchanged-frame filtering:

| Simultaneous visual interviews | Vision requests/min | Estimated input tokens/min |
| ---: | ---: | ---: |
| 1 | 6 | 15K–21K |
| 10 | 60 | 150K–210K |
| 50 | 300 | 750K–1.05M |
| 100 | 600 | 1.5M–2.1M |

The application workload is horizontally scalable, but OpenRouter RPM/TPM limits become the primary bottleneck. Voice-agent calls using the same account also consume quota, so deployment capacity must be based on measured combined traffic rather than the vision table alone.

## Implementation changes

### Frontend screen publishing

- Add an interview-start action that explicitly asks the candidate to share the entire screen. Browser permission must still come from a user click; the application cannot silently select or grant whole-screen access.
- Keep camera video enabled when screen sharing starts.
- Keep the screen track published across verbal, code, and whiteboard questions. Stop it only when the interview ends or the candidate uses the browser's stop-sharing control.
- Show a persistent sharing/recording indicator and warn that the screen may remain in the MP4 recording during verbal questions.

### Question-driven agent subscription

- Keep microphone subscription active throughout the session.
- When `mark_question_started` starts a verbal question, stop the visual sampling task and unsubscribe the agent from the screen track.
- When `open_question_editor` starts a code or whiteboard question, subscribe to the screen track and start the 10-second sampling task.
- Stop sampling immediately when the question changes, screen sharing ends, the participant disconnects, or the session closes.

### Stateless screen observer

- Use a separate GPT-5.1 request path rather than adding images to `AgentSession` chat history.
- Resize 4K or larger screen frames to at most 1920×1080 before upload; preserve aspect ratio and use a text-readable encoding.
- Compare a downscaled perceptual representation with the last analyzed frame. Ignore cursor-only or very small changes; do not rely on an exact byte hash.
- Add optional `evaluationCriteria: string[]` to each configured question. Send the current question and criteria with every visual observation; if criteria are absent, ask the observer to evaluate only obvious correctness or approach issues and avoid overconfident nudges.
- Require structured observer output:

```json
{
  "shouldNudge": true,
  "confidence": 0.0,
  "reason": "short internal explanation",
  "nudge": "one concise spoken suggestion"
}
```

- Discard the response when `shouldNudge` is false or confidence is below the configured threshold.
- Apply a 60-second spoken-nudge cooldown per question unless the latest observation identifies a clearly blocking issue. The observer may continue checking every 10 seconds during the cooldown.
- Add only the accepted `nudge` text to the voice flow. Do not retain images, observer reasoning, or negative observations in the main conversation.

### Recording and privacy

- Leave the existing MP3 and MP4 egress startup unchanged for the first implementation.
- Treat agent observation and recording as separate controls: disabling vision during verbal questions does not remove the shared screen from room-composite MP4.
- Obtain explicit consent for continuous whole-screen capture and recording. If excluding verbal-question screens from recordings becomes a requirement, handle that as a separate egress-template or track-publication change.

## Observability and acceptance checks

Record these metrics without storing the screenshot itself:

- Visual surface active duration.
- Potential samples, unchanged samples skipped, and GPT requests made.
- Prompt tokens, completion tokens, cost, latency, and provider for each observer request.
- Nudges proposed, nudges accepted, and cooldown suppressions.
- Screen-track subscription state changes and unexpected frames received during verbal questions.
- OpenRouter rate-limit and timeout counts.

Acceptance checks:

1. Starting screen share does not disable the camera.
2. A verbal question results in no screen frames being decoded by the agent and no vision requests.
3. A code or whiteboard question produces at most one candidate observation every 10 seconds.
4. An unchanged screen does not produce another GPT-5.1 request.
5. Images and observer reasoning never appear in the main voice-agent history.
6. A useful deviation can produce one short spoken nudge, with subsequent nudges respecting the cooldown.
7. Moving from a visual question to a verbal question stops sampling immediately while the user's screen remains published.
8. A 60-minute soak with 30 visual minutes stays within the expected 180-request ceiling before deduplication and reports actual token/cost usage.

## Rollout

1. Add usage instrumentation and the stateless observer behind an off-by-default feature flag.
2. Validate code readability and actual tokens per 1920×1080 frame with a small internal session.
3. Run 30- and 60-minute internal interviews and compare observed cost, latency, skip rate, and nudge usefulness with the estimates above.
4. Load-test the expected concurrency against the real OpenRouter account limits while the voice agent is active.
5. Enable for internal users, then a small production percentage. Expand only after rate-limit errors and incorrect nudges are within the agreed thresholds.
