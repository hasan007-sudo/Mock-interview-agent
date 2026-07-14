import { RoomEvent, type Room } from "livekit-client";
import { useEffect } from "react";
import { type AgentDataEvent, parseAgentEvent } from "@/lib/events";

const TAG = "[mock-interview]";

/**
 * Listens only for the three agent data events used by the interview UI,
 * logs their complete payloads, and forwards them to the session layout.
 */
export function useRoomEventLogger(
  room: Room,
  onEvent: (event: AgentDataEvent) => void,
) {
  useEffect(() => {
    const handleData = (payload: Uint8Array) => {
      const event = parseAgentEvent(payload);
      if (!event) return;

      console.info(`${TAG} ${event.type}`, event);
      onEvent(event);
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [onEvent, room]);
}
