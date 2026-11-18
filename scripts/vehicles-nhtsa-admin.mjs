import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { decodeNhtsa, freshNhtsa } from "../worker/vehicles/nhtsa.mjs";

// One-time operator backfill using the CLI's existing Management API login.
// Never prints/exports service keys or changes owner overrides/seller evidence.
const run = promisify(execFile);
const ref = process.argv[2];
if (!/^[a-z]{20}$/.test(ref ?? ""))
  throw new Error(
    "Usage: node scripts/vehicles-nhtsa-admin.mjs PROJECT_REF [--apply-schema]",
  );
async function query(sql) {
  const { stdout } = await run(
    "supabase",
    ["db", "query", "--linked", "--project-ref", ref, "--output", "json", sql],
    { timeout: 60000, maxBuffer: 8_000_000 },
  );
  const response = JSON.parse(stdout);
  const result = Array.isArray(response) ? response : response.rows;
  if (!Array.isArray(result))
    throw new Error("Unexpected Supabase query response.");
  return result;
}
const owners = await query(
  "select user_id, count(*)::integer as vehicles from public.vehicles group by user_id",
);
if (owners.length !== 1 || !/^[0-9a-f-]{36}$/i.test(owners[0].user_id))
  throw new Error(
    "Expected exactly one vehicle owner; select an explicit owner before backfilling a shared project.",
  );
const userId = owners[0].user_id;
if (process.argv.includes("--apply-schema")) {
  await run(
    "supabase",
    [
      "db",
      "query",
      "--linked",
      "--project-ref",
      ref,
      "--file",
      fileURLToPath(
        new URL(
          "../supabase/migrations/20261031030000_vehicle_nhtsa.sql",
          import.meta.url,
        ),
      ),
    ],
    { timeout: 60000 },
  );
}
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const total = {
  checked: 0,
  cached: 0,
  missing_vin: 0,
  failed: 0,
  changed: 0,
  motors: 0,
  named_batteries: 0,
  capacities: 0,
};
let cursor = "00000000-0000-0000-0000-000000000000";
for (;;) {
  const rows = await query(
    `select v.id,v.vin,v.nhtsa, (select min((l.data->>'year')::integer) from public.vehicle_listings l where l.vehicle_id=v.id and l.data->>'year' ~ '^[0-9]{4}$' having count(distinct l.data->>'year')=1) as year from public.vehicles v where v.user_id=${quote(userId)}::uuid and v.id>${quote(cursor)}::uuid order by v.id limit 25`,
  );
  if (!rows.length) break;
  const pending = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        if (!row.vin) {
          total.missing_vin++;
          continue;
        }
        if (freshNhtsa(row.nhtsa, row.vin)) {
          total.cached++;
          continue;
        }
        let decoded;
        try {
          decoded = await decodeNhtsa(row.vin, { year: row.year });
        } catch (error) {
          total.failed++;
          console.log(JSON.stringify({ vin: row.vin, error: error.message }));
          continue;
        }
        pending.push({ id: row.id, vin: row.vin, nhtsa: decoded });
      }
    }),
  );
  if (pending.length) {
    const result = await query(
      `update public.vehicles v set nhtsa=x.nhtsa from jsonb_to_recordset(${quote(JSON.stringify(pending))}::jsonb) as x(id uuid,vin text,nhtsa jsonb) where v.user_id=${quote(userId)}::uuid and v.id=x.id and v.vin=x.vin returning v.id`,
    );
    const saved = new Set(result.map((row) => row.id));
    total.checked += saved.size;
    total.changed += pending.length - saved.size;
    for (const item of pending.filter((row) => saved.has(row.id))) {
      if (item.nhtsa.attributes.motor) total.motors++;
      if (item.nhtsa.attributes.battery_pack) total.named_batteries++;
      if (item.nhtsa.battery_kwh !== null) total.capacities++;
    }
  }
  cursor = rows.at(-1).id;
  console.log(JSON.stringify(total));
}
console.log(JSON.stringify({ complete: true, ...total }));
if (total.failed) process.exitCode = 1;
