export async function runNhtsaBackfill(
  relayRequest,
  { onProgress = () => {} } = {},
) {
  const total = {
    checked: 0,
    cached: 0,
    missing_vin: 0,
    failed: 0,
    changed: 0,
  };
  let cursor = null;
  const seen = new Set();
  do {
    const result = await relayRequest("/api/worker/vehicles/nhtsa", {
      method: "POST",
      body: JSON.stringify({ cursor }),
      signal: AbortSignal.timeout(55_000),
    });
    for (const field of Object.keys(total)) {
      if (!Number.isInteger(result?.[field]) || result[field] < 0)
        throw new Error("Invalid NHTSA backfill response.");
      total[field] += result[field];
    }
    cursor = result.nextCursor;
    if (
      cursor !== null &&
      (typeof cursor !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(cursor) ||
        seen.has(cursor))
    )
      throw new Error("NHTSA pagination did not advance.");
    seen.add(cursor);
    onProgress({ ...total });
  } while (cursor);
  return total;
}
