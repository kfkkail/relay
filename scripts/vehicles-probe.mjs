import { autoDevKey } from "../worker/vehicles/credentials.mjs";
import { collectAutoDev } from "../worker/vehicles/auto-dev.mjs";

const key = await autoDevKey();
const report = await collectAutoDev({
  key,
  profile: { make: "Rivian", model: "R1T", origin_zip: "46530" },
});
const counts = (values) =>
  Object.entries(
    values.reduce((acc, value) => {
      acc[value || "unknown"] = (acc[value || "unknown"] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
const { listings, ...health } = report;
console.log(
  JSON.stringify(
    {
      ...health,
      battery: counts(listings.map((row) => row.attributes.battery_pack)),
      top_dealers: counts(listings.map((row) => row.seller)).slice(0, 20),
      vdp_domains: counts(
        listings.map((row) => (row.url ? new URL(row.url).hostname : null)),
      ).slice(0, 20),
      fields: Object.fromEntries(
        ["price", "mileage", "zip", "source_updated_at"].map((field) => [
          field,
          listings.filter((row) => row[field] !== null).length,
        ]),
      ),
    },
    null,
    2,
  ),
);
if (["blocked", "failed"].includes(report.status)) process.exitCode = 1;
