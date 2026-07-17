"use client";

import {
  type ReceivedMessage,
  useAgent,
  useChat,
} from "@livekit/components-react";
import { Loader, MessageSquareText, SendHorizontal, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { AgentChatTranscript } from "@/components/agents-ui/agent-chat-transcript";
import { Button } from "@/components/ui/button";

export function TranscriptSidebar({
  messages,
  onClose,
}: {
  messages: ReceivedMessage[];
  onClose: () => void;
}) {
  const agent = useAgent();
  const { send } = useChat();
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const trimmedMessage = message.trim();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedMessage || isSending) return;

    setIsSending(true);
    try {
      await send(trimmedMessage);
      setMessage("");
    } catch (error) {
      console.error("Failed to send chat message:", error);
      toast.error("Could not send your message.");
    } finally {
      setIsSending(false);
    }
  }

  const showTranscript = messages.length > 0 || agent.state === "thinking";

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-border),0_24px_64px_rgba(0,0,0,0.34)]">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <MessageSquareText aria-hidden="true" className="size-4 text-violet-300" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Transcript</h2>
            <p className="text-[11px] text-muted-foreground">Interview conversation</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close transcript"
          className="rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1">
        {showTranscript ? (
          <AgentChatTranscript
            agentState={agent.state}
            messages={messages}
            className="h-full [&_[role=log]]:h-full"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-violet-300/10 text-violet-300">
              <MessageSquareText aria-hidden="true" className="size-4" />
            </div>
            <p className="mt-3 text-sm font-medium text-secondary-foreground">
              Conversation will appear here
            </p>
            <p className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground">
              Spoken and typed messages from you and the interviewer are shown together.
            </p>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-center gap-2 border-t border-border p-3"
      >
        <label className="sr-only" htmlFor="transcript-message">
          Message the interviewer
        </label>
        <input
          id="transcript-message"
          type="text"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={isSending}
          placeholder="Message the interviewer…"
          className="min-w-0 flex-1 rounded-xl border border-input bg-background/55 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-2 focus:ring-ring/15 disabled:opacity-60"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!trimmedMessage || isSending}
          aria-label={isSending ? "Sending message" : "Send message"}
          className="size-9 rounded-xl bg-primary text-primary-foreground hover:bg-violet-200"
        >
          {isSending ? <Loader className="animate-spin" /> : <SendHorizontal />}
        </Button>
      </form>
    </aside>
  );
}
