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
async function enableSchedule(enabled = true) {
  return db.query(
    "select public.save_task_schedule(id,to_jsonb(s)||jsonb_build_object('enabled',$2::boolean)) from public.task_schedules s where id=$1",
    [schedule, enabled],
  );
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
    await expect(enableSchedule()).rejects.toThrow(
      "successful manual baseline",
    );
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
    const existing = await one(
      "select id,decision_revision from public.vehicles limit 1",
    );
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
        db.query("select public.set_vehicle_decision($1,'watch',$2)", [
          existing.id,
          existing.decision_revision,
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
  it("deduplicates requested photo jobs and completes them silently", async () => {
    const id = await scalar("select id from public.vehicles limit 1");
    const tid = await scalar("select public.request_vehicle_photos($1,$2)", [
      id,
      profile,
    ]);
    expect(
      await scalar("select public.request_vehicle_photos($1,$2)", [
        id,
        profile,
      ]),
    ).toBe(tid);
    const job = await scalar("select public.claim_vehicle_run($1)", [worker]);
    expect(job.run.job_payload.photo_vin).toBe(listing().vin);
    const photos = [
      { url: "https://example.com/main.jpg", category: "exterior" },
      { url: "https://example.com/cabin.jpg", category: "unknown" },
    ];
    await db.query(
      "select public.complete_vehicle_photos($1,$2,$3,$4::jsonb)",
      [job.run.id, worker, job.run.lease, JSON.stringify(photos)],
    );
    expect(
      await scalar("select status::text from public.tasks where id=$1", [tid]),
    ).toBe("done");
    expect(
      await scalar(
        "select jsonb_array_length(photo_gallery) from public.vehicle_listings where source='auto.dev'",
      ),
    ).toBe(2);
    expect(
      await scalar(
        "select gallery_fetched_at is not null from public.vehicle_listings where source='auto.dev'",
      ),
    ).toBe(true);
    const refresh = await claim();
    await finish(refresh, [listing()]);
    expect(
      await scalar(
        "select jsonb_array_length(photo_gallery) from public.vehicle_listings where source='auto.dev'",
      ),
    ).toBe(2);
    const key = `auto.dev:${listing().source_listing_id}`;
    await db.query("select public.verify_vehicle($1,$2::jsonb)", [
      id,
      JSON.stringify({
        listing_verifications: {
          [key]: {
            source: "auto.dev",
            source_listing_id: listing().source_listing_id,
            interior_photo: photos[1].url,
          },
        },
      }),
    ]);
    expect(
      await scalar(
        "select overrides->'listing_verifications'->$2->>'interior_photo' from public.vehicles where id=$1",
        [id, key],
      ),
    ).toBe(photos[1].url);
    expect(
      await scalar(
        "select count(*)::integer from public.push_deliveries where run_id=$1",
        [job.run.id],
      ),
    ).toBe(0);
  });
  it("worker failure discards staging and records a visible failed coverage result", async () => {
    const job = await claim();
    await db.query("select public.stage_vehicle_batch($1,$2,$3,0,$4::jsonb)", [
      job.run.id,
      worker,
      job.run.lease,
      JSON.stringify([listing("7FCTGAAA0NN000099")]),
    ]);
    await db.query("select public.fail_vehicle_run($1,$2,$3)", [
      job.run.id,
      worker,
      job.run.lease,
    ]);
    expect(
      await scalar(
        "select count(*)::integer from public.vehicle_ingestion_batches where run_id=$1",
        [job.run.id],
      ),
    ).toBe(0);
    expect(
      await scalar(
        "select count(*)::integer from public.vehicles where vin='7FCTGAAA0NN000099'",
      ),
    ).toBe(0);
    expect(
      await scalar(
        "select status from public.vehicle_search_runs where run_id=$1",
        [job.run.id],
      ),
    ).toBe("failed");
    expect(
      await scalar("select status::text from public.tasks where id=$1", [
        job.task.id,
      ]),
    ).toBe("waiting");
  });
  it("keeps optional photo failures out of inventory coverage and digests", async () => {
    const count = await scalar(
      "select count(*)::integer from public.vehicle_search_runs",
    );
    const id = await scalar("select id from public.vehicles where vin=$1", [
      listing().vin,
    ]);
    const tid = await scalar("select public.request_vehicle_photos($1,$2)", [
      id,
      profile,
    ]);
    const job = await scalar("select public.claim_vehicle_run($1)", [worker]);
    for (let i = 0; i < 2; i++) {
      await db.query("select public.fail_vehicle_run($1,$2,$3)", [
        job.run.id,
        worker,
        job.run.lease,
      ]);
    }
    expect(
      await scalar("select status::text from public.tasks where id=$1", [tid]),
    ).toBe("waiting");
    expect(
      await scalar("select status::text from public.runs where id=$1", [
        job.run.id,
      ]),
    ).toBe("failed");
    expect(
      await scalar("select count(*)::integer from public.vehicle_search_runs"),
    ).toBe(count);
    expect(
      await scalar(
        "select count(*)::integer from public.push_deliveries where run_id=$1",
        [job.run.id],
      ),
    ).toBe(0);
  });
  it("suppresses generic completion pushes and emits one idempotent material-failure digest", async () => {
    await db.query(
      "insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values($1,'https://example.test/push','test','test')",
      [user],
    );
    const quiet = await claim();
    await finish(quiet, [listing()]);
    expect(
      await scalar(
        "select count(*)::integer from public.push_deliveries where run_id=$1",
        [quiet.run.id],
      ),
    ).toBe(0);
    const partial = await claim();
    await finish(partial, [], "partial", 1);
    expect(
      await scalar(
        "select count(*)::integer from public.push_deliveries where run_id=$1",
        [partial.run.id],
      ),
    ).toBe(1);
    await finishCompleted(partial, []);
    expect(
      await scalar(
        "select count(*)::integer from public.push_deliveries where run_id=$1",
        [partial.run.id],
      ),
    ).toBe(1);
  });
  it("atomically merges listing verification and rejects a stale seller context", async () => {
    await asUser(user);
    const id = await scalar("select id from public.vehicles where vin=$1", [
      listing().vin,
    ]);
    const raw = {
      ...listing(),
      seller: "First dealer",
      seller_id: "dealer-1",
      url: "https://example.com/first",
      photos: [{ url: "https://example.com/cabin.jpg", category: "unknown" }],
    };
    await db.query(
      "update public.vehicle_listings set data=$1::jsonb where vehicle_id=$2 and source='auto.dev'",
      [JSON.stringify(raw), id],
    );
    const key = `auto.dev:${raw.source_listing_id}`;
    const context = {
      source: raw.source,
      source_listing_id: raw.source_listing_id,
      seller: raw.seller,
      seller_id: raw.seller_id,
      url: raw.url,
    };
    const verify = (patch) =>
      db.query("select public.verify_vehicle($1,$2::jsonb)", [
        id,
        JSON.stringify(patch),
      ]);
    await verify({
      title_status: "clean",
      listing_verifications: {
        [key]: {
          ...context,
          shipping: 1200,
          mandatory_fees: 250,
          delivery: "confirmed",
        },
      },
    });
    await verify({
      listing_verifications: {
        [key]: { ...context, interior_photo: raw.photos[0].url },
      },
    });
    let overrides = await scalar(
      "select overrides from public.vehicles where id=$1",
      [id],
    );
    expect(overrides.title_status).toBe("clean");
    expect(overrides.listing_verifications[key]).toMatchObject({
      shipping: 1200,
      mandatory_fees: 250,
      interior_photo: raw.photos[0].url,
    });
    const manual = {
      ...raw,
      source: "manual",
      source_listing_id: "another-seller",
      vin: null,
      seller: "Another dealer",
    };
    const provisional = await scalar(
      "select public.import_vehicle_listing($1::jsonb)",
      [JSON.stringify(manual)],
    );
    const manualKey = "manual:another-seller";
    const manualPatch = {
      listing_verifications: {
        [manualKey]: {
          source: manual.source,
          source_listing_id: manual.source_listing_id,
          seller: manual.seller,
          seller_id: manual.seller_id,
          url: manual.url,
          shipping: 0,
        },
      },
    };
    await db.query("select public.verify_vehicle($1,$2::jsonb)", [
      provisional,
      JSON.stringify(manualPatch),
    ]);
    await db.query("select public.confirm_vehicle_vin($1,$2)", [
      provisional,
      raw.vin,
    ]);
    overrides = await scalar(
      "select overrides from public.vehicles where id=$1",
      [id],
    );
    expect(overrides.listing_verifications[manualKey].shipping).toBe(0);
    expect(overrides.listing_verifications[key].shipping).toBe(1200);
    await expect(
      verify({
        listing_verifications: {
          [key]: {
            ...context,
            interior_photo: "https://example.com/not-in-gallery.jpg",
          },
        },
      }),
    ).rejects.toThrow("Photo changed");
    await db.query(
      "update public.vehicle_listings set data=jsonb_set(data,'{seller}','\"New seller\"') where vehicle_id=$1 and source='auto.dev'",
      [id],
    );
    await expect(
      verify({ listing_verifications: { [key]: { ...context, shipping: 0 } } }),
    ).rejects.toThrow("Listing changed");
    await verify({
      listing_verifications: {
        [key]: {
          ...context,
          seller: "New seller",
          interior_photo: raw.photos[0].url,
        },
      },
    });
    overrides = await scalar(
      "select overrides from public.vehicles where id=$1",
      [id],
    );
    expect(overrides.listing_verifications[key].shipping).toBeUndefined();
    expect(overrides.listing_verifications[key].interior_photo).toBe(
      raw.photos[0].url,
    );
    await asUser(other);
    await expect(verify({ title_status: "clean" })).rejects.toThrow(
      "Vehicle not found",
    );
    await asUser(user);
  });
  it("requires a scope-matching baseline even through shared Schedules", async () => {
    await enableSchedule();
    await db.query("select public.save_vehicle_profile($1,$2::jsonb)", [
      profile,
      JSON.stringify({ ...config, cost_ceiling: 65000 }),
    ]);
    expect(
      await scalar("select enabled from public.task_schedules where id=$1", [
        schedule,
      ]),
    ).toBe(true);
    // Each collection dimension invalidates the old baseline, but a newly
    // successful enumeration of that scope authorizes an explicit enable.
    for (const patch of [
      { origin_zip: "90210" },
      { model: "R1S" },
      { make: "Ford", model: "F-150" },
    ]) {
      const changed = { ...config, ...patch };
      await db.query("select public.save_vehicle_profile($1,$2::jsonb)", [
        profile,
        JSON.stringify(changed),
      ]);
      expect(
        await scalar("select enabled from public.task_schedules where id=$1", [
          schedule,
        ]),
      ).toBe(false);
      await expect(enableSchedule()).rejects.toThrow(
        "successful manual baseline",
      );
      const job = await claim();
      await db.query("select public.finalize_vehicle_run($1,$2,$3,$4::jsonb)", [
        job.run.id,
        worker,
        job.run.lease,
        JSON.stringify({
          status: "success",
          scope: changed,
          counts: { parsed: 0, reported: 0, invalid: 0, duplicates: 0 },
          warnings: [],
        }),
      ]);
      await enableSchedule();
    }
    await enableSchedule(false);
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
