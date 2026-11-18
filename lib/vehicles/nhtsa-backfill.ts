import { decodeNhtsa, freshNhtsa } from "../../worker/vehicles/nhtsa.mjs";
import type { SupabaseClient } from "@supabase/supabase-js";

// Keyset pagination includes every review queue and unavailable/manual listings.
// Every update rechecks ownership and VIN, so a concurrent identity merge wins.
export async function backfillNhtsa(
  supabase: SupabaseClient,
  userId: string,
  cursor: string | null,
  decode = decodeNhtsa,
) {
  let query = supabase
    .from("vehicles")
    .select("id,vin,nhtsa,vehicle_listings(data)")
    .eq("user_id", userId)
    .order("id")
    .limit(10);
  if (cursor) query = query.gt("id", cursor);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const counts = {
    checked: 0,
    cached: 0,
    missing_vin: 0,
    failed: 0,
    changed: 0,
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, rows.length) }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        if (!row.vin) {
          counts.missing_vin++;
          continue;
        }
        if (freshNhtsa(row.nhtsa, row.vin)) {
          counts.cached++;
          continue;
        }
        let result;
        try {
          const years = [
            ...new Set(
              row.vehicle_listings
                .map((l: { data: { year?: number } }) => l.data?.year)
                .filter(Boolean),
            ),
          ];
          result = await decode(row.vin, {
            year: years.length === 1 ? years[0] : undefined,
          });
        } catch {
          counts.failed++;
          continue;
        }
        const saved = await supabase
          .from("vehicles")
          .update({ nhtsa: result })
          .eq("user_id", userId)
          .eq("id", row.id)
          .eq("vin", row.vin)
          .select("id");
        if (saved.error) throw saved.error;
        if (saved.data?.length) counts.checked++;
        else counts.changed++;
      }
    }),
  );
  return { ...counts, nextCursor: rows.length === 10 ? rows.at(-1)!.id : null };
}
