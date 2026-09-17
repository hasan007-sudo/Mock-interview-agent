"use client";

import type { PipecatClient } from "@pipecat-ai/client-js";
import { usePipecatClientMediaTrack } from "@pipecat-ai/client-react";
import { MessageSquareText, Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AgentControlBar } from "@/components/agents-ui/agent-control-bar";
import { Button } from "@/components/ui/button";
export function ControlBar({
  isConnected,
  isTranscriptOpen,
  onDisconnect,
  onTranscriptOpenChange,
  pipecatClient,
}: {
  isConnected: boolean;
  isTranscriptOpen: boolean;
  onDisconnect: () => void;
  onTranscriptOpenChange: (open: boolean) => void;
  pipecatClient?: PipecatClient;
}) {
  if (pipecatClient) {
    return (
      <PipecatControlBar
        client={pipecatClient}
        isConnected={isConnected}
        isChatOpen={isTranscriptOpen}
        onDisconnect={onDisconnect}
        onIsChatOpenChange={onTranscriptOpenChange}
      />
    );
  }

  return (
    <LiveKitControlBar
      isConnected={isConnected}
      isTranscriptOpen={isTranscriptOpen}
      onDisconnect={onDisconnect}
      onTranscriptOpenChange={onTranscriptOpenChange}
    />
  );
}

function PipecatControlBar({
  client,
  isConnected,
  isChatOpen,
  onDisconnect,
  onIsChatOpenChange,
}: {
  client: PipecatClient;
  isConnected: boolean;
  isChatOpen: boolean;
  onDisconnect: () => void;
  onIsChatOpenChange: (open: boolean) => void;
}) {
  const localAudioTrack = usePipecatClientMediaTrack("audio", "local");
  const localVideoTrack = usePipecatClientMediaTrack("video", "local");
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(false);

  useEffect(() => {
    if (localAudioTrack) {
      setMicEnabled(localAudioTrack.enabled);
    }
  }, [localAudioTrack]);

  useEffect(() => {
    if (localVideoTrack) {
      setCamEnabled(localVideoTrack.enabled);
    }
  }, [localVideoTrack]);

  const toggleMic = () => {
    const next = !micEnabled;
    try {
      client.enableMic(next);
      if (localAudioTrack) {
        localAudioTrack.enabled = next;
      }
      setMicEnabled(next);
    } catch {
      toast.error("Could not toggle microphone.");
    }
  };

  const toggleCam = () => {
    const next = !camEnabled;
    try {
      client.enableCam(next);
      if (localVideoTrack) {
        localVideoTrack.enabled = next;
      }
      setCamEnabled(next);
    } catch {
      toast.error("Could not toggle camera.");
    }
  };

  return (
    <footer className="session-footer flex shrink-0 items-center justify-center gap-2 px-4 py-3">
      <div className="flex items-center gap-2 rounded-full border border-border/40 bg-card/60 px-3 py-1.5 shadow-sm backdrop-blur-sm">
        <Button
          variant={micEnabled ? "outline" : "destructive"}
          size="icon"
          className="size-9 rounded-full"
          onClick={toggleMic}
          title={micEnabled ? "Mute microphone" : "Unmute microphone"}
        >
          {micEnabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
        </Button>
        <Button
          variant={camEnabled ? "outline" : "secondary"}
          size="icon"
          className="size-9 rounded-full"
          onClick={toggleCam}
          title={camEnabled ? "Turn camera off" : "Turn camera on"}
        >
          {camEnabled ? <Video className="size-4" /> : <VideoOff className="size-4" />}
        </Button>
        <Button
          variant={isChatOpen ? "secondary" : "outline"}
          size="icon"
          className="size-9 rounded-full"
          onClick={() => onIsChatOpenChange(!isChatOpen)}
          title="Toggle transcript"
        >
          <MessageSquareText className="size-4" />
        </Button>
        <Button
          variant="destructive"
          size="icon"
          className="size-9 rounded-full bg-red-600 hover:bg-red-700"
          onClick={onDisconnect}
          title="Leave interview"
        >
          <PhoneOff className="size-4" />
        </Button>
      </div>
    </footer>
  );
}

function LiveKitControlBar({
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
