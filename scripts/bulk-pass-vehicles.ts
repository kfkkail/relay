import { createAdminClient } from "../lib/supabase/admin";
import { findBulkPassCandidates } from "../lib/vehicles/bulk-pass";
import type { VehicleRecord } from "../lib/vehicles/types";
import { parseVehicleProfile } from "../lib/vehicles/validation";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

type Options = {
  userEmail: string;
  profileId: string | null;
  maxScore: number;
  minDistanceMiles: number;
  apply: boolean;
  confirmCount: number | null;
};

function usage(message?: string, exitCode = 1): never {
  if (message) console.error(message);
  console.error(`
Usage:
  npm run vehicles:bulk-pass -- --user-email you@example.com [options]

Options:
  --max-score <0-100>       Maximum match score (default: 56)
  --min-distance <miles>    Minimum known distance (default: 500)
  --profile-id <uuid>       Required only when the user has multiple profiles
  --apply                   Apply the changes; omitted means dry-run
  --confirm-count <count>   Required with --apply; must match the live dry-run

Examples:
  npm run vehicles:bulk-pass -- --user-email you@example.com
  npm run vehicles:bulk-pass -- --user-email you@example.com --apply --confirm-count 116
`);
  process.exit(exitCode);
}

function numeric(value: string | undefined, name: string, max: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max)
    usage(`${name} must be an integer from 0 to ${max}.`);
  return number;
}

function options(argv: string[]): Options {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  if (argv.includes("--help")) usage(undefined, 0);
  const userEmail = value("--user-email")?.trim().toLowerCase() ?? "";
  if (!userEmail || !userEmail.includes("@"))
    usage("--user-email is required.");
  const apply = argv.includes("--apply");
  const confirm = value("--confirm-count");
  const confirmCount =
    confirm === undefined ? null : numeric(confirm, "--confirm-count", 10000);
  if (apply && confirmCount === null)
    usage("--apply requires --confirm-count from a fresh dry-run.");
  return {
    userEmail,
    profileId: value("--profile-id") ?? null,
    maxScore: numeric(value("--max-score") ?? "56", "--max-score", 100),
    minDistanceMiles: numeric(
      value("--min-distance") ?? "500",
      "--min-distance",
      10000,
    ),
    apply,
    confirmCount,
  };
}

async function userIdForEmail(
  supabase: ReturnType<typeof createAdminClient>,
  email: string,
) {
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email,
    );
    if (user) return user.id;
    if (data.users.length < 1000) break;
  }
  throw new Error(`No Supabase user found for ${email}.`);
}

async function main() {
  const opts = options(process.argv.slice(2));
  const supabase = createAdminClient();
  const userId = await userIdForEmail(supabase, opts.userEmail);
  let profileQuery = supabase
    .from("vehicle_search_profiles")
    .select("id,name,config")
    .eq("user_id", userId)
    .order("created_at");
  if (opts.profileId) profileQuery = profileQuery.eq("id", opts.profileId);
  const { data: profiles, error: profileError } = await profileQuery;
  if (profileError) throw profileError;
  if (profiles.length !== 1)
    throw new Error(
      profiles.length
        ? "Multiple vehicle profiles found; choose one with --profile-id."
        : "No matching vehicle profile found.",
    );

  const records: VehicleRecord[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await supabase
      .from("vehicles")
      .select(
        "*,vehicle_listings(id,data,photo_gallery,gallery_fetched_at,last_seen_at,availability)",
      )
      .eq("user_id", userId)
      .order("first_seen_at", { ascending: false })
      .order("id")
      .range(start, start + 499);
    if (error) throw error;
    records.push(...(data as VehicleRecord[]));
    if (data.length < 500) break;
  }

  const candidates = findBulkPassCandidates(
    records,
    parseVehicleProfile(profiles[0].config),
    opts,
  );
  console.table(
    candidates.map((candidate) => ({
      id: candidate.id,
      revision: candidate.revision,
      score: candidate.score,
      distance_miles: candidate.distance_miles,
      year: candidate.year,
      price: candidate.price,
      mileage: candidate.mileage,
      location: candidate.location,
      seller: candidate.seller,
    })),
  );
  console.log(
    `${candidates.length} candidate(s): needs verification, score <= ${opts.maxScore}, distance >= ${opts.minDistanceMiles} miles.`,
  );

  if (!opts.apply) {
    console.log(
      `Dry-run only. Re-run with --apply --confirm-count ${candidates.length} to pass this live candidate set.`,
    );
    return;
  }
  if (opts.confirmCount !== candidates.length)
    throw new Error(
      `Candidate count changed: expected ${opts.confirmCount}, found ${candidates.length}. Review a new dry-run before applying.`,
    );

  let updated = 0;
  const conflicts: string[] = [];
  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from("vehicles")
      .update({
        decision: "passed",
        decision_revision: candidate.revision + 1,
        decision_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("user_id", userId)
      .eq("decision", "unreviewed")
      .eq("decision_revision", candidate.revision)
      .select("id");
    if (error) throw error;
    if (data.length === 1) updated++;
    else conflicts.push(candidate.id);
  }
  console.log(`Passed ${updated} vehicle(s).`);
  if (conflicts.length)
    throw new Error(
      `${conflicts.length} vehicle(s) changed during the run and were not updated: ${conflicts.join(", ")}`,
    );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
