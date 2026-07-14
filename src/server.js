"use strict";
require("dotenv").config();
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const db = require("./db");
const { seed } = require("./seed");
const worker = require("./worker");

const API_HOST = process.env.API_HOST || "0.0.0.0";
const PORT = parseInt(process.env.PORT || process.env.API_PORT || "8000", 10);

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PUBLIC = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC));

app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.get("/ui", (_req, res) => res.sendFile(path.join(PUBLIC, "index.html")));

app.get("/healthz", (_req, res) => res.json({ status: "ok", service: "isp-monitor-api" }));

// ── ISP CRUD ──
app.get("/isps", (req, res) => {
  let isps = db.getAllIsps();
  const { country, region, is_active } = req.query;
  if (country) isps = isps.filter((i) => i.country === country);
  if (region) isps = isps.filter((i) => i.region === region);
  if (is_active !== undefined) isps = isps.filter((i) => String(i.is_active) === String(is_active));
  res.json(isps);
});

app.post("/isps", (req, res) => {
  const id = db.getOrCreateIsp(req.body);
  res.status(201).json({ ...req.body, id });
});

app.get("/isps/:id", (req, res) => {
  const isp = db.getIspById(Number(req.params.id));
  if (!isp) return res.status(404).json({ error: "ISP tidak ditemukan" });
  res.json(isp);
});

app.put("/isps/:id", (req, res) => {
  if (!db.getIspById(Number(req.params.id))) return res.status(404).json({ error: "ISP tidak ditemukan" });
  db.updateIsp(Number(req.params.id), req.body);
  res.json(db.getIspById(Number(req.params.id)));
});

app.delete("/isps/:id", (req, res) => {
  db.deleteIsp(Number(req.params.id));
  res.status(204).end();
});

// ── Dashboard / regions / stats ──
app.get("/dashboard", (_req, res) => res.json(db.getDashboard()));
app.get("/regions", (_req, res) => res.json(db.getProbes()));
app.get("/stats", (_req, res) => res.json(db.getStats()));

app.get("/history/:id", (req, res) => {
  const { check_type, since, limit } = req.query;
  res.json(db.getHistory(Number(req.params.id), {
    check_type, since, limit: limit ? Number(limit) : 100,
  }));
});

app.get("/status/:id", (req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  const row = db.db.prepare("SELECT * FROM isp_uptime_cache WHERE isp_id = ? AND check_date = ?")
    .get(Number(req.params.id), day);
  if (!row) return res.status(404).json({ error: "Status tidak ditemukan" });
  res.json({
    isp_id: row.isp_id, uptime_percent: row.uptime_percent,
    total_checks: row.total_checks, successful: row.successful,
    avg_latency_ms: null,
  });
});

// ── Manual trigger ──
app.post("/health/:id", async (req, res) => {
  const isp = db.getIspById(Number(req.params.id));
  if (!isp) return res.status(404).json({ error: "ISP tidak ditemukan" });
  const payload = await worker.checkSingleNow(isp, broadcast);
  res.json({ status: "done", ...payload });
});

app.post("/health/all", async (_req, res) => {
  const isps = db.getAllIsps();
  for (const isp of isps) worker.checkSingleNow(isp, broadcast);
  res.json({ status: "started", isp_count: isps.length });
});

// ── Multi-region report ──
app.post("/report", async (req, res) => {
  const token = process.env.REPORT_TOKEN || "";
  if (token) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${token}`) return res.status(401).json({ error: "Token salah" });
  }
  const { isp_id, check_type, status, latency_ms, probe = "local", asn = "", location = "" } = req.body;
  if (!db.getIspById(Number(isp_id))) return res.status(404).json({ error: "ISP tidak ditemukan" });
  if (probe && probe !== "local") db.upsertProbe(probe, asn, location);
  db.updateIspStatus(Number(isp_id), check_type, status, latency_ms, probe);
  if (probe !== "local") {
    await worker.evaluateAlerts();
    broadcast({
      ispId: Number(isp_id), name: db.getIspById(Number(isp_id)).name,
      check_type, probe, combined: { ok: !!status, latency: latency_ms },
      ts: Date.now(),
    });
  }
  res.json({ ok: true, isp_id, probe });
});

// Metadata probe (ASN/lokasi tiap region)
app.get("/probes", (_req, res) => res.json(db.getProbesMeta()));

app.post("/worker/start", (req, res) => {
  startBackgroundWorker();
  res.status(202).json({ status: "worker started" });
});

function broadcast(payload) {
  io.emit("check", payload);
}

let workerStarted = false;
function startBackgroundWorker() {
  if (workerStarted) return;
  workerStarted = true;
  worker.startWorker(broadcast).catch((e) => console.error("worker fatal:", e));
}

io.on("connection", (socket) => {
  socket.emit("dashboard", db.getDashboard());
  socket.on("pingNow", async ({ ispId }) => {
    const isp = db.getIspById(Number(ispId));
    if (isp) await worker.checkSingleNow(isp, broadcast);
  });
});

async function main() {
  db.db.exec("PRAGMA journal_mode = WAL");
  require("./seed"); // ensure schema present
  // Seed idempoten: tambah target yang belum ada (CDN/cache), jangan hapus yang lama.
  seed();

  startBackgroundWorker();
  setInterval(() => worker.evaluateAlerts().catch(() => {}), 60 * 1000);

  server.listen(PORT, API_HOST, () => {
    console.log(`ISP Monitor jalan di http://${API_HOST}:${PORT}`);
  });
}

main();

module.exports = { app, server };
