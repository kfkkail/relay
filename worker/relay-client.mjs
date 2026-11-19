export const RELAY_REQUEST_TIMEOUT_MS = 30_000;

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
      return {};
    }
  }

  return {
    request(path, init) {
      return send(path, init, async (response, signal) => {
        if (response.status === 204) return null;
        const body = await jsonBody(response, signal);
        if (!response.ok)
          throw new Error(
            body.error || `Relay returned HTTP ${response.status}.`,
          );
        return body;
      });
    },
    download(path) {
      return send(path, {}, async (response, signal) => {
        if (!response.ok) {
          const body = await jsonBody(response, signal);
          throw new Error(
            body.error ||
              `Relay could not download an attachment (HTTP ${response.status}).`,
          );
        }
        return Buffer.from(await response.arrayBuffer());
      });
    },
  };
}
