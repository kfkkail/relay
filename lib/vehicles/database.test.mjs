import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Embedded PostgreSQL exercises the real migrations and PL/pgSQL. Supabase's
// auth/storage schema and scheduler/network extensions are platform stubs here;
// CI's existing Supabase reset/lint/pgTAP workflow remains the integration gate.
let db;
const user = "00000000-0000-4000-8000-000000000081";
const other = "00000000-0000-4000-8000-000000000082";
const worker = "00000000-0000-4000-8000-000000000083";
const config = {
  make: "Rivian",
  model: "R1T",
  origin_zip: "46530",
  cost_ceiling: 70000,
  allowed_batteries: ["large", "max"],
};
let profile, schedule;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const scalar = async (sql, params = []) =>
  Object.values(await one(sql, params))[0];
const asUser = (id) =>
  db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create schema cron; create schema net; create schema vault;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_user::text$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text);
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    create function net.http_get(url text,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
  `);
  const root = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(root))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = (await readFile(new URL(name, root), "utf8")).replace(
      /create extension if not exists (?:pg_cron|pg_net|supabase_vault)[^;]*;/gi,
      "",
    );
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${name}: ${error.message}`, { cause: error });
    }
  }
  await db.query("insert into auth.users(id) values($1),($2)", [user, other]);
  await db.query(
    "insert into public.workers(id,user_id,name,token_hash) values($1,$2,'test-worker',repeat('a',64))",
    [worker, user],
  );
  await asUser(user);
  profile = await scalar("select public.save_vehicle_profile(null,$1::jsonb)", [
    JSON.stringify(config),
  ]);
  schedule = await scalar(
    "select schedule_id from public.vehicle_search_profiles where id=$1",
    [profile],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

async function claim() {
  await asUser(user);
  await db.query("select public.run_task_schedule($1,gen_random_uuid())", [
    schedule,
  ]);
  return await scalar("select public.claim_vehicle_run($1)", [worker]);
}
const listing = (vin = "7FCTGAAA0NN000001", price = 50000) => ({
  source: "auto.dev",
  source_listing_id: vin,
  vin,
  make: "Rivian",
  model: "R1T",
  price,
  attributes: { battery_pack: "large" },
  shipping: 0,
  mandatory_fees: 0,
  availability: "available",
  eligibility: "eligible",
});
async function finish(job, rows, status = "success", reported = rows.length) {
  await db.query("select public.stage_vehicle_batch($1,$2,$3,0,$4::jsonb)", [
    job.run.id,
    worker,
    job.run.lease,
    JSON.stringify(rows),
  ]);
  const health = {
    version: 1,
    source: "auto.dev",
    status,
    scope: config,
    counts: { parsed: rows.length, reported, invalid: 0, duplicates: 0 },
    warnings: [],
  };
  return scalar("select public.finalize_vehicle_run($1,$2,$3,$4::jsonb)", [
    job.run.id,
    worker,
    job.run.lease,
    JSON.stringify(health),
  ]);
}

describe.sequential("vehicle database invariants", () => {
  it("creates a disabled schedule and immutable profile revision", async () => {
    expect(
      await scalar("select enabled from public.task_schedules where id=$1", [
        schedule,
      ]),
    ).toBe(false);
    expect(
      await scalar(
        "select count(*)::integer from public.vehicle_profile_versions where profile_id=$1",
        [profile],
      ),
    ).toBe(1);
  });
  it("old workers cannot claim vehicle jobs; new jobs snapshot the profile", async () => {
    await db.query("select public.run_task_schedule($1,gen_random_uuid())", [
      schedule,
    ]);
    expect(
      (await db.query("select * from public.claim_next_run($1)", [worker]))
        .rows,
    ).toHaveLength(0);
    const job = await scalar("select public.claim_vehicle_run($1)", [worker]);
    expect(job.run.job_kind).toBe("vehicle_search");
    expect(job.profile).toEqual(config);
    const summary = await finish(job, [listing()]);
    expect(summary.imported).toBe(1);
    expect(
      await scalar("select status::text from public.tasks where id=$1", [
        job.task.id,
      ]),
    ).toBe("done");
  });
  it("repeated uploads/finalization do not duplicate inventory or observations", async () => {
    const job = await claim();
    const rows = [listing()];
    await db.query("select public.stage_vehicle_batch($1,$2,$3,0,$4::jsonb)", [
      job.run.id,
      worker,
      job.run.lease,
      JSON.stringify(rows),
    ]);
    const summary = await finish(job, rows);
    expect((await finishCompleted(job, rows)).imported).toBe(summary.imported);
    expect(await scalar("select count(*)::integer from public.vehicles")).toBe(
      1,
    );
    expect(
      await scalar(
        "select count(*)::integer from public.vehicle_listing_observations",
      ),
    ).toBe(1);
  });
  it("a passed VIN stays passed through seller and price changes", async () => {
    const id = await scalar("select id from public.vehicles limit 1");
    await db.query("select public.set_vehicle_decision($1,'passed',0)", [id]);
    await finish(await claim(), [
      { ...listing(undefined, 45000), seller: "New Dealer" },
    ]);
    expect(
      await scalar("select decision from public.vehicles where id=$1", [id]),
    ).toBe("passed");
    expect(await scalar("select count(*)::integer from public.vehicles")).toBe(
      1,
    );
    await expect(
      db.query("select public.set_vehicle_decision($1,'watch',0)", [id]),
    ).rejects.toThrow("Vehicle changed");
  });
  it("partial scans cannot make a missing listing unavailable", async () => {
    await finish(await claim(), [], "partial", 1);
    expect(
      await scalar(
        "select consecutive_absences from public.vehicle_listings limit 1",
      ),
    ).toBe(0);
    const last = await one(
      "select t.status::text from public.tasks t join public.runs r on r.task_id=t.id order by r.queued_at desc limit 1",
    );
    expect(last.status).toBe("waiting");
  });
  it("only two complete successful absences mark a listing unavailable", async () => {
    await finish(await claim(), []);
    expect(
      await scalar("select availability from public.vehicle_listings limit 1"),
    ).toBe("available");
    await finish(await claim(), []);
    expect(
      await scalar("select availability from public.vehicle_listings limit 1"),
    ).toBe("unavailable");
  });
  it("source count mismatches downgrade claimed success", async () => {
    const summary = await finish(await claim(), [listing()], "success", 5);
    expect(summary.status).toBe("partial");
  });
  it("recovers expired leases and rejects writes from the old lease", async () => {
    const job = await claim();
    await db.query(
      "update public.runs set vehicle_heartbeat_at=now()-interval '16 minutes' where id=$1",
      [job.run.id],
    );
    const recovered = await scalar("select public.claim_vehicle_run($1)", [
      worker,
    ]);
    expect(recovered.run.id).toBe(job.run.id);
    expect(recovered.run.lease).not.toBe(job.run.lease);
    await expect(
      db.query("select public.stage_vehicle_batch($1,$2,$3,0,'[]'::jsonb)", [
        job.run.id,
        worker,
        job.run.lease,
      ]),
    ).rejects.toThrow("Active vehicle run not found");
    await finish(recovered, [listing()]);
  });
  it("merges a passed provisional identity into its canonical VIN", async () => {
    const data = {
      ...listing(),
      source: "manual",
      source_listing_id: "manual-unknown",
      vin: null,
    };
    const provisional = await scalar(
      "select public.import_vehicle_listing($1::jsonb)",
      [JSON.stringify(data)],
    );
    await db.query("select public.set_vehicle_decision($1,'passed',0)", [
      provisional,
    ]);
    const canonical = await scalar("select public.confirm_vehicle_vin($1,$2)", [
      provisional,
      listing().vin,
    ]);
    expect(
      await scalar("select decision from public.vehicles where id=$1", [
        canonical,
      ]),
    ).toBe("passed");
    expect(await scalar("select count(*)::integer from public.vehicles")).toBe(
      1,
    );
    expect(
      await scalar(
        "select count(*)::integer from public.vehicle_listings where vehicle_id=$1",
        [canonical],
      ),
    ).toBe(2);
  });
  it("RLS hides another owner's vehicles and denies ingestion RPC access", async () => {
    await asUser(other);
    await db.exec("set role authenticated");
    try {
      expect(
        await scalar("select count(*)::integer from public.vehicles"),
      ).toBe(0);
      expect(
        await scalar(
          "select count(*)::integer from public.vehicle_search_profiles",
        ),
      ).toBe(0);
      await expect(
        db.query("select public.set_vehicle_decision($1,'watch',0)", [
          await knownVehicleId(),
        ]),
      ).rejects.toThrow();
      await expect(
        db.query("select public.claim_vehicle_run($1)", [worker]),
      ).rejects.toThrow("permission denied");
    } finally {
      await db.exec("reset role");
      await asUser(user);
    }
  });
});
async function finishCompleted(job, rows) {
  return scalar("select public.finalize_vehicle_run($1,$2,$3,$4::jsonb)", [
    job.run.id,
    worker,
    job.run.lease,
    JSON.stringify({
      status: "success",
      scope: config,
      counts: { parsed: rows.length },
    }),
  ]);
}
async function knownVehicleId() {
  return "00000000-0000-4000-8000-000000000099";
}
