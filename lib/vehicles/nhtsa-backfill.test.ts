import { describe, expect, it, vi } from "vitest";
import { backfillNhtsa } from "./nhtsa-backfill";
import type { SupabaseClient } from "@supabase/supabase-js";
const vin = "7FCTGAAL6NN005487";
function database(rows: object[], changed = false, failed = false) {
  const writes: object[] = [];
  const filters: unknown[][] = [];
  const from = vi.fn(() => {
    let writing = false;
    const query = {
      select: () =>
        writing
          ? Promise.resolve({
              data: changed ? [] : [{ id: "vehicle" }],
              error: failed ? new Error("write failed") : null,
            })
          : query,
      eq: (...args: unknown[]) => {
        filters.push(args);
        return query;
      },
      gt: (...args: unknown[]) => {
        filters.push(args);
        return query;
      },
      order: () => query,
      limit: () => query,
      then: (resolve: (value: object) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
      update: (value: object) => {
        writing = true;
        writes.push(value);
        return query;
      },
    };
    return query;
  });
  return { db: { from } as unknown as SupabaseClient, writes, filters };
}
describe("owner-scoped NHTSA backfill", () => {
  it("uses an advancing keyset cursor, including cached pages", async () => {
    const nhtsa = {
      vin,
      status: "decoded",
      checked_at: new Date().toISOString(),
    };
    const rows = Array.from({ length: 10 }, (_, id) => ({
      id: `id-${id}`,
      vin,
      nhtsa,
    }));
    const { db, filters } = database(rows);
    expect(await backfillNhtsa(db, "owner", "previous")).toMatchObject({
      cached: 10,
      checked: 0,
      nextCursor: "id-9",
    });
    expect(filters).toContainEqual(["id", "previous"]);
  });
  it("includes all queues, skips missing/cached VINs, preserves other fields", async () => {
    const cached = {
      vin,
      status: "decoded",
      checked_at: new Date().toISOString(),
    };
    const { db, writes, filters } = database([
      { id: "one", vin, vehicle_listings: [{ data: { year: 2022 } }] },
      { id: "two", vin, nhtsa: cached },
      { id: "three", vin: null },
    ]);
    const decoded = { ...cached, attributes: { motor: "quad" } };
    const decode = vi.fn(async () => decoded) as unknown as Parameters<
      typeof backfillNhtsa
    >[3];
    expect(await backfillNhtsa(db, "owner", null, decode)).toEqual({
      checked: 1,
      cached: 1,
      missing_vin: 1,
      failed: 0,
      changed: 0,
      nextCursor: null,
    });
    expect(decode).toHaveBeenCalledWith(vin, { year: 2022 });
    expect(writes).toEqual([{ nhtsa: decoded }]);
    expect(filters).toContainEqual(["user_id", "owner"]);
    expect(filters).toContainEqual(["id", "one"]);
    expect(filters).toContainEqual(["vin", vin]);
  });
  it("does not overwrite prior evidence when decoding fails", async () => {
    const { db, writes } = database([{ id: "one", vin, vehicle_listings: [] }]);
    const decode = vi.fn(async () => {
      throw new Error("HTTP 429");
    });
    expect((await backfillNhtsa(db, "owner", null, decode)).failed).toBe(1);
    expect(writes).toEqual([]);
  });
  it("does not save onto a changed identity", async () => {
    const { db } = database([{ id: "one", vin, vehicle_listings: [] }], true);
    const decode = vi.fn(async () => ({})) as unknown as Parameters<
      typeof backfillNhtsa
    >[3];
    expect((await backfillNhtsa(db, "owner", null, decode)).changed).toBe(1);
  });
});
