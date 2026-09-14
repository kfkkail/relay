// Store only an HTTP status (0 means unavailable), never provider response text.
export function deliveryUpdate(
  status: number,
  attempts: number,
  now = Date.now(),
) {
  const code =
    Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  const timestamp = new Date(now).toISOString();
  const delivered = code >= 200 && code < 300;
  const failed = !delivered && (attempts >= 6 || code === 404 || code === 410);
  return {
    last_status_code: code,
    ...(delivered
      ? { finished_at: timestamp, delivered_at: timestamp }
      : failed
        ? { finished_at: timestamp, failed_at: timestamp }
        : {
            available_at: new Date(
              now + Math.min(3600, 60 * 2 ** attempts) * 1000,
            ).toISOString(),
          }),
  };
}
