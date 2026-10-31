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
  it("fails an abandoned agent run so the owner can retry it", async () => {
    const task = await scalar(
      "insert into public.tasks(user_id,title,status,instructions) values($1,'Stale agent task','ready','test') returning id",
      [user],
    );
    await db.query(
      "insert into public.runs(task_id,user_id,attempt) values($1,$2,1)",
      [task, user],
    );
    const claimed = (
      await db.query("select * from public.claim_next_run($1)", [worker])
    ).rows[0];
    expect(claimed.task_id).toBe(task);
    await db.query(
      "update public.runs set agent_heartbeat_at=now()-interval '6 minutes' where id=$1",
      [claimed.run_id],
    );

    await asUser(user);
    expect(await scalar("select public.expire_stale_agent_runs()")).toBe(1);
    expect(
      await one(
        "select r.status::text run_status,t.status::text task_status,r.error from public.runs r join public.tasks t on t.id=r.task_id where r.id=$1",
        [claimed.run_id],
      ),
    ).toMatchObject({
      run_status: "failed",
      task_status: "waiting",
      error:
        "Worker heartbeat expired. Review any partial work, then try again.",
    });
    expect(
      await scalar(
        "select count(*)::integer from public.events where run_id=$1 and type='run.failed' and payload->>'reason'='heartbeat_expired'",
        [claimed.run_id],
      ),
    ).toBe(1);
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
describe.sequential("targeted vehicle enrichment", () => {
  let id, tid, job;
  const attrs = {
    battery_pack: "max",
    battery_evidence: "Seller page: Max Pack",
    motor: "quad",
    motor_evidence: "Seller page: Quad-Motor",
  };
  const requestDetail = () =>
    scalar("select public.request_vehicle_enrichment($1,$2)", [id, profile]);
  const complete = (target = job, attributes = attrs) =>
    db.query("select public.complete_vehicle_enrichment($1,$2,$3,$4::jsonb)", [
      target.run.id,
      worker,
      target.run.lease,
      JSON.stringify(attributes),
    ]);
  it("authorizes the owner and deduplicates requests while older workers skip them", async () => {
    await asUser(user);
    await db.query("select public.save_vehicle_profile($1,$2::jsonb)", [
      profile,
      JSON.stringify(config),
    ]);
    await finish(await claim(), [
      {
        ...listing("7FCTGAAA0NN000088"),
        url: "https://dealer.example/truck",
        attributes: {},
      },
    ]);
    id = await scalar(
      "select id from public.vehicles where vin='7FCTGAAA0NN000088'",
    );
    await expect(requestDetail()).rejects.toThrow("Interested or Shortlist");
    await db.query("select public.set_vehicle_decision($1,'watch',0)", [id]);
    await asUser(other);
    await expect(requestDetail()).rejects.toThrow();
    await asUser(user);
    tid = await requestDetail();
    expect(await requestDetail()).toBe(tid);
    expect(
      await scalar("select public.claim_vehicle_run($1)", [worker]),
    ).toBeNull();
    job = await scalar("select public.claim_vehicle_run($1,true)", [worker]);
    expect(job.task.id).toBe(tid);
    expect(job.run.job_payload.detail_vin).toBe("7FCTGAAA0NN000088");
    await db.exec("set role authenticated");
    try {
      await expect(complete()).rejects.toThrow("permission denied");
      await expect(
        db.query("select public.claim_vehicle_run($1,true)", [worker]),
      ).rejects.toThrow("permission denied");
    } finally {
      await db.exec("reset role");
    }
  });
  it("fences old leases, stores evidence idempotently, and leaves coverage, inventory and confirmations untouched", async () => {
    const before = await scalar(
      "select count(*)::int from public.vehicle_search_runs",
    );
    const snapshot = await scalar(
      "select data from public.vehicle_listings where vehicle_id=$1",
      [id],
    );
    await db.query("select public.verify_vehicle($1,$2::jsonb)", [
      id,
      JSON.stringify({
        attributes: {
          battery_pack: "large",
          motor: "dual",
          battery_evidence: "Owner verified",
        },
      }),
    ]);
    await db.query(
      "update public.runs set vehicle_heartbeat_at=now()-interval '16 minutes' where id=$1",
      [job.run.id],
    );
    const old = job;
    job = await scalar("select public.claim_vehicle_run($1,true)", [worker]);
    expect(job.run.lease).not.toBe(old.run.lease);
    await expect(complete(old)).rejects.toThrow("Enrichment run not found");
    await complete();
    await complete();
    const vehicle = await one(
      "select enrichment,overrides,decision from public.vehicles where id=$1",
      [id],
    );
    expect(vehicle.enrichment).toMatchObject({
      status: "resolved",
      attributes: attrs,
    });
    expect(vehicle.overrides.attributes.battery_pack).toBe("large");
    expect(vehicle.decision).toBe("watch");
    expect(
      await scalar(
        "select data from public.vehicle_listings where vehicle_id=$1",
        [id],
      ),
    ).toEqual(snapshot);
    expect(
      await scalar("select count(*)::int from public.vehicle_search_runs"),
    ).toBe(before);
    expect(
      await scalar(
        "select count(*)::int from public.push_deliveries where run_id=$1",
        [job.run.id],
      ),
    ).toBe(0);
    expect(
      await scalar("select status::text from public.tasks where id=$1", [tid]),
    ).toBe("done");
  });
  it("supports repeated manual checks and retains earlier evidence after unresolved or failed attempts", async () => {
    expect(await requestDetail()).not.toBe(tid);
    job = await scalar("select public.claim_vehicle_run($1,true)", [worker]);
    await complete(job, {});
    expect(
      await scalar(
        "select enrichment->>'status' from public.vehicles where id=$1",
        [id],
      ),
    ).toBe("unresolved");
    expect(
      await scalar(
        "select enrichment->'attributes' from public.vehicles where id=$1",
        [id],
      ),
    ).toEqual(attrs);
    await requestDetail();
    job = await scalar("select public.claim_vehicle_run($1,true)", [worker]);
    const count = await scalar(
      "select count(*)::int from public.vehicle_search_runs",
    );
    await db.query("select public.fail_vehicle_run($1,$2,$3)", [
      job.run.id,
      worker,
      job.run.lease,
    ]);
    await db.query("select public.fail_vehicle_run($1,$2,$3)", [
      job.run.id,
      worker,
      job.run.lease,
    ]);
    expect(
      await scalar(
        "select enrichment->>'status' from public.vehicles where id=$1",
        [id],
      ),
    ).toBe("failed");
    expect(
      await scalar("select count(*)::int from public.vehicle_search_runs"),
    ).toBe(count);
    expect(
      await scalar(
        "select count(*)::int from public.push_deliveries where run_id=$1",
        [job.run.id],
      ),
    ).toBe(0);
  });
  it("rejects stale seller-page results and refuses evidence without excerpts", async () => {
    await requestDetail();
    job = await scalar("select public.claim_vehicle_run($1,true)", [worker]);
    await db.query(
      "update public.vehicle_listings set data=jsonb_set(data,'{url}','\"https://dealer.example/new\"') where vehicle_id=$1",
      [id],
    );
    await expect(complete()).rejects.toThrow("Listing changed");
    await db.query("select public.fail_vehicle_run($1,$2,$3)", [
      job.run.id,
      worker,
      job.run.lease,
    ]);
    await requestDetail();
    job = await scalar("select public.claim_vehicle_run($1,true)", [worker]);
    await complete(job, { battery_pack: "standard", motor: "tri" });
    expect(
      await scalar(
        "select enrichment->>'status' from public.vehicles where id=$1",
        [id],
      ),
    ).toBe("unresolved");
    expect(
      await scalar(
        "select enrichment->'attributes' from public.vehicles where id=$1",
        [id],
      ),
    ).toEqual(attrs);
  });
});

describe("enrichment failure diagnostics", () => {
  it("keeps HTTP denials distinct, retains evidence, and fences stale/replayed reports", async () => {
    await asUser(user);
    const id = await scalar(
      "select id from public.vehicles where vin='7FCTGAAA0NN000088'",
    );
    const original = await one(
      "select enrichment,overrides,decision from public.vehicles where id=$1",
      [id],
    );
    const scans = await scalar(
      "select count(*)::int from public.vehicle_search_runs",
    );
    const task = await scalar(
      "select public.request_vehicle_enrichment($1,$2)",
      [id, profile],
    );
    const job = await scalar("select public.claim_vehicle_run($1,true)", [
      worker,
    ]);
    const fail = (lease = job.run.lease) =>
      db.query("select public.fail_vehicle_enrichment($1,$2,$3,$4::jsonb)", [
        job.run.id,
        worker,
        lease,
        JSON.stringify({
          code: "access_denied",
          host: "www.carvana.com",
          http_status: 403,
          response_body: "secret",
        }),
      ]);
    await expect(fail("00000000-0000-4000-8000-000000000099")).rejects.toThrow(
      "Enrichment run not found",
    );
    await db.exec("set role authenticated");
    try {
      await expect(fail()).rejects.toThrow("permission denied");
    } finally {
      await db.exec("reset role");
    }
    await fail();
    await fail();
    const current = await one(
      "select enrichment,overrides,decision from public.vehicles where id=$1",
      [id],
    );
    expect(current.enrichment).toMatchObject({
      status: "blocked",
      attributes: original.enrichment.attributes,
      failure: {
        code: "access_denied",
        host: "www.carvana.com",
        http_status: 403,
      },
    });
    expect(current.enrichment.failure).not.toHaveProperty("response_body");
    expect(current.overrides).toEqual(original.overrides);
    expect(current.decision).toBe(original.decision);
    expect(
      await scalar("select error from public.runs where id=$1", [job.run.id]),
    ).toBe("www.carvana.com: seller denied automated access (HTTP 403)");
    expect(
      await scalar("select status::text from public.tasks where id=$1", [task]),
    ).toBe("waiting");
    expect(
      await scalar("select count(*)::int from public.vehicle_search_runs"),
    ).toBe(scans);
    expect(
      await scalar(
        "select count(*)::int from public.push_deliveries where run_id=$1",
        [job.run.id],
      ),
    ).toBe(0);
    await scalar("select public.request_vehicle_enrichment($1,$2)", [
      id,
      profile,
    ]);
    expect(
      await scalar(
        "select enrichment ? 'failure' from public.vehicles where id=$1",
        [id],
      ),
    ).toBe(false);
    await fail();
    expect(
      await scalar(
        "select enrichment->>'status' from public.vehicles where id=$1",
        [id],
      ),
    ).toBe("queued");
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
