export const RELAY_REQUEST_TIMEOUT_MS = 30_000;

export class RelayHttpError extends Error {
  constructor(message, status, retryAfterMs) {
    super(message);
    this.name = "RelayHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfter(response) {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

export function createRelayClient({
  relayUrl,
  workerToken,
  timeoutMs = RELAY_REQUEST_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  async function send(path, init, consume) {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, deadline.signal])
      : deadline.signal;
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${workerToken}`);
    if (!(init?.body instanceof FormData) && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    try {
      const response = await fetchImpl(`${relayUrl}${path}`, {
        ...init,
        headers,
        signal,
        redirect: "error",
      });
      // Keep the deadline active while reading the body as well as headers.
      return await consume(response, signal);
    } catch (error) {
      if (deadline.signal.aborted)
        throw new Error(
          `Relay request timed out after ${timeoutMs} milliseconds.`,
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function jsonBody(response, signal) {
    try {
      return await response.json();
    } catch (error) {
      if (signal.aborted) throw error;
      // A broken response stream is a connection failure, not a permanent
      // protocol mismatch. Keep it eligible for heartbeat recovery.
      if (response.ok && !(error instanceof SyntaxError)) throw error;
      if (response.ok)
        throw Object.assign(
          new Error(
            `Relay returned an invalid JSON response (HTTP ${response.status}). Check RELAY_URL and deployment access.`,
          ),
          { code: "INVALID_RELAY_RESPONSE" },
        );
      return {};
    }
  }

  return {
    request(path, init) {
      return send(path, init, async (response, signal) => {
        if (response.status === 204) return null;
        const body = await jsonBody(response, signal);
        if (!response.ok)
          throw new RelayHttpError(
            body?.error || `Relay returned HTTP ${response.status}.`,
            response.status,
            retryAfter(response),
          );
        return body;
      });
    },
    download(path, init = {}) {
      return send(path, init, async (response, signal) => {
        if (!response.ok) {
          const body = await jsonBody(response, signal);
          throw new RelayHttpError(
            body?.error ||
              `Relay could not download an attachment (HTTP ${response.status}).`,
            response.status,
            retryAfter(response),
          );
        }
        return Buffer.from(await response.arrayBuffer());
      });
    },
  };
}
