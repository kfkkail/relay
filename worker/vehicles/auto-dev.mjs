const API = "https://api.auto.dev";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value, limit = 500) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
const amount = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

export function publicListingUrl(value) {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    if (
      !url.hostname.includes(".") ||
      /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
        url.hostname,
      )
    )
      return null;
    return url.href.slice(0, 2000);
  } catch {
    return null;
  }
}

// Evidence must name the battery. Adventure/Launch Edition and model year alone
// do not establish a pack, even if that is a common factory configuration.
export function rivianAttributes(vehicle = {}) {
  const evidence = [vehicle.series, vehicle.style, vehicle.trim]
    .filter((v) => typeof v === "string")
    .join(" | ");
  const packs = new Set();
  for (const match of evidence.matchAll(
    /\b(Standard\+|Standard Plus|Standard|Large|Max)(?:\s+(?:Battery|Pack))?(?=\b|[,|\s]|$)/gi,
  )) {
    const pack = match[1].toLowerCase().replace(" plus", "+");
    packs.add(pack);
  }
  const battery = packs.size === 1 ? [...packs][0] : null;
  const motor = /tri[ -]?motor|\bTri\b/i.test(evidence)
    ? "tri"
    : /quad[ -]?motor|\bQuad\b/i.test(evidence)
      ? "quad"
      : /dual[ -]?motor|\bDual\b/i.test(evidence)
        ? "dual"
        : null;
  return {
    battery_pack: battery,
    motor,
    battery_evidence: battery ? evidence.slice(0, 1500) : null,
  };
}

export function normalizeAutoDev(row, { make, model }) {
  if (!row || typeof row !== "object") return null;
  const v = row.vehicle ?? {};
  const l = row.retailListing ?? {};
  const vin = text(v.vin || row.vin, 17).toUpperCase();
  if (
    !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ||
    text(v.make).toLowerCase() !== make.toLowerCase() ||
    text(v.model).toLowerCase() !== model.toLowerCase()
  )
    return null;
  const attributes =
    text(v.make).toLowerCase() === "rivian"
      ? rivianAttributes(v)
      : { battery_pack: null, motor: null, battery_evidence: null };
  const primary = publicListingUrl(l.primaryImage);
  const coordinates =
    Array.isArray(row.location) &&
    row.location.length === 2 &&
    row.location.every(Number.isFinite) &&
    Math.abs(row.location[0]) <= 180 &&
    Math.abs(row.location[1]) <= 90
      ? row.location
      : null;
  return {
    source: "auto.dev",
    source_listing_id: vin,
    vin,
    year:
      Number.isInteger(v.year) && v.year >= 1980 && v.year <= 2100
        ? v.year
        : null,
    make: text(v.make, 80),
    model: text(v.model, 80),
    trim: text(v.trim, 200),
    attributes,
    raw_series: text(v.series, 1000),
    price: amount(l.price) > 0 ? l.price : null,
    mileage: amount(l.miles),
    seller: text(l.dealer, 200),
    seller_id: text(l.dealerId, 200),
    url: publicListingUrl(l.vdp),
    city: text(l.city, 120),
    state: text(l.state, 30),
    zip: /^\d{5}$/.test(l.zip ?? "") ? l.zip : null,
    coordinates,
    condition:
      l.cpo === true
        ? "certified"
        : l.used === true
          ? "used"
          : l.used === false
            ? "new"
            : "unknown",
    shipping: null,
    mandatory_fees: null,
    delivery: "unknown",
    title_status: "unknown",
    // History presence is not evidence of a clean title or zero accidents.
    history_available: Boolean(row.history),
    history_flags: [],
    photos: primary ? [{ url: primary, category: "exterior" }] : [],
    photo_count: Math.min(amount(l.photoCount) ?? 0, 100),
    source_created_at: text(row.createdAt, 80) || null,
    source_updated_at: text(row.updatedAt, 80) || null,
    availability: row.removedAt ? "unavailable" : "available",
  };
}

async function boundedJson(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty_response");
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("response_too_large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function collectAutoDev({
  key,
  profile,
  fetchImpl = fetch,
  sleep = pause,
  now = () => new Date(),
  maxPages = 100,
  maxListings = 5000,
  pageSize = 20,
  paceMs = 500,
  retries = 2,
}) {
  if (!key?.trim()) throw new Error("Auto.dev credential is required.");
  if (!profile?.make?.trim() || !profile?.model?.trim())
    throw new Error("Vehicle make and model are required.");
  if (
    ![maxPages, maxListings, pageSize].every(
      (v) => Number.isInteger(v) && v > 0,
    ) ||
    maxPages > 250 ||
    maxListings > 10000 ||
    pageSize > 100
  )
    throw new Error("Invalid collection limits.");
  const started = now().toISOString();
  const base = new URL("/listings", API);
  base.search = new URLSearchParams({
    "vehicle.make": profile.make,
    "vehicle.model": profile.model,
    includeUnpriced: "true",
    includes: "total",
    sort: "createdAt.desc",
    limit: String(pageSize),
  }).toString();
  let next = base.href;
  let pages = 0,
    discovered = 0,
    invalid = 0,
    duplicates = 0,
    expected = null,
    requests = 0;
  const rows = new Map();
  const visited = new Set();
  const warnings = new Set();
  let blocked = false;
  while (next && pages < maxPages && discovered < maxListings) {
    let url;
    try {
      url = new URL(next, API);
    } catch {
      warnings.add("invalid_pagination");
      break;
    }
    if (
      url.origin !== API ||
      url.pathname !== "/listings" ||
      url.username ||
      url.password
    ) {
      warnings.add("unsafe_pagination");
      break;
    }
    // Pagination is untrusted input. Keep credentials on the API origin and keep
    // the original search scope even when the service emits a relative link.
    for (const [name, value] of base.searchParams)
      if (name !== "limit") url.searchParams.set(name, value);
    url.searchParams.set("limit", String(pageSize));
    if (visited.has(url.href)) {
      warnings.add("pagination_loop");
      break;
    }
    visited.add(url.href);
    let body = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (requests) await sleep(paceMs);
      requests++;
      try {
        const response = await fetchImpl(url.href, {
          headers: {
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(20000),
          redirect: "error",
        });
        if (
          [429, 502, 503, 504].includes(response.status) &&
          attempt < retries
        ) {
          const retryAfter = Number(response.headers.get("retry-after"));
          await response.body?.cancel();
          await sleep(
            Math.min(
              30000,
              Math.max(
                1000 * 2 ** attempt,
                Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
              ),
            ),
          );
          continue;
        }
        if (!response.ok) {
          blocked = [401, 403].includes(response.status);
          warnings.add(`http_${response.status}`);
          await response.body?.cancel();
          break;
        }
        body = await boundedJson(response, 4 * 1024 * 1024);
        break;
      } catch {
        if (attempt === retries) warnings.add("request_or_response_failed");
        else await sleep(1000 * 2 ** attempt);
      }
    }
    if (!body) break;
    if (!Array.isArray(body.data)) {
      warnings.add("invalid_envelope");
      break;
    }
    pages++;
    if (Number.isInteger(body.total) && body.total >= 0) {
      if (expected !== null && expected !== body.total)
        warnings.add("total_changed");
      expected ??= body.total;
    }
    for (const raw of body.data) {
      if (discovered >= maxListings) {
        warnings.add("listing_limit");
        break;
      }
      discovered++;
      const row = normalizeAutoDev(raw, profile);
      if (!row) {
        invalid++;
        continue;
      }
      if (rows.has(row.vin)) duplicates++;
      rows.set(row.vin, row);
    }
    next = body.links?.next || null;
    if (next && typeof next !== "string") {
      warnings.add("invalid_pagination");
      break;
    }
    if (!body.links || typeof body.links !== "object") {
      warnings.add("missing_pagination_evidence");
      break;
    }
    if (next && body.data.length === 0) {
      warnings.add("empty_page_with_next");
      break;
    }
  }
  if (next && (pages >= maxPages || discovered >= maxListings))
    warnings.add("collection_limit");
  if (invalid) warnings.add("invalid_records");
  if (duplicates) warnings.add("duplicate_vins");
  if (expected !== null && expected !== rows.size)
    warnings.add("count_mismatch");
  const status = blocked
    ? "blocked"
    : pages === 0
      ? "failed"
      : warnings.size
        ? "partial"
        : "success";
  return {
    version: 1,
    source: "auto.dev",
    mode: "api",
    access: "official_api",
    status,
    started_at: started,
    finished_at: now().toISOString(),
    scope: {
      make: profile.make,
      model: profile.model,
      geography: "nationwide",
      origin_zip: profile.origin_zip ?? "46530",
    },
    counts: {
      reported: expected,
      pages,
      requests,
      discovered,
      parsed: rows.size,
      invalid,
      duplicates,
    },
    warnings: [...warnings],
    listings: [...rows.values()],
  };
}
