import { boundedText } from "./bounded-text.mjs";

const API = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/";
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;
const text = (value) =>
  typeof value === "string" ? value.trim().slice(0, 1500) : "";

// NHTSA describes what the manufacturer encoded, not necessarily every option
// on this vehicle. In particular, kWh is never converted to a marketing pack.
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
    {
      "dual motor": "dual",
      "quad motor": "quad",
      "triple motor": "tri",
      "tri motor": "tri",
    }[drive.toLowerCase()] ?? null;
  const batteryInfo = text(row.BatteryInfo);
  // BatteryInfo is a structured field. Accept a named pack, not prose listing
  // possible options, and never use capacity, trim, or model year to choose.
  const battery =
    {
      "standard pack": "standard",
      "standard battery pack": "standard",
      "standard+ pack": "standard+",
      "standard plus pack": "standard+",
      "large pack": "large",
      "large battery pack": "large",
      "max pack": "max",
      "max battery pack": "max",
    }[batteryInfo.toLowerCase().replace(/\s+/g, " ")] ?? null;
  const capacity = (value) =>
    /^\d+(\.\d+)?$/.test(text(value)) &&
    Number(value) > 0 &&
    Number(value) <= 1000
      ? Number(value)
      : null;
  return {
    vin,
    status: "decoded",
    checked_at: now.toISOString(),
    source_url: sourceUrl,
    identity: {
      year: text(row.ModelYear),
      make: text(row.Make),
      model: text(row.Model),
      trim: text(row.Trim),
    },
    attributes: {
      motor,
      motor_evidence: motor ? `NHTSA EVDriveUnit: ${drive}` : null,
      battery_pack: battery,
      battery_evidence: battery ? `NHTSA BatteryInfo: ${batteryInfo}` : null,
    },
    battery_kwh: capacity(row.BatteryKWh),
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
    Number.isFinite(checked) &&
    checked <= now &&
    now - checked < 30 * 86400_000
  );
}
