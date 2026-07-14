export const CONNECTION_STORAGE_KEY = "mock-interview-connection";

export type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

export function parseConnectionDetails(
  raw: string | null,
): ConnectionDetails | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.serverUrl === "string" &&
      typeof parsed?.roomName === "string" &&
      typeof parsed?.participantName === "string" &&
      typeof parsed?.participantToken === "string"
    ) {
      return parsed as ConnectionDetails;
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}
