import { RoomEvent, type Room } from "livekit-client";
import { useEffect } from "react";
import { type AgentDataEvent, parseAgentEvent } from "@/lib/events";

const TAG = "[mock-interview]";

/**
 * Listens for the planned-question event, logs its candidate-safe payload,
 * and forwards it to the session layout.
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
