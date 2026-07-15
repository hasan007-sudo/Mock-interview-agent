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
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-700/50 bg-[#0d1827] shadow-2xl shadow-black/30">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-700/40 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <MessageSquareText aria-hidden="true" className="size-4 text-sky-300" />
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Transcript</h2>
            <p className="text-[11px] text-slate-500">Interview conversation</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close transcript"
          className="rounded-full text-slate-400 hover:bg-slate-700/50 hover:text-slate-100"
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
            <div className="flex size-10 items-center justify-center rounded-full bg-slate-800 text-slate-400">
              <MessageSquareText aria-hidden="true" className="size-4" />
            </div>
            <p className="mt-3 text-sm font-medium text-slate-300">
              Conversation will appear here
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Spoken and typed messages from you and the interviewer are shown together.
            </p>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-center gap-2 border-t border-slate-700/40 p-3"
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
          className="min-w-0 flex-1 rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10 disabled:opacity-60"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!trimmedMessage || isSending}
          aria-label={isSending ? "Sending message" : "Send message"}
          className="size-9 rounded-xl bg-sky-400 text-slate-950 hover:bg-sky-300"
        >
          {isSending ? <Loader className="animate-spin" /> : <SendHorizontal />}
        </Button>
      </form>
    </aside>
  );
}
