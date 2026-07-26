import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/components/session/interview-session.tsx", import.meta.url),
  "utf8",
);

test("returns home when LiveKit disconnects the room", () => {
  expect(source).toContain(
    "room.on(RoomEvent.Disconnected, handleRoomDisconnected)",
  );
  expect(source).toContain(
    "room.off(RoomEvent.Disconnected, handleRoomDisconnected)",
  );
  expect(source).toContain('router.replace("/")');
});
