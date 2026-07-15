"use client";

import { toast } from "sonner";
import { AgentControlBar } from "@/components/agents-ui/agent-control-bar";

export function ControlBar({
  isConnected,
  isTranscriptOpen,
  onDisconnect,
  onTranscriptOpenChange,
}: {
  isConnected: boolean;
  isTranscriptOpen: boolean;
  onDisconnect: () => void;
  onTranscriptOpenChange: (open: boolean) => void;
}) {
  return (
    <footer className="session-footer flex shrink-0 items-center justify-center px-4 py-3">
      <AgentControlBar
        variant="livekit"
        isConnected={isConnected}
        isChatOpen={isTranscriptOpen}
        showChatInput={false}
        onDisconnect={onDisconnect}
        onIsChatOpenChange={onTranscriptOpenChange}
        onDeviceError={({ source }) => {
          const device =
            source === "microphone"
              ? "microphone"
              : source === "screen_share"
                ? "screen"
                : "camera";
          toast.error(
            `Could not access your ${device}.`,
          );
        }}
        controls={{
          microphone: true,
          camera: true,
          screenShare: true,
          chat: true,
          leave: true,
        }}
        className="session-agent-controls"
      />
    </footer>
  );
}
