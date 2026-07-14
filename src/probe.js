"use strict";
require("dotenv").config();
const worker = require("./worker");

// Jalankan hanya sebagai PROBE REGION (tanpa API server).
// Butuh env: PROBE_REGION, CENTRAL_URL, REPORT_TOKEN (sama dengan central).
if (!process.env.CENTRAL_URL) {
  console.error("CENTRAL_URL belum diset — probe butuh URL central.");
  process.exit(1);
}
worker.startWorker(() => {}).catch((e) => console.error("probe fatal:", e));
