import { boundedText } from "./bounded-text.mjs";

const API = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/";
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;
const text = (value) =>
  typeof value === "string" ? value.trim().slice(0, 1500) : "";

// Gen 1 Rivian pack capacities supplied by the owner. Keep the marketing and
// decoded/raw values because vPIC has returned both forms for the Large packs.
// Do not extend this table by interpolation: an unknown capacity stays unknown.
export const RIVIAN_GEN1_BATTERIES = Object.freeze([
  { pack: "standard", official_kwh: 106, raw_kwh: 106 },
  { pack: "standard+", official_kwh: 121, raw_kwh: 121 },
  { pack: "large", official_kwh: 131, raw_kwh: 128.9 },
  { pack: "max", official_kwh: 141, raw_kwh: 141 },
  { pack: "large+", official_kwh: 142, raw_kwh: 142.3 },
]);

export function rivianGen1Battery(capacity, identity = {}) {
  const year = Number(identity.year);
  if (
    text(identity.make).toUpperCase() !== "RIVIAN" ||
    text(identity.model).toUpperCase() !== "R1T" ||
    !Number.isInteger(year) ||
    year < 2022 ||
    year > 2024 ||
    typeof capacity !== "number" ||
    !Number.isFinite(capacity)
  )
    return null;
  return (
    RIVIAN_GEN1_BATTERIES.find(({ official_kwh, raw_kwh }) =>
      [official_kwh, raw_kwh].some(
        (expected) => Math.abs(capacity - expected) <= 0.11,
      ),
    ) ?? null
  );
}

// NHTSA describes what the manufacturer encoded, not necessarily every option
// on this vehicle. Capacity is mapped only for the bounded Gen 1 R1T table
// above; every other vehicle and unexpected value remains unresolved.
export function decodeNhtsaResult(payload, vin, sourceUrl, now = new Date()) {
  const rows = payload?.Results;
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (
    !row ||
    text(row.VIN).toUpperCase() !== vin ||
    text(row.ErrorCode) !== "0"
  )
    throw new Error("NHTSA could not cleanly decode this VIN.");
  const drive = text(row.EVDriveUnit);
  const motor =
    new Map(
      Object.entries({
        "dual motor": "dual",
        "quad motor": "quad",
        "triple motor": "tri",
        "tri motor": "tri",
      }),
    ).get(drive.toLowerCase()) ?? null;
  const batteryInfo = text(row.BatteryInfo);
  // BatteryInfo is a structured field. Accept a named pack, not prose listing
  // possible options, and never use capacity, trim, or model year to choose.
  const battery =
    new Map(
      Object.entries({
        "standard pack": "standard",
        "standard battery pack": "standard",
        "standard+ pack": "standard+",
        "standard plus pack": "standard+",
        "large pack": "large",
        "large battery pack": "large",
        "large+ pack": "large+",
        "large plus pack": "large+",
        "large+ battery pack": "large+",
        "max pack": "max",
        "max battery pack": "max",
      }),
    ).get(batteryInfo.toLowerCase().replace(/\s+/g, " ")) ?? null;
  const capacity = (value) =>
    /^\d+(\.\d+)?$/.test(text(value)) &&
    Number(value) > 0 &&
    Number(value) <= 1000
      ? Number(value)
      : null;
  const batteryKwh = capacity(row.BatteryKWh);
  const identity = {
    year: text(row.ModelYear),
    make: text(row.Make),
    model: text(row.Model),
    trim: text(row.Trim),
  };
  // An unexpected non-empty BatteryInfo value may contradict a capacity-only
  // interpretation. Use the table only when NHTSA supplied no pack label.
  const mapped =
    battery || batteryInfo ? null : rivianGen1Battery(batteryKwh, identity);
  const resolvedBattery = battery ?? mapped?.pack ?? null;
  return {
    vin,
    status: "decoded",
    decoder_version: 2,
    checked_at: now.toISOString(),
    source_url: sourceUrl,
    identity,
    attributes: {
      motor,
      motor_evidence: motor ? `NHTSA EVDriveUnit: ${drive}` : null,
      battery_pack: resolvedBattery,
      battery_evidence: battery
        ? `NHTSA BatteryInfo: ${batteryInfo}`
        : mapped
          ? `NHTSA BatteryKWh: ${batteryKwh} kWh (Rivian Gen 1 ${mapped.pack} capacity map)`
          : null,
    },
    battery_kwh: batteryKwh,
    battery_kwh_to: capacity(row.BatteryKWh_to),
    battery_type: text(row.BatteryType) || null,
    battery_info: batteryInfo || null,
  };
}

export async function decodeNhtsa(
  vin,
  { year, fetchImpl = fetch, now = () => new Date() } = {},
) {
  if (!vinPattern.test(vin))
    throw new Error("A complete valid VIN is required.");
  const url = new URL(`${API}${vin}`);
  url.searchParams.set("format", "json");
  if (
    Number.isInteger(Number(year)) &&
    Number(year) >= 1980 &&
    Number(year) <= 2100
  )
    url.searchParams.set("modelyear", String(year));
  const response = await fetchImpl(url.href, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`NHTSA returned HTTP ${response.status}.`);
  }
  return decodeNhtsaResult(
    JSON.parse(await boundedText(response, 200_000)),
    vin,
    url.href,
    now(),
  );
}

export function freshNhtsa(value, vin, now = Date.now()) {
  const checked = Date.parse(value?.checked_at);
  return (
    value?.vin === vin &&
    value?.status === "decoded" &&
    value?.decoder_version === 2 &&
    Number.isFinite(checked) &&
    checked <= now &&
    now - checked < 30 * 86400_000
  );
}
