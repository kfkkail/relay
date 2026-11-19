import { diagnoseWorker } from "../worker/doctor.mjs";

console.log(
  "Checking the configured Codex executable, worker login, workspace, and model (model probe up to 30 seconds)...",
);
const report = await diagnoseWorker();
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
