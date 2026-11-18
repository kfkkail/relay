import { expect, it, vi } from "vitest";
import { runNhtsaBackfill } from "./nhtsa-backfill.mjs";
const cursor = "00000000-0000-4000-8000-000000000001";
const page = (nextCursor) => ({
  checked: 10,
  cached: 0,
  failed: 0,
  changed: 0,
  missing_vin: 0,
  nextCursor,
});
it("walks every page and accumulates results without provider credentials", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(page(cursor))
    .mockResolvedValueOnce({ ...page(null), checked: 2, cached: 3 });
  expect(await runNhtsaBackfill(request)).toMatchObject({
    checked: 12,
    cached: 3,
  });
  expect(request).toHaveBeenLastCalledWith(
    "/api/worker/vehicles/nhtsa",
    expect.objectContaining({
      body: JSON.stringify({ cursor }),
      signal: expect.any(AbortSignal),
    }),
  );
});
it("does not silently stop on malformed/repeated pagination", async () => {
  for (const response of [
    page(undefined),
    page("bad"),
    { ...page(null), checked: -1 },
  ])
    await expect(runNhtsaBackfill(async () => response)).rejects.toThrow();
  await expect(runNhtsaBackfill(async () => page(cursor))).rejects.toThrow(
    "did not advance",
  );
});
