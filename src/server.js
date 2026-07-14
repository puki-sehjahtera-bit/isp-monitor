"use strict";
require("dotenv").config();
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const { seed } = require("./seed");
const worker = require("./worker");
const twitter = require("./twitter");
const backup = require("./backup");
const { verifyIsp } = require("./verify");

const API_HOST = process.env.API_HOST || "0.0.0.0";
const PORT = parseInt(process.env.PORT || process.env.API_PORT || "8000", 10);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// Lindungi endpoint tulis. Kalau ADMIN_TOKEN kosong -> terbuka (mode dev).
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${ADMIN_TOKEN}` || req.query.token === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: "Admin token diperlukan" });
}

const app = express();
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false,
  message: { error: "Terlalu banyak request — coba lagi nanti" },
});
const writeLimiter = rateLimit({
  windowMs: 60000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: "Terlalu banyak request — coba lagi nanti" },
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PUBLIC = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC));

app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.get("/ui", (_req, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(PUBLIC, "admin.html")));

app.get("/healthz", (_req, res) => res.json({ status: "ok", service: "isp-monitor-api" }));

// ── Rate limit ──
app.use(["/isps", "/dashboard", "/regions", "/stats", "/history", "/status", "/probes", "/export", "/health", "/report", "/verify"], apiLimiter);

// ── ISP CRUD ──
app.get("/isps", (req, res) => {
  let isps = db.getAllIsps();
  const { country, region, is_active } = req.query;
  if (country) isps = isps.filter((i) => i.country === country);
  if (region) isps = isps.filter((i) => i.region === region);
  if (is_active !== undefined) isps = isps.filter((i) => String(i.is_active) === String(is_active));
  res.json(isps);
});

app.post("/isps", requireAdmin, (req, res) => {
  const id = db.getOrCreateIsp(req.body);
  res.status(201).json({ ...req.body, id });
});

app.get("/isps/:id", (req, res) => {
  const isp = db.getIspById(Number(req.params.id));
  if (!isp) return res.status(404).json({ error: "ISP tidak ditemukan" });
  res.json(isp);
});

app.put("/isps/:id", requireAdmin, (req, res) => {
  if (!db.getIspById(Number(req.params.id))) return res.status(404).json({ error: "ISP tidak ditemukan" });
  db.updateIsp(Number(req.params.id), req.body);
  res.json(db.getIspById(Number(req.params.id)));
});

app.delete("/isps/:id", requireAdmin, (req, res) => {
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

// ── Verifikasi kepemilikan server (ASN target vs ASN ISP) ──
app.get("/verify/:id", async (req, res) => {
  const isp = db.getIspById(Number(req.params.id));
  if (!isp) return res.status(404).json({ error: "ISP tidak ditemukan" });
  const cached = db.getVerify(Number(req.params.id));
  const fresh = cached && Date.now() - new Date(cached.checked_at).getTime() < 24 * 3600 * 1000;
  if (fresh) return res.json({ ...cached, cached: true });
  try {
    const v = await verifyIsp(isp);
    db.upsertVerify(Number(req.params.id), v);
    res.json({ ...v, cached: false });
  } catch (e) {
    res.status(502).json({ error: "Gagal verifikasi: " + e.message });
  }
});

// ── Manual trigger ──
app.post("/health/:id", requireAdmin, async (req, res) => {
  const isp = db.getIspById(Number(req.params.id));
  if (!isp) return res.status(404).json({ error: "ISP tidak ditemukan" });
  const payload = await worker.checkSingleNow(isp, broadcast);
  res.json({ status: "done", ...payload });
});

app.post("/health/all", requireAdmin, async (_req, res) => {
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

// ── Export ──
app.get("/export/json", (_req, res) => {
  res.setHeader("Content-Disposition", `attachment; filename="isp-monitor-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(db.getDashboard());
});

app.get("/export/csv", (_req, res) => {
  const data = db.getDashboard();
  const headers = ["id", "name", "country", "uptime", "checks", "online", "avg_latency"];
  const rows = data.map((s) => {
    const c = s.cache || {};
    const online = s.recent_status?.some((r) => r.status) ? 1 : 0;
    return [s.id, s.name, s.country, c.uptime_percent ?? "", c.total_checks ?? "", online, c.avg_latency_ms ?? ""];
  });
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="isp-monitor-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// Export snapshot semua ISP
function snapshotRows() {
  const rows = db.getDashboard();
  return rows.map((r) => {
    const st = r.recent_status && r.recent_status[0];
    return {
      id: r.id, name: r.name, country: r.country, region: r.region, category: r.category, asn: r.asn,
      status: st ? (st.status ? "UP" : "DOWN") : "",
      uptime_percent: r.cache ? r.cache.uptime_percent : "",
      avg_latency_ms: r.cache ? Math.round(r.cache.avg_latency || 0) : "",
    };
  });
}
app.get("/export/snapshot.csv", (_req, res) => {
  const rows = snapshotRows();
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const head = ["id", "name", "country", "region", "category", "asn", "status", "uptime_percent", "avg_latency_ms"];
  const lines = [head.join(",")];
  for (const r of rows) lines.push(head.map((k) => esc(r[k])).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="isp-monitor.csv"');
  res.send(lines.join("\n"));
});

app.post("/worker/start", requireAdmin, (req, res) => {
  startBackgroundWorker();
  res.status(202).json({ status: "worker started" });
});

// ── SSE clients ──
const sseClients = [];

function broadcast(payload) {
  io.emit("check", payload);
  const data = JSON.stringify(payload);
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(`data: ${data}\n\n`);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

app.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  sseClients.push(res);
  req.on("close", () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

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

  const PRUNE_DAYS = Math.max(1, parseInt(process.env.PRUNE_DAYS || "30", 10));
  const prune = () => { const n = db.pruneOldHistory(PRUNE_DAYS); if (n) console.log(`Prune: ${n} baris > ${PRUNE_DAYS} hari dihapus`); };
  prune();
  setInterval(prune, 24 * 60 * 60 * 1000);

  // Auto backup DB
  backup.scheduleBackup(parseInt(process.env.BACKUP_INTERVAL_MS || "3600000", 10));

  // Tweet checker tiap 5 menit
  setInterval(() => twitter.checkAndTweet().catch(() => {}), 300000);

  server.listen(PORT, API_HOST, () => {
    console.log(`ISP Monitor jalan di http://${API_HOST}:${PORT}`);
    if (process.env.TWITTER_API_KEY) console.log("Twitter bot aktif");
  });
}

main();

module.exports = { app, server };
