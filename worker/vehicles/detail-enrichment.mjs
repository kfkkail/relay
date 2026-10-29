import { lookup } from "node:dns/promises";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CACHE = fileURLToPath(
  new URL("../../.relay/vehicle-enrichment.json", import.meta.url),
);
const MAX_CACHE_ENTRIES = 10_000;
const MAX_HTML_BYTES = 1_500_000;
const allowedPacks = new Set(["standard", "standard+", "large", "max"]);
const allowedMotors = new Set(["dual", "quad", "tri"]);

export function sellerPageAttributes(html, sourceUrl) {
  const content = decodeEntities(String(html))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const packPatterns = [
    [
      "standard+",
      /\bstandard\s*(?:\+|plus)(?:\s+(?:battery(?:\s+pack)?|pack))?\b/i,
    ],
    ["standard", /\bstandard\s+(?:battery(?:\s+pack)?|pack)\b/i],
    ["large", /\blarge\s+(?:battery(?:\s+pack)?|pack)\b/i],
    ["max", /\bmax\s+(?:battery(?:\s+pack)?|pack)\b/i],
  ];
  const packs = packPatterns.flatMap(([pack, pattern]) =>
    pattern.test(content) ? [pack] : [],
  );
  const motorMatch = content.match(/\b(dual|quad|tri)[ -]?motor\b/i);
  const battery = packs.length === 1 ? packs[0] : null;
  const motor = motorMatch?.[1]?.toLowerCase() ?? null;
  let evidence = null;
  if (battery) {
    const pattern = packPatterns.find(([pack]) => pack === battery)?.[1];
    const match = pattern?.exec(content);
    const excerpt = match
      ? content.slice(Math.max(0, match.index - 100), match.index + 220).trim()
      : battery;
    let host = "seller page";
    try {
      host = new URL(sourceUrl).hostname;
    } catch {
      // The URL is validated before production fetches. Keep extraction useful
      // for fixtures even when a caller supplies only a label.
    }
    evidence = `Seller page (${host}): ${excerpt}`.slice(0, 1500);
  }
  return {
    battery_pack: battery,
    motor: allowedMotors.has(motor) ? motor : null,
    battery_evidence: evidence,
  };
}

export async function enrichSellerListings({
  listings,
  profile,
  cachePath = DEFAULT_CACHE,
  fetchPage = fetchSellerPage,
  now = () => new Date(),
  limit = configuredLimit(),
  concurrency = 2,
} = {}) {
  const rows = Array.isArray(listings)
    ? listings.map((row) => ({
        ...row,
        attributes: { ...row.attributes },
      }))
    : [];
  if (
    profile?.make?.toLowerCase() !== "rivian" ||
    profile?.model?.toLowerCase() !== "r1t"
  )
    return {
      listings: rows,
      counts: {
        detail_attempted: 0,
        detail_resolved: 0,
        detail_failed: 0,
      },
    };
  const cache = await readCache(cachePath);
  for (const row of rows) applyCachedAttributes(row, cache.entries[row.vin]);

  const candidates = rows
    .filter(
      (row) =>
        row.vin &&
        row.url &&
        row.availability !== "unavailable" &&
        !row.attributes.battery_pack,
    )
    .sort((a, b) => candidateOrder(a, b, cache.entries));
  const selected = candidates.slice(0, Math.max(0, Math.min(50, limit)));
  const counts = {
    detail_attempted: selected.length,
    detail_resolved: 0,
    detail_failed: 0,
  };
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), selected.length) },
    async () => {
      while (cursor < selected.length) {
        const row = selected[cursor++];
        const checkedAt = now().toISOString();
        try {
          const attributes = sellerPageAttributes(
            await fetchPage(row.url),
            row.url,
          );
          cache.entries[row.vin] = {
            checked_at: checkedAt,
            url: row.url,
            battery_pack: attributes.battery_pack,
            motor: attributes.motor,
            battery_evidence: attributes.battery_evidence,
          };
          applyCachedAttributes(row, cache.entries[row.vin]);
          if (row.attributes.battery_pack) counts.detail_resolved++;
        } catch {
          counts.detail_failed++;
          cache.entries[row.vin] = {
            checked_at: checkedAt,
            url: row.url,
            battery_pack: null,
            motor: null,
            battery_evidence: null,
          };
        }
      }
    },
  );
  await Promise.all(workers);
  await writeCache(cachePath, cache);
  return { listings: rows, counts };
}

export async function fetchSellerPage(
  initialUrl,
  { fetchImpl = fetch, lookupImpl = lookup } = {},
) {
  let current = safePageUrl(initialUrl);
  for (let redirects = 0; redirects <= 3; redirects++) {
    await assertPublicHost(current, lookupImpl);
    const response = await fetchImpl(current.href, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Relay vehicle research/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 3) throw new Error("unsafe_redirect");
      current = safePageUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("seller_page_unavailable");
    }
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (contentType && !contentType.includes("html")) {
      await response.body?.cancel();
      throw new Error("seller_page_not_html");
    }
    return await boundedText(response, MAX_HTML_BYTES);
  }
  throw new Error("unsafe_redirect");
}

function configuredLimit() {
  const value = Number(process.env.RELAY_VEHICLE_DETAIL_LIMIT ?? 20);
  return Number.isInteger(value) && value >= 0 && value <= 50 ? value : 20;
}

function applyCachedAttributes(row, cached) {
  if (!cached) return;
  if (!row.attributes.battery_pack && allowedPacks.has(cached.battery_pack)) {
    row.attributes.battery_pack = cached.battery_pack;
    row.attributes.battery_evidence = cached.battery_evidence;
  }
  if (!row.attributes.motor && allowedMotors.has(cached.motor))
    row.attributes.motor = cached.motor;
}

function candidateOrder(a, b, entries) {
  const aChecked = Date.parse(entries[a.vin]?.checked_at ?? "") || 0;
  const bChecked = Date.parse(entries[b.vin]?.checked_at ?? "") || 0;
  if (!aChecked !== !bChecked) return aChecked ? 1 : -1;
  if (aChecked && bChecked && aChecked !== bChecked) return aChecked - bChecked;
  return (
    (a.price ?? Infinity) - (b.price ?? Infinity) ||
    (a.mileage ?? Infinity) - (b.mileage ?? Infinity)
  );
}

async function readCache(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    const entries = {};
    for (const [vin, item] of Object.entries(value?.entries ?? {}).slice(
      0,
      MAX_CACHE_ENTRIES,
    )) {
      if (
        !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ||
        !item ||
        typeof item !== "object"
      )
        continue;
      entries[vin] = {
        checked_at:
          typeof item.checked_at === "string"
            ? item.checked_at.slice(0, 80)
            : "",
        url: typeof item.url === "string" ? item.url.slice(0, 2000) : null,
        battery_pack: allowedPacks.has(item.battery_pack)
          ? item.battery_pack
          : null,
        motor: allowedMotors.has(item.motor) ? item.motor : null,
        battery_evidence:
          typeof item.battery_evidence === "string"
            ? item.battery_evidence.slice(0, 1500)
            : null,
      };
    }
    return { version: 1, entries };
  } catch {
    return { version: 1, entries: {} };
  }
}

async function writeCache(path, cache) {
  try {
    const entries = Object.fromEntries(
      Object.entries(cache.entries)
        .sort(([, a], [, b]) =>
          String(b.checked_at).localeCompare(String(a.checked_at)),
        )
        .slice(0, MAX_CACHE_ENTRIES),
    );
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, entries })}\n`, {
      mode: 0o600,
    });
    await rename(temporary, path);
  } catch {
    await rm(`${path}.${process.pid}.tmp`, { force: true }).catch(() => {});
  }
}

function safePageUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i.test(
      url.hostname,
    )
  )
    throw new Error("unsafe_url");
  return url;
}

async function assertPublicHost(url, lookupImpl) {
  const addresses = await lookupImpl(url.hostname, {
    all: true,
    verbatim: true,
  });
  if (
    !Array.isArray(addresses) ||
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new Error("unsafe_address");
}

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && [0, 2].includes(c)) ||
      (a === 192 && b === 168) ||
      (a === 198 && [18, 19].includes(b)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    if (value.startsWith("::ffff:"))
      return isPublicAddress(value.slice("::ffff:".length));
    return !(
      value === "::" ||
      value === "::1" ||
      /^f[cd]/.test(value) ||
      /^fe[89ab]/.test(value) ||
      value.startsWith("ff") ||
      value.startsWith("2001:db8:")
    );
  }
  return false;
}

async function boundedText(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty_response");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("seller_page_too_large");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
