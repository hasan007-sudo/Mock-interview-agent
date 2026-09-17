import { LogLevel, PipecatClient } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";

export type WorkspaceRequestPayload = {
  type: "workspace-request";
  requestId?: string;
  eventId?: string;
  method: string;
  action: string;
  payload: Record<string, unknown>;
};

export type WorkspaceResultPayload = {
  requestId: string;
  result?: Record<string, unknown>;
  error?: string;
};

export function createPipecatClient(options: {
  serverUrl: string;
  requestData?: Record<string, unknown>;
}): PipecatClient {
  const transport = new SmallWebRTCTransport();

  const client = new PipecatClient({
    transport,
    enableMic: true,
    enableCam: true,
  });
  client.setLogLevel(LogLevel.DEBUG);
  return client;
}

export function getConnectParams(options: {
  serverUrl: string;
  requestData?: Record<string, unknown>;
}) {
  const endpoint = options.serverUrl.endsWith("/api/offer")
    ? options.serverUrl
    : `${options.serverUrl.replace(/\/$/, "")}/api/offer`;
  return {
    webrtcRequestParams: {
      endpoint,
      requestData: options.requestData,
    },
  };
}

export async function sendWorkspaceResult(
  client: PipecatClient,
  requestId: string,
  result: Record<string, unknown> = { ok: true },
): Promise<void> {
  await client.sendClientMessage("workspace-result", {
    requestId,
    result,
  });
}

export async function sendWorkspaceError(
  client: PipecatClient,
  requestId: string,
  error: string,
): Promise<void> {
  await client.sendClientMessage("workspace-result", {
    requestId,
    error,
  });
}

export async function sendMcqAnswer(
  client: PipecatClient,
  payload: {
    questionId: string;
    optionIndex: number;
    optionText: string;
    submitted: boolean;
  },
): Promise<void> {
  await client.sendClientMessage("mcq-answer", payload);
}

export async function sendCodeAnswer(
  client: PipecatClient,
  payload: {
    questionId: string;
    surface: string;
    answerMode: string;
    language: string;
    code: string;
    revision: number;
    submitted: boolean;
  },
): Promise<void> {
  await client.sendClientMessage("code-answer", payload);
}
