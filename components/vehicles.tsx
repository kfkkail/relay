"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CarFront,
  Play,
  RefreshCw,
  X,
  Plus,
  ArrowUpRight,
  Eye,
  Check,
  ChevronDown,
  MapPin,
  Gauge,
  SlidersHorizontal,
  Activity,
} from "lucide-react";
import { RelayHeader } from "@/components/relay-header";
import { defaultVehicleProfile } from "@/lib/vehicles/domain";
import { inVehicleQueue, reviewVehicle } from "@/lib/vehicles/review";
import type {
  Decision,
  VehicleListing,
  VehicleProfile,
  VehicleRecord,
} from "@/lib/vehicles/types";

type Profile = {
  id: string;
  version: number;
  config: VehicleProfile;
  schedule_id: string;
  task_schedules: {
    enabled: boolean;
    next_due_at: string;
    timezone: string;
    start_minute?: number;
  };
};
type HealthRun = {
  run_id: string;
  status: string;
  finished_at: string;
  health: { counts: Record<string, number>; warnings: string[] };
  summary: Record<string, number>;
};
type Reviewed = NonNullable<ReturnType<typeof reviewVehicle>>;
const queues = {
  unreviewed: "Unreviewed",
  verification: "Needs Verification",
  watch: "Watch",
  shortlist: "Shortlist",
  passed: "Passed",
  coverage: "Coverage Health",
  settings: "Settings",
};
const money = (n: number | null) =>
  n === null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);
export type VehicleRequest = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;
async function vehicleAction(request: VehicleRequest, body: object) {
  const response = await request("/api/vehicles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Vehicle update failed.");
  return result.result;
}

export function Vehicles({
  userEmail,
  request = fetch,
  preview = false,
}: {
  userEmail: string;
  request?: VehicleRequest;
  preview?: boolean;
}) {
  const action = (body: object) => vehicleAction(request, body);
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [records, setRecords] = useState<VehicleRecord[]>([]),
    [runs, setRuns] = useState<HealthRun[]>([]);
  const [pending, setPending] = useState<
    { id: string; status: string; queued_at: string }[]
  >([]);
  const [queue, setQueue] = useState("unreviewed"),
    [sort, setSort] = useState("score"),
    [shown, setShown] = useState(25);
  const [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Reviewed | null>(null),
    [importing, setImporting] = useState(false),
    [gallery, setGallery] = useState<
      (VehicleListing & { vehicleId: string }) | null
    >(null);
  const [undo, setUndo] = useState<{
    id: string;
    decision: Decision;
    revision: number;
  } | null>(null);
  const profile = profiles[0];
  const galleryFocus = useVehicleModal(Boolean(gallery), () =>
    setGallery(null),
  );
  const config = profile?.config ?? defaultVehicleProfile;
  const refresh = useCallback(async () => {
    const all: VehicleRecord[] = [];
    let page = 0;
    while (page < 10) {
      const response = await request(`/api/vehicles?page=${page}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not load vehicles.");
      if (page === 0) {
        setProfiles(body.profiles);
        setRuns(body.runs);
        setPending(body.pending ?? []);
      }
      all.push(...body.vehicles);
      page++;
      if (all.length >= body.total || !body.vehicles.length) break;
      if (page === 10)
        setNotice(
          "Showing the first 5,000 stored vehicles. Older records remain stored.",
        );
    }
    setRecords(all);
    setLoaded(true);
  }, [request]);
  useEffect(() => {
    if (!pending.length) return;
    const timer = setTimeout(() => {
      void refresh().catch((e) => setError(e.message));
    }, 15000);
    return () => clearTimeout(timer);
  }, [pending, refresh]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const saved = sessionStorage.getItem("relay-vehicle-review");
      if (saved) {
        try {
          const state = JSON.parse(saved);
          if (state.queue in queues) setQueue(state.queue);
          if (Number.isInteger(state.shown))
            setShown(Math.max(25, state.shown));
        } catch {
          /* Ignore stale session state. */
        }
      }
      void refresh().catch((e) => setError(e.message));
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    if (loaded)
      sessionStorage.setItem(
        "relay-vehicle-review",
        JSON.stringify({ queue, shown }),
      );
  }, [queue, shown, loaded]);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(timer);
  }, [undo]);
  const vehicles = useMemo(
    () =>
      records.flatMap((v) => {
        const row = reviewVehicle(v, config);
        return row ? [row] : [];
      }),
    [records, config],
  );
  const filtered = useMemo(
    () =>
      vehicles
        .filter((v) => inVehicleQueue(v, queue))
        .sort((a, b) => {
          if (sort === "price")
            return (
              (a.evaluation.effective_cost ?? a.row.price ?? Infinity) -
              (b.evaluation.effective_cost ?? b.row.price ?? Infinity)
            );
          if (sort === "mileage")
            return (a.row.mileage ?? Infinity) - (b.row.mileage ?? Infinity);
          if (sort === "distance")
            return (
              (a.evaluation.distance_miles ?? Infinity) -
              (b.evaluation.distance_miles ?? Infinity)
            );
          if (sort === "newest")
            return b.first_seen_at.localeCompare(a.first_seen_at);
          return (
            b.evaluation.score - a.evaluation.score ||
            b.first_seen_at.localeCompare(a.first_seen_at)
          );
        }),
    [vehicles, queue, sort],
  );
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vehicle action failed.");
    } finally {
      setBusy(false);
    }
  }
  async function decide(v: VehicleRecord, decision: Decision) {
    await perform(async () => {
      const revision = await action({
        action: "decision",
        id: v.id,
        decision,
        revision: v.decision_revision,
      });
      setRecords((rows) =>
        rows.map((row) =>
          row.id === v.id
            ? { ...row, decision, decision_revision: revision }
            : row,
        ),
      );
      setUndo({ id: v.id, decision: v.decision, revision });
    });
  }
  function chooseQueue(next: string) {
    setQueue(next);
    setShown(25);
    setNotice("");
  }
  return (
    <main className="app-shell vehicles-page">
      <RelayHeader userEmail={userEmail} preview={preview} />
      <section className="vehicles-content">
        {preview && (
          <p className="vehicle-preview-notice" role="note">
            Interactive sample · No live listings, API requests or worker jobs.
            Changes reset on reload.
          </p>
        )}
        <div className="vehicles-heading">
          <div>
            <p className="eyebrow">Your relay</p>
            <h1>Vehicles</h1>
            <p>
              {config.make} {config.model} · Nationwide · From{" "}
              {config.origin_zip}
            </p>
          </div>
          <div className="vehicle-actions">
            <button
              className="icon-button"
              disabled={busy}
              onClick={() => void perform(refresh)}
              aria-label="Refresh vehicles"
            >
              <RefreshCw size={18} />
            </button>
            {profile && (
              <button
                className="secondary-button compact"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    if (preview) {
                      setNotice(
                        "This interactive sample does not run live searches or contact your workers.",
                      );
                      return;
                    }
                    await action({
                      action: "run",
                      scheduleId: profile.schedule_id,
                      requestId: crypto.randomUUID(),
                    });
                    setNotice(
                      "Search queued. Your connected vehicle worker will collect it.",
                    );
                    await refresh();
                  })
                }
              >
                <Play size={16} /> Run Now
              </button>
            )}
          </div>
        </div>
        {pending.length > 0 && (
          <p className="vehicle-note" role="status">
            {pending.length} vehicle job{pending.length === 1 ? "" : "s"}{" "}
            {pending.some((job) => job.status === "working")
              ? "collecting"
              : "queued for a compatible worker"}
            . Results refresh automatically.
          </p>
        )}
        <div className="vehicle-navigation">
          <nav
            className="filter-strip vehicle-queues"
            aria-label="Vehicle queues"
          >
            {Object.entries(queues)
              .filter(([key]) => !["coverage", "settings"].includes(key))
              .map(([key, label]) => (
                <button
                  key={key}
                  className={queue === key ? "active" : ""}
                  aria-current={queue === key ? "page" : undefined}
                  onClick={(event) => {
                    chooseQueue(key);
                    event.currentTarget.scrollIntoView({
                      block: "nearest",
                      inline: "nearest",
                    });
                  }}
                >
                  {label}
                  {!["coverage", "settings"].includes(key) && (
                    <span>
                      {vehicles.filter((v) => inVehicleQueue(v, key)).length}
                    </span>
                  )}
                </button>
              ))}
          </nav>
          <label className="vehicle-mobile-queue">
            Review queue
            <select
              value={queue === "settings" || queue === "coverage" ? "" : queue}
              onChange={(event) => chooseQueue(event.target.value)}
            >
              <option value="" disabled>
                Choose a queue
              </option>
              {Object.entries(queues)
                .filter(([key]) => !["coverage", "settings"].includes(key))
                .map(([key, label]) => (
                  <option value={key} key={key}>
                    {label} (
                    {
                      vehicles.filter((vehicle) => inVehicleQueue(vehicle, key))
                        .length
                    }
                    )
                  </option>
                ))}
            </select>
          </label>
          <nav className="vehicle-utilities" aria-label="Search tools">
            <button
              className="vehicle-text-button"
              aria-current={queue === "coverage" ? "page" : undefined}
              onClick={() => chooseQueue("coverage")}
            >
              <Activity size={15} aria-hidden />
              Coverage Health
            </button>
            <button
              className="vehicle-text-button"
              aria-current={queue === "settings" ? "page" : undefined}
              onClick={() => chooseQueue("settings")}
            >
              <SlidersHorizontal size={15} aria-hidden />
              Search settings
            </button>
          </nav>
        </div>
        {error && (
          <p className="vehicle-alert" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="vehicle-note">
            {notice}
          </p>
        )}
        {!loaded && !error && <p role="status">Loading your vehicles…</p>}
        {loaded && !profile && (
          <section className="vehicle-empty">
            <h2>Make this search yours</h2>
            <p>
              Start with the editable Rivian R1T profile: Large or Max battery,
              nationwide, up to $70,000 effective cost. Daily collection starts
              disabled.
            </p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await action({ action: "profile" });
                  await refresh();
                })
              }
            >
              Create vehicle search
            </button>
          </section>
        )}
        {profile && queue === "settings" && (
          <VehicleSettings
            key={profile.version}
            profile={profile}
            busy={busy}
            save={(value) =>
              perform(async () => {
                await action({
                  action: "profile",
                  id: profile.id,
                  config: value,
                });
                await refresh();
                setNotice(
                  "Profile saved. Your review queues now use the updated requirements.",
                );
              })
            }
            schedule={() =>
              perform(async () => {
                await action({
                  action: "schedule",
                  id: profile.schedule_id,
                  enabled: !profile.task_schedules.enabled,
                });
                await refresh();
              })
            }
          />
        )}
        {queue === "coverage" && (
          <section className="vehicle-health">
            <h2>Coverage Health</h2>
            <p>
              Auto.dev supplies the initial inventory. Dealer names and
              destination links identify observed coverage; they do not
              establish complete coverage of those marketplaces.
            </p>
            {!runs.length && (
              <p>
                No completed scans yet. Run a manual search to establish a
                baseline.
              </p>
            )}
            {runs.map((run) => (
              <article className="vehicle-card" key={run.run_id}>
                <h3>{run.status.toUpperCase()} · Auto.dev</h3>
                <p>{new Date(run.finished_at).toLocaleString()}</p>
                <dl>
                  {Object.entries(run.health.counts).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{value ?? "Unknown"}</dd>
                    </div>
                  ))}
                </dl>
                {run.health.warnings?.length > 0 && (
                  <p className="vehicle-alert">
                    {run.health.warnings.join(", ")}
                  </p>
                )}
                <small>Run {run.run_id}</small>
              </article>
            ))}
          </section>
        )}
        {profile && !["settings", "coverage"].includes(queue) && (
          <>
            <div className="vehicle-toolbar">
              <p className="vehicle-result-count">
                {filtered.length} vehicle{filtered.length === 1 ? "" : "s"}
                <span className="vehicle-count-shown">
                  {" "}
                  · showing {Math.min(shown, filtered.length)}
                </span>
                <span>Swipe left to pass, right to watch</span>
              </p>
              <label>
                Sort{" "}
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="score">Best match</option>
                  <option value="newest">Newest discovered</option>
                  <option value="price">Lowest effective cost</option>
                  <option value="mileage">Lowest mileage</option>
                  <option value="distance">Nearest</option>
                </select>
              </label>
              <button
                className="secondary-button compact"
                aria-label="Add listing"
                onClick={() => setImporting(true)}
              >
                <Plus size={16} aria-hidden />
                <span className="vehicle-add-label">Add listing</span>
              </button>
            </div>
            {!filtered.length && (
              <section className="vehicle-empty">
                <h2>
                  {queue === "unreviewed"
                    ? "Your queue is clear"
                    : "Nothing here yet"}
                </h2>
                <p>
                  {queue === "unreviewed"
                    ? "Run a search or check Needs Verification for vehicles whose required battery is still unknown."
                    : "Vehicles will appear here as you review them."}
                </p>
              </section>
            )}
            <div className="vehicle-grid">
              {filtered.slice(0, shown).map((v) => (
                <VehicleCard
                  key={v.id}
                  vehicle={v}
                  busy={busy}
                  decide={(decision) => void decide(v, decision)}
                  verify={() => setEditing(v)}
                  gallery={() => setGallery({ ...v.row, vehicleId: v.id })}
                />
              ))}
            </div>
            {shown < filtered.length && (
              <button
                className="secondary-button vehicle-load-more"
                onClick={() => setShown(shown + 25)}
              >
                Review next 25
              </button>
            )}
          </>
        )}
      </section>
      {undo && (
        <div className="vehicle-undo" role="status">
          <Check size={17} aria-hidden />
          <span>Decision saved</span>{" "}
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const revision = await action({
                  action: "decision",
                  id: undo.id,
                  decision: undo.decision,
                  revision: undo.revision,
                });
                setRecords((rows) =>
                  rows.map((v) =>
                    v.id === undo.id
                      ? {
                          ...v,
                          decision: undo.decision,
                          decision_revision: revision,
                        }
                      : v,
                  ),
                );
                setUndo(null);
              })
            }
          >
            Undo
          </button>
        </div>
      )}
      {(editing || importing) && (
        <VehicleEditor
          vehicle={editing}
          config={config}
          busy={busy}
          close={() => {
            setEditing(null);
            setImporting(false);
          }}
          save={(listing) =>
            perform(async () => {
              if (editing) {
                await action({ action: "verify", id: editing.id, listing });
                if (!editing.vin && listing.vin)
                  await action({
                    action: "vin",
                    id: editing.id,
                    vin: listing.vin,
                  });
              } else await action({ action: "manual", listing });
              await refresh();
              setEditing(null);
              setImporting(false);
            })
          }
        />
      )}
      {gallery && (
        <div
          ref={galleryFocus}
          className="vehicle-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Vehicle photos"
        >
          <section>
            <button
              autoFocus
              className="icon-button"
              onClick={() => setGallery(null)}
              aria-label="Close gallery"
            >
              <X />
            </button>
            <h2>Listing photos</h2>
            {gallery.url && (
              <a href={gallery.url} target="_blank" rel="noreferrer">
                Open original listing
              </a>
            )}
            <p>
              {preview
                ? "Illustrative sample photography. Choose the interior photo you want on the review card."
                : "Load the gallery on your worker, then choose the interior photo you want on the review card."}
            </p>
            {profile && gallery.vin && !preview && (
              <button
                className="secondary-button compact"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await action({
                      action: "photos",
                      id: gallery.vehicleId,
                      profileId: profile.id,
                    });
                    await refresh();
                    setNotice(
                      "Photo gallery queued. Refresh when your worker finishes, then reopen the gallery.",
                    );
                    setGallery(null);
                  })
                }
              >
                Load photos from Auto.dev
              </button>
            )}
            {gallery.photos.map((photo) => (
              <div key={photo.url}>
                <VehicleImage
                  url={photo.url}
                  alt={`${photo.category} listing photo`}
                />
                <button
                  className="secondary-button compact"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const updated = {
                        ...gallery,
                        photos: gallery.photos.map((item) => ({
                          ...item,
                          category:
                            item.url === photo.url
                              ? ("interior" as const)
                              : item.category === "interior"
                                ? ("unknown" as const)
                                : item.category,
                        })),
                      };
                      await action({
                        action: "interior_photo",
                        id: gallery.vehicleId,
                        listing: gallery,
                        photoUrl: photo.url,
                      });
                      await refresh();
                      setGallery(updated);
                    })
                  }
                >
                  Use as interior photo
                </button>
              </div>
            ))}
          </section>
        </div>
      )}
    </main>
  );
}

function VehicleImage({ url, alt }: { url?: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  // Source-hosted listing photos have varying hosts and expiry. Preserve the
  // original URL without proxying through Relay, and fall back when it expires.
  return url && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      draggable={false}
      src={url}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="vehicle-photo-placeholder">
      <CarFront size={32} />
      <span>{alt} unavailable</span>
    </div>
  );
}

export function VehicleCard({
  vehicle: v,
  busy,
  decide,
  verify,
  gallery,
}: {
  vehicle: Reviewed;
  busy: boolean;
  decide: (decision: Decision) => void;
  verify: () => void;
  gallery: () => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const row = v.row,
    ev = v.evaluation;
  return (
    <article
      className="vehicle-card"
      style={{ touchAction: "pan-y" }}
      onPointerDown={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "button:not(.vehicle-photo-pair),a,input,select,details",
          )
        )
          return;
        swiped.current = false;
        start.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const origin = start.current;
        start.current = null;
        if (!origin || busy || Math.abs(event.clientY - origin.y) > 60) return;
        const dx = event.clientX - origin.x;
        if (Math.abs(dx) > 100 && v.decision !== "passed") {
          swiped.current = true;
          decide(dx < 0 ? "passed" : "watch");
        }
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    >
      <button
        className="vehicle-photo-pair"
        onClick={() => {
          if (!swiped.current) gallery();
        }}
        aria-label="View listing photos"
      >
        <span className="vehicle-exterior">
          <VehicleImage url={row.photos[0]?.url} alt="Exterior" />
        </span>
        <span className="vehicle-interior">
          <VehicleImage
            url={row.photos.find((photo) => photo.category === "interior")?.url}
            alt="Interior"
          />
          <span>Interior</span>
        </span>
        <span className="vehicle-photo-label">
          <Eye size={14} aria-hidden />
          View photos
        </span>
      </button>
      <div className="vehicle-card-body">
        <div className="vehicle-card-title">
          <h2>
            {row.year} {row.make} {row.model}
          </h2>
          <span
            className="vehicle-score"
            title="Match score; see details for the breakdown"
          >
            {ev.score}/100 match
          </span>
        </div>
        <p className="vehicle-configuration">
          {[
            row.trim,
            row.attributes.battery_pack
              ? `${row.attributes.battery_pack} battery`
              : "Battery unverified",
            row.attributes.motor ? `${row.attributes.motor} motor` : null,
            !row.attributes.motor ? "Motor unverified (optional)" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="vehicle-price">
          <div>
            <span>Asking price</span>
            <strong>{money(row.price)}</strong>
          </div>
          <div className="vehicle-total">
            <span>With shipping &amp; fees</span>
            <strong>
              {ev.effective_cost === null
                ? "Not yet verified"
                : money(ev.effective_cost)}
            </strong>
          </div>
        </div>
        <div className="vehicle-facts">
          <span>
            <Gauge size={15} aria-hidden />
            {row.mileage === null
              ? "Mileage unknown"
              : `${row.mileage.toLocaleString()} miles`}
          </span>
          <span>
            <MapPin size={15} aria-hidden />
            {[row.city, row.state].filter(Boolean).join(", ") ||
              "Location unknown"}
          </span>
        </div>
        <div className="vehicle-seller">
          <span>
            {row.seller || "Seller unverified"}
            <small>
              {ev.delivery_group}
              {ev.distance_miles === null
                ? ""
                : ` · ${ev.distance_miles.toLocaleString()} mi away`}
            </small>
          </span>
          {row.url && (
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer"
              aria-label="Open original listing"
            >
              Listing
              <ArrowUpRight size={14} aria-hidden />
            </a>
          )}
        </div>
        {ev.eligibility !== "eligible" && (
          <div className="vehicle-note">
            <strong>
              {v.decision === "watch" || v.decision === "shortlist"
                ? "No longer matches / needs verification"
                : "Needs attention"}
            </strong>
            <p>{ev.reasons.join(" · ")}</p>
            <button
              className="vehicle-text-button"
              disabled={busy}
              onClick={verify}
            >
              Verify
              <ArrowUpRight size={14} aria-hidden />
            </button>
          </div>
        )}
        <details className="vehicle-details">
          <summary>
            Details &amp; sources
            <ChevronDown size={15} aria-hidden />
          </summary>
          <dl>
            <div>
              <dt>Shipping</dt>
              <dd>
                {row.delivery === "pickup"
                  ? "Pickup selected"
                  : money(row.shipping)}
              </dd>
            </div>
            <div>
              <dt>Mandatory fees</dt>
              <dd>{money(row.mandatory_fees)}</dd>
            </div>
            <div>
              <dt>Condition</dt>
              <dd>{row.condition || "Unknown"}</dd>
            </div>
            <div>
              <dt>VIN</dt>
              <dd>{v.vin ?? "Unverified"}</dd>
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>{new Date(v.last_seen_at).toLocaleDateString()}</dd>
            </div>
          </dl>
          <p className="vehicle-muted">
            Acquisition cost excludes tax, registration and pickup travel.
          </p>
          {ev.warnings.length > 0 && (
            <p className="vehicle-note">{ev.warnings.join(" · ")}</p>
          )}
          <h3>Match score</h3>
          <dl>
            {Object.entries(ev.breakdown).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {v.sources.map((source) =>
            source.url ? (
              <a
                key={`${source.source}:${source.source_listing_id}`}
                className="vehicle-source"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.seller || source.source} ·{" "}
                {new URL(source.url).hostname}
              </a>
            ) : (
              <p key={source.source_listing_id}>Original link unavailable</p>
            ),
          )}
          <p>
            Battery evidence:{" "}
            {row.attributes.battery_evidence || "Not established"}
          </p>
          <div className="vehicle-detail-actions">
            {ev.eligibility === "eligible" && (
              <button
                className="secondary-button compact"
                disabled={busy}
                onClick={verify}
              >
                Verify
              </button>
            )}
            {v.decision !== "unreviewed" && v.decision !== "passed" && (
              <button
                className="vehicle-text-button"
                disabled={busy}
                onClick={() => decide("unreviewed")}
              >
                Restore to Unreviewed
              </button>
            )}
          </div>
        </details>
        <div className="vehicle-actions vehicle-review-actions">
          {v.decision === "passed" ? (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => decide("unreviewed")}
            >
              Restore to Unreviewed
            </button>
          ) : (
            <>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => decide("passed")}
              >
                <X size={16} aria-hidden />
                Pass
              </button>
              <button
                className="secondary-button"
                aria-pressed={v.decision === "watch"}
                disabled={busy}
                onClick={() => decide("watch")}
              >
                <Eye size={16} aria-hidden />
                Watch
              </button>
              <button
                className="primary-button"
                disabled={busy}
                aria-pressed={v.decision === "shortlist"}
                onClick={() => decide("shortlist")}
              >
                <Check size={16} aria-hidden />
                Shortlist
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function VehicleSettings({
  profile,
  busy,
  save,
  schedule,
}: {
  profile: Profile;
  busy: boolean;
  save: (config: VehicleProfile) => Promise<void>;
  schedule: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(profile.config);
  const numbers = {
    cost_ceiling: "Effective-cost ceiling ($)",
    local_miles: "Local radius (mi)",
    preferred_miles: "Preferred mileage",
    high_miles: "High-mileage threshold",
  } as const;
  return (
    <section className="vehicle-settings">
      <form
        className="vehicle-card vehicle-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(draft);
        }}
      >
        <h2>Search profile</h2>
        <label>
          Make
          <input
            required
            value={draft.make}
            onChange={(e) => setDraft({ ...draft, make: e.target.value })}
          />
        </label>
        <label>
          Model
          <input
            required
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
        </label>
        <label>
          Origin ZIP
          <input
            required
            pattern="[0-9]{5}"
            value={draft.origin_zip}
            onChange={(e) =>
              setDraft({
                ...draft,
                origin_zip: e.target.value,
                origin_coordinates: null,
              })
            }
          />
        </label>
        <p>
          Set coordinates for a new origin ZIP to rank distance. Collection
          remains nationwide.
        </p>
        <label>
          Longitude
          <input
            type="number"
            min="-180"
            max="180"
            step="any"
            value={draft.origin_coordinates?.[0] ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                origin_coordinates: e.target.value
                  ? [Number(e.target.value), draft.origin_coordinates?.[1] ?? 0]
                  : null,
              })
            }
          />
        </label>
        <label>
          Latitude
          <input
            type="number"
            min="-90"
            max="90"
            step="any"
            value={draft.origin_coordinates?.[1] ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                origin_coordinates: e.target.value
                  ? [draft.origin_coordinates?.[0] ?? 0, Number(e.target.value)]
                  : null,
              })
            }
          />
        </label>
        {Object.entries(numbers).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min="0"
              required
              value={draft[key as keyof typeof numbers]}
              onChange={(e) =>
                setDraft({ ...draft, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        <label>
          Allowed batteries (comma-separated; blank allows any)
          <input
            value={draft.allowed_batteries.join(", ")}
            onChange={(e) =>
              setDraft({
                ...draft,
                allowed_batteries: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label>
          Excluded title statuses
          <input
            value={draft.excluded_titles.join(", ")}
            onChange={(e) =>
              setDraft({
                ...draft,
                excluded_titles: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <fieldset>
          <legend>Score weights (total 100)</legend>
          {Object.entries(draft.weights).map(([key, value]) => (
            <label key={key}>
              {key}
              <input
                type="number"
                min="0"
                max="100"
                value={value}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    weights: {
                      ...draft.weights,
                      [key]: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </fieldset>
        <button className="primary-button" disabled={busy}>
          Save profile
        </button>
      </form>
      <section className="vehicle-card">
        <h2>Daily collection</h2>
        <p>
          {String(
            Math.floor((profile.task_schedules.start_minute ?? 420) / 60),
          ).padStart(2, "0")}
          :
          {String((profile.task_schedules.start_minute ?? 420) % 60).padStart(
            2,
            "0",
          )}{" "}
          {profile.task_schedules.timezone} ·{" "}
          {profile.task_schedules.enabled ? "Enabled" : "Disabled"}
        </p>
        <p>
          Run and review a successful manual baseline before enabling this
          schedule.
        </p>
        <button
          className="secondary-button compact"
          disabled={busy}
          onClick={() => void schedule()}
        >
          {profile.task_schedules.enabled
            ? "Disable daily search"
            : "Enable daily search"}
        </button>
        <p>
          <Link href="/schedules">Edit search timing in Schedules</Link>
        </p>
      </section>
    </section>
  );
}

export function VehicleEditor({
  vehicle,
  config,
  busy,
  close,
  save,
}: {
  vehicle: Reviewed | null;
  config: VehicleProfile;
  busy: boolean;
  close: () => void;
  save: (listing: Partial<VehicleListing>) => Promise<void>;
}) {
  const modalFocus = useVehicleModal(true, close);
  const missingSourcePrice = vehicle?.vehicle_listings.some(
    (listing) =>
      listing.data.source === vehicle.row.source &&
      listing.data.source_listing_id === vehicle.row.source_listing_id &&
      listing.data.price === null,
  );
  const [row, setRow] = useState<Partial<VehicleListing>>(
    vehicle?.row ?? {
      source: "manual",
      make: config.make,
      model: config.model,
      title_status: "unknown",
      attributes: { battery_pack: null, motor: null, battery_evidence: null },
      availability: "available",
      delivery: "unknown",
    },
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(row);
  };
  return (
    <div
      ref={modalFocus}
      className="vehicle-modal"
      role="dialog"
      aria-modal="true"
      aria-label={vehicle ? "Verify vehicle" : "Add listing"}
    >
      <section>
        <button
          className="icon-button"
          autoFocus
          onClick={close}
          aria-label="Close vehicle editor"
        >
          <X />
        </button>
        <form className="vehicle-form" onSubmit={submit}>
          <h2>{vehicle ? "Verify required details" : "Add a listing"}</h2>
          <p>
            Confirm details from the seller. Zero is a confirmed amount; leave
            unknown costs blank.
          </p>
          {!vehicle && (
            <>
              <label>
                Listing URL
                <input
                  type="url"
                  required
                  value={row.url ?? ""}
                  onChange={(e) => setRow({ ...row, url: e.target.value })}
                />
              </label>
              <label>
                Make
                <input
                  required
                  value={row.make ?? ""}
                  onChange={(e) => setRow({ ...row, make: e.target.value })}
                />
              </label>
              <label>
                Model
                <input
                  required
                  value={row.model ?? ""}
                  onChange={(e) => setRow({ ...row, model: e.target.value })}
                />
              </label>
              <label>
                Year
                <input
                  type="number"
                  min="1980"
                  max="2100"
                  value={row.year ?? ""}
                  onChange={(e) =>
                    setRow({ ...row, year: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Price
                <input
                  type="number"
                  min="1"
                  value={row.price ?? ""}
                  onChange={(e) =>
                    setRow({
                      ...row,
                      price: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </label>
              <label>
                Mileage
                <input
                  type="number"
                  min="0"
                  value={row.mileage ?? ""}
                  onChange={(e) =>
                    setRow({
                      ...row,
                      mileage: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </label>
              <label>
                Seller
                <input
                  value={row.seller ?? ""}
                  onChange={(e) => setRow({ ...row, seller: e.target.value })}
                />
              </label>
            </>
          )}
          {vehicle && missingSourcePrice && (
            <label>
              Confirmed advertised price
              <input
                type="number"
                min="1"
                value={row.price ?? ""}
                onChange={(e) =>
                  setRow({
                    ...row,
                    price: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
          )}
          <label>
            VIN
            <input
              readOnly={Boolean(vehicle?.vin)}
              maxLength={17}
              value={row.vin ?? ""}
              onChange={(e) =>
                setRow({ ...row, vin: e.target.value.toUpperCase() || null })
              }
            />
          </label>
          <label>
            Confirmed battery pack (required)
            <select
              value={row.attributes?.battery_pack ?? ""}
              onChange={(e) => {
                const battery = e.target.value || null;
                setRow({
                  ...row,
                  attributes: {
                    battery_pack: battery,
                    motor: row.attributes?.motor ?? null,
                    battery_evidence: battery
                      ? "Owner verified from seller information"
                      : null,
                  },
                });
              }}
            >
              <option value="">Unknown</option>
              <option value="standard">Standard</option>
              <option value="standard+">Standard+</option>
              <option value="large">Large</option>
              <option value="max">Max</option>
            </select>
          </label>
          <label>
            Confirmed motor configuration (optional)
            <select
              value={row.attributes?.motor ?? ""}
              onChange={(e) =>
                setRow({
                  ...row,
                  attributes: {
                    battery_pack: row.attributes?.battery_pack ?? null,
                    motor: e.target.value || null,
                    battery_evidence: row.attributes?.battery_evidence ?? null,
                  },
                })
              }
            >
              <option value="">Unknown</option>
              <option value="dual">Dual</option>
              <option value="performance dual">
                Performance Dual / Dual + Power Upgrade
              </option>
              <option value="quad">Quad</option>
              <option value="tri">Tri</option>
            </select>
          </label>
          <label>
            Delivery (optional until Watch or Shortlist)
            <select
              value={row.delivery}
              onChange={(e) =>
                setRow({
                  ...row,
                  delivery: e.target.value as VehicleListing["delivery"],
                })
              }
            >
              <option value="unknown">Unknown</option>
              <option value="confirmed">Confirmed delivery</option>
              <option value="pickup">Pickup required</option>
            </select>
          </label>
          <label>
            Confirmed shipping ($, optional)
            <input
              type="number"
              min="0"
              value={row.shipping ?? ""}
              onChange={(e) =>
                setRow({
                  ...row,
                  shipping: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <label>
            Confirmed mandatory fees ($, optional)
            <input
              type="number"
              min="0"
              value={row.mandatory_fees ?? ""}
              onChange={(e) =>
                setRow({
                  ...row,
                  mandatory_fees: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
            />
          </label>
          <label>
            Title status
            <input
              value={row.title_status ?? "unknown"}
              onChange={(e) => setRow({ ...row, title_status: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={row.history_available ?? false}
              onChange={(e) =>
                setRow({ ...row, history_available: e.target.checked })
              }
            />{" "}
            History reviewed
          </label>
          <label>
            History flags (comma-separated)
            <input
              value={row.history_flags?.join(", ") ?? ""}
              onChange={(e) =>
                setRow({
                  ...row,
                  history_flags: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <button className="primary-button" disabled={busy}>
            Save verification
          </button>
        </form>
      </section>
    </div>
  );
}

function useVehicleModal(open: boolean, close: () => void) {
  const container = useRef<HTMLDivElement>(null);
  const onClose = useEffectEvent(close);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        container.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']",
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);
    focusable()[0]?.focus();
    function keys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);
  return container;
}
