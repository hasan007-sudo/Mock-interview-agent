// Dev helper: simulate the agent's editor events without waiting for the LLM
// to call the tools. Sends the same data-channel payloads the Python agent's
// open_code_editor / open_whiteboard tools publish.
//
// Usage (room name is shown in sessionStorage "mock-interview-connection",
// or in the agent worker logs):
//   set -a && source .env.local && set +a
//   bun scripts/send-event.ts <roomName> open_code_editor
//   bun scripts/send-event.ts <roomName> open_whiteboard
import { RoomServiceClient } from "livekit-server-sdk";

const [roomName, eventType] = process.argv.slice(2);
if (!roomName || !eventType) {
  console.error(
    "usage: bun scripts/send-event.ts <roomName> <open_code_editor|open_whiteboard>",
  );
  process.exit(1);
}

const svc = new RoomServiceClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

const payload =
  eventType === "open_code_editor"
    ? {
        type: "open_code_editor",
        timestamp: new Date().toISOString(),
        metadata: {
          question:
            "Write a function that returns the first non-repeating character in a string.",
          language: "python",
        },
      }
    : {
        type: "open_whiteboard",
        timestamp: new Date().toISOString(),
        metadata: {
          question:
            "Sketch the high-level architecture of a URL shortener service.",
        },
      };

await svc.sendData(roomName, new TextEncoder().encode(JSON.stringify(payload)), 0, {});
console.log("sent", eventType, "to", roomName);
