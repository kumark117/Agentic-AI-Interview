import { API_BASE } from "./api-base";
import { SessionEvent } from "./types";

export function connectSessionStream(
  sessionId: string,
  token: string,
  onEvent: (event: SessionEvent) => void,
  onError: () => void
): EventSource {
  const streamUrl = `${API_BASE}/sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`;
  const source = new EventSource(streamUrl);

  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as SessionEvent;
    onEvent(event);
  };

  source.onerror = () => {
    onError();
  };

  return source;
}
