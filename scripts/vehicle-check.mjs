import { decodeNhtsa } from "../worker/vehicles/nhtsa.mjs";
import { enrichVehicle } from "../worker/vehicles/browser-enrichment.mjs";

const [vin, url] = process.argv.slice(2);
if (!vin || !url)
  throw new Error(
    "Usage: npm run vehicles:check -- VIN https://seller.example/listing",
  );
const report = {};
try {
  report.nhtsa = await decodeNhtsa(vin);
} catch (error) {
  report.nhtsa = { error: error.message };
}
try {
  report.seller = await enrichVehicle({ detail_vin: vin, detail_url: url });
} catch (error) {
  report.seller = {
    failure: error.diagnostic ?? { code: "browser_startup_failed" },
  };
  process.exitCode = 1;
}
console.log(JSON.stringify(report, null, 2));
