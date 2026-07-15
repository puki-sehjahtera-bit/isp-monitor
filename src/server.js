"use strict";
require("dotenv").config();
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const swaggerJSDoc = require("swagger-jsdoc");
const db = require("./db");
const { seed } = require("./seed");
const worker = require("./worker");
const twitter = require("./twitter");
const backup = require("./backup");
const { verifyIsp } = require("./verify");

const API_HOST = process.env.API_HOST || "::";
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
app.set("trust proxy", 1);
app.use(express.json());

// ── Visitor log ── (paling atas biar semua request tercatat)
const fs = require("fs");
const VISITOR_LOG = path.join(__dirname, "..", "data", "visitors.json");
const visitors = [];
try { const v = JSON.parse(fs.readFileSync(VISITOR_LOG, "utf-8")); Array.isArray(v) && v.forEach(x => visitors.push(x)); } catch {}
const MAX_VISITORS = 500;
app.use((req, res, next) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  const entry = { ip: ip.split(",")[0].trim(), ua: (req.headers["user-agent"] || "").slice(0, 120), path: req.path, t: new Date().toISOString() };
  visitors.push(entry);
  if (visitors.length > MAX_VISITORS) visitors.splice(0, visitors.length - MAX_VISITORS);
  try { fs.writeFileSync(VISITOR_LOG, JSON.stringify(visitors.slice(-200)), "utf-8"); } catch {}
  next();
});

// ── API Key Auth (untuk Public API v1) ──
function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.api_key;
  if (!key) return res.status(401).json({ error: "API key diperlukan (header X-API-Key atau query api_key)" });
  const apiKey = db.getApiKey(key);
  if (!apiKey) return res.status(401).json({ error: "API key tidak valid atau tidak aktif" });
  req.apiKey = apiKey;
  db.updateApiKeyLastUsed(key);
  next();
}

const apiLimiter = rateLimit({
  windowMs: 60000, max: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: "Terlalu banyak request — coba lagi nanti" },
});
const writeLimiter = rateLimit({
  windowMs: 60000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: "Terlalu banyak request — coba lagi nanti" },
});

// ── API Key Auth Middleware ──
function apiKeyLimiter(req, res, next) {
  if (!req.apiKey) return next();
  const key = `apikey:${req.apiKey.id}`;
  const limiter = rateLimit({
    windowMs: 60000, max: req.apiKey.rate_limit || 60, standardHeaders: true, legacyHeaders: false,
    keyGenerator: () => key,
    validate: false,
    message: { error: "Rate limit terlampaui untuk API key ini" },
  });
  limiter(req, res, next);
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PUBLIC = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC));

// Service worker untuk routing client-side (offline mode)
app.get("/sw.js", (_req, res) => {
  res.set("Content-Type", "application/javascript");
  res.sendFile(path.join(PUBLIC, "sw.js"));
});
app.get("/manifest.json", (_req, res) => {
  res.set("Content-Type", "application/json");
  res.sendFile(path.join(PUBLIC, "manifest.json"));
});
app.get("/icon.svg", (_req, res) => {
  res.set("Content-Type", "image/svg+xml");
  res.sendFile(path.join(PUBLIC, "icon.svg"));
});

app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.get("/ui", (_req, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.get("/admin", requireAdmin, (_req, res) => res.sendFile(path.join(PUBLIC, "admin.html")));

app.get("/healthz", (_req, res) => res.json({ status: "ok", service: "isp-monitor-api" }));

// ── Rate limit ──
app.use(["/isps", "/dashboard", "/regions", "/stats", "/history", "/status", "/probes", "/export", "/health", "/report", "/verify"], apiLimiter);

app.get("/visitors", requireAdmin, (req, res) => {
  res.json(visitors.slice().reverse().slice(0, 100));
});

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
  const { check_type, since, limit, range } = req.query;
  let s = since;
  if (range === "7d") s = new Date(Date.now() - 7 * 86400000).toISOString();
  else if (range === "30d") s = new Date(Date.now() - 30 * 86400000).toISOString();
  else if (range === "24h" || !s) s = new Date(Date.now() - 86400000).toISOString();
  res.json(db.getHistory(Number(req.params.id), {
    check_type, since: s, limit: limit ? Number(limit) : 9999,
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

// ── Badge embed ──
app.get("/badge/:id", (req, res) => {
  const isp = db.getIspById(Number(req.params.id));
  if (!isp) return res.status(404).send("ISP not found");
  const dash = db.getDashboard().find((d) => d.id === Number(req.params.id));
  const st = dash?.recent_status?.[0];
  const ok = st?.status;
  const uptime = dash?.cache?.uptime_percent ?? 0;
  const lat = dash?.cache ? Math.round(dash.cache.avg_latency || 0) : "";
  const color = ok ? "3fb950" : uptime > 0 ? "d29922" : "f85149";
  const label = ok ? "UP" : uptime > 0 ? "DEGRADED" : "DOWN";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100">
    <rect width="240" height="100" rx="10" fill="#161b22" stroke="#30363d" stroke-width="1"/>
    <text x="16" y="28" font-family="sans-serif" font-size="11" fill="#8b949e">${isp.name}</text>
    <rect x="16" y="40" width="208" height="12" rx="6" fill="#21262d"/>
    <rect x="16" y="40" width="${uptime}%" height="12" rx="6" fill="#${color}"/>
    <text x="16" y="70" font-family="sans-serif" font-size="22" font-weight="bold" fill="#${color}">${label}</text>
    <text x="16" y="88" font-family="sans-serif" font-size="10" fill="#8b949e">uptime ${uptime.toFixed(1)}% ${lat ? '· '+lat+'ms' : ''}</text>
  </svg>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-cache");
  res.send(svg);
});

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

// ── API Key Management (Admin only) ──
app.post("/api/v1/keys", requireAdmin, (req, res) => {
  const { name, rateLimit = 60 } = req.body;
  if (!name) return res.status(400).json({ error: "Nama key wajib diisi" });
  const key = db.createApiKey({ name, rateLimit });
  res.status(201).json(key);
});

app.get("/api/v1/keys", requireAdmin, (req, res) => {
  res.json(db.listApiKeys());
});

app.delete("/api/v1/keys/:id", requireAdmin, (req, res) => {
  db.revokeApiKey(Number(req.params.id));
  res.status(204).end();
});

// ── Public API v1 ──
const apiV1Limiter = rateLimit({
  windowMs: 60000, max: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.apiKey?.id || req.ip,
  validate: false,
  message: { error: "Rate limit terlampaui" },
});

app.get("/api/v1/isps", requireApiKey, apiV1Limiter, (req, res) => {
  const isps = db.getAllIsps();
  res.json({ data: isps, count: isps.length });
});

app.get("/api/v1/isps/:id", requireApiKey, apiV1Limiter, (req, res) => {
  const isp = db.getIspById(Number(req.params.id));
  if (!isp) return res.status(404).json({ error: "ISP tidak ditemukan" });
  res.json(isp);
});

app.get("/api/v1/dashboard", requireApiKey, apiV1Limiter, (req, res) => {
  res.json({ data: db.getDashboard(), timestamp: new Date().toISOString() });
});

app.get("/api/v1/stats", requireApiKey, apiV1Limiter, (req, res) => {
  res.json(db.getStats());
});

app.get("/api/v1/history/:id", requireApiKey, apiV1Limiter, (req, res) => {
  const { check_type, since, limit, range } = req.query;
  let s = since;
  if (range === "7d") s = new Date(Date.now() - 7 * 86400000).toISOString();
  else if (range === "30d") s = new Date(Date.now() - 30 * 86400000).toISOString();
  else if (range === "24h" || !s) s = new Date(Date.now() - 86400000).toISOString();
  res.json(db.getHistory(Number(req.params.id), {
    check_type, since: s, limit: limit ? Number(limit) : 9999,
  }));
});

app.get("/api/v1/status/:id", requireApiKey, apiV1Limiter, (req, res) => {
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

app.post("/worker/start", requireAdmin, (req, res) => {
  startBackgroundWorker();
  res.status(202).json({ status: "worker started" });
});

function broadcast(payload) {
  io.emit("check", payload);
}

// Minimal SSE stub buat client lama yg masih pake EventSource
app.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  req.on("close", () => {});
});

// ── Affiliate links endpoint ──
app.get("/api/affiliates", (_req, res) => {
  res.json({
    links: [
      { category: "game_booster", label: "ExitLag", url: "https://www.exitlag.com/refer/10327709", desc: "Game booster & ping reducer" },
      { category: "game_booster", label: "GearUP Booster", url: "https://www.gearupbooster.com", desc: "Optimasi routing game" },
      { category: "vpn", label: "NordVPN", url: "https://www.nordvpn.com", desc: "VPN cepat & aman" },
      { category: "vpn", label: "ExpressVPN", url: "https://www.expressvpn.com", desc: "VPN premium global" }
    ]
  });
});

// Telegram test endpoint (admin only)
app.post("/api/telegram/test", requireAdmin, async (req, res) => {
  const { sendTelegram } = require("./worker");
  const { message = "✅ Test dari ISP Monitor — notif Telegram aktif!" } = req.body;
  try {
    await sendTelegram(message);
    res.json({ success: true, message: "Test Telegram terkirim" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Middleware: require API key + per-key rate limit
app.use("/api/v1", requireApiKey, apiKeyLimiter, apiV1Limiter);

// GET /api/v1/isp — list all ISPs dengan status
app.get("/api/v1/isp", (_req, res) => {
  const isps = db.getDashboard();
  res.json({ data: isps, count: isps.length, timestamp: new Date().toISOString() });
});

// GET /api/v1/isp/:id — detail ISP + history
app.get("/api/v1/isp/:id", (req, res) => {
  const isp = db.getDashboard().find(i => i.id == req.params.id);
  if (!isp) return res.status(404).json({ error: "ISP tidak ditemukan" });
  res.json({ data: isp });
});

// GET /api/v1/isp/:id/history — history latency
app.get("/api/v1/isp/:id/history", (req, res) => {
  const { range = "24h", type } = req.query;
  let since;
  switch (range) {
    case "1h": since = new Date(Date.now() - 3600000).toISOString(); break;
    case "6h": since = new Date(Date.now() - 21600000).toISOString(); break;
    case "24h": since = new Date(Date.now() - 86400000).toISOString(); break;
    case "7d": since = new Date(Date.now() - 604800000).toISOString(); break;
    case "30d": since = new Date(Date.now() - 2592000000).toISOString(); break;
    default: since = new Date(Date.now() - 86400000).toISOString();
  }
  const hist = db.getHistory(req.params.id, { check_type: type, since, limit: 500 });
  res.json({ data: hist, count: hist.length, range, type: type || "all" });
});

// GET /api/v1/stats — ringkasan global
app.get("/api/v1/stats", (_req, res) => {
  res.json(db.getStats());
});

// GET /api/v1/regions — list probe regions
app.get("/api/v1/regions", (_req, res) => {
  res.json({ data: db.getProbes() });
});

// GET /api/v1/status — status singkat semua ISP
app.get("/api/v1/status", (_req, res) => {
  const isps = db.getDashboard();
  res.json({ data: isps.map(i => ({
    id: i.id, name: i.name, country: i.country,
    online: i.latest?.combined?.ok ?? false,
    latency: i.latest?.combined?.latency ?? null,
    uptime: i.cache?.uptime_percent ?? 0,
  })), count: isps.length, timestamp: new Date().toISOString() });
});

// GET /api/v1/verify/:id — verifikasi ASN ISP
app.get("/api/v1/verify/:id", async (req, res) => {
  const isp = db.getIspById(Number(req.params.id));
  if (!isp) return res.status(404).json({ error: "ISP tidak ditemukan" });
  const { verifyIsp } = require("./verify");
  const v = await verifyIsp(isp);
  res.json({ data: v });
});

// POST /api/v1/keys — buat API key baru (admin only)
app.post("/api/v1/keys", requireAdmin, (req, res) => {
  const { name, rateLimit = 60 } = req.body;
  if (!name) return res.status(400).json({ error: "Parameter name wajib" });
  const keyInfo = db.createApiKey({ name, rateLimit });
  res.status(201).json({ data: keyInfo });
});

// GET /api/v1/keys — list API keys (admin only)
app.get("/api/v1/keys", requireAdmin, (req, res) => {
  res.json({ data: db.listApiKeys() });
});

// DELETE /api/v1/keys/:id — revoke API key (admin only)
app.delete("/api/v1/keys/:id", requireAdmin, (req, res) => {
  db.revokeApiKey(Number(req.params.id));
  res.json({ success: true });
});

// ── Swagger/OpenAPI Docs ──
const swaggerSpec = {
  openapi: "3.0.3",
  info: {
    title: "ISP Monitor API",
    version: "1.0.0",
    description: "Real-time ISP & network health monitoring API. Get real-time ISP status, latency, uptime, and history.",
    contact: { name: "Cah Panggul", url: "https://t.me/cahpanggul" },
    license: { name: "MIT", url: "https://opensource.org/licenses/MIT" }
  },
  servers: [{ url: "https://isp-monitor.my.id", description: "Production" }],
  tags: [
    { name: "ISPs", description: "ISP list, status, and history" },
    { name: "Stats", description: "Global statistics" },
    { name: "Keys", description: "API key management (admin)" },
    { name: "Health", description: "Health checks" }
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key", description: "API key via X-API-Key header or ?api_key= query" }
    },
    schemas: {
      ISP: {
        type: "object",
        properties: {
          id: { type: "integer" }, name: { type: "string" }, country: { type: "string" }, region: { type: "string" },
          http_url: { type: "string" }, order_index: { type: "integer" }, notes: { type: "string" },
          cache: { type: "object" }, recent_status: { type: "array" }, regions: { type: "object" },
          official: { type: "object" }, latest: { type: "object" }
        }
      },
      ISPDetail: {
        allOf: [{ $ref: "#/components/schemas/ISP" }, { type: "object", properties: { history: { type: "array" } } }]
      },
      Stats: {
        type: "object",
        properties: {
          total_isps: { type: "integer" }, checks_today: { type: "integer" },
          successful_checks: { type: "integer" }, overall_uptime_percent: { type: "number" },
          last_updated: { type: "string", format: "date-time" }
        }
      }
    }
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    "/api/v1/isp": {
      get: {
        tags: ["ISPs"],
        summary: "List all ISPs with current status",
        responses: { "200": { description: "Success", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/ISP" } }, count: { type: "integer" } } } } } }}
      }
    },
    "/api/v1/isp/{id}": {
      get: {
        tags: ["ISPs"],
        summary: "Get ISP detail with history",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "ISP detail", content: { "application/json": { schema: { $ref: "#/components/schemas/ISPDetail" } } } } }
      }
    },
    "/api/v1/isp/{id}/history": {
      get: {
        tags: ["ISPs"],
        summary: "Get ISP latency history",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          { name: "range", in: "query", schema: { type: "string", enum: ["1h", "6h", "24h", "7d", "30d"], default: "24h" } },
          { name: "type", in: "query", schema: { type: "string", enum: ["ping", "http", "combined", "status"] } }
        ],
        responses: { "200": { description: "History data", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array" }, count: { type: "integer" }, range: { type: "string" }, type: { type: "string" } } } } } }}
      }
    },
    "/api/v1/dashboard": {
      get: {
        tags: ["ISPs"],
        summary: "Full dashboard data (all ISPs with latest status)",
        responses: { "200": { description: "Dashboard data", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/ISP" } }, timestamp: { type: "string", format: "date-time" } } } } } }}
      }
    },
    "/api/v1/stats": {
      get: {
        tags: ["Stats"],
        summary: "Global statistics",
        responses: { "200": { description: "Global stats", content: { "application/json": { schema: { $ref: "#/components/schemas/Stats" } } } } }
      }
    },
    "/api/v1/history/{id}": {
      get: {
        tags: ["ISPs"],
        summary: "Get ISP history (legacy endpoint)",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          { name: "check_type", in: "query", schema: { type: "string" } },
          { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "range", in: "query", schema: { type: "string", enum: ["24h", "7d", "30d"] } }
        ],
        responses: { "200": { description: "History array" }}
      }
    },
    "/api/v1/status/{id}": {
      get: {
        tags: ["ISPs"],
        summary: "Get ISP uptime status for today",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Uptime status" }}
      }
    },
    "/api/v1/verify/{id}": {
      get: {
        tags: ["ISPs"],
        summary: "Verify ISP ASN ownership",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Verification result" }}
      }
    },
    "/api/v1/keys": {
      get: {
        tags: ["Keys"],
        summary: "List API keys (admin)",
        security: [{ ApiKeyAuth: [] }],
        responses: { "200": { description: "API keys list" }}
      },
      post: {
        tags: ["Keys"],
        summary: "Create new API key (admin)",
        security: [{ ApiKeyAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, rateLimit: { type: "integer", default: 60 } } } } } },
        responses: { "201": { description: "Created" }}
      }
    },
    "/api/v1/keys/{id}": {
      delete: {
        tags: ["Keys"],
        summary: "Revoke API key (admin)",
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Revoked" }}
      }
    },
}

}

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customCss: ".swagger-ui .topbar { display: none }", customSiteTitle: "ISP Monitor API Docs" }));
app.get("/docs.json", (_req, res) => res.json(swaggerSpec));

// 404 kustom
app.use((_req, res) => {
  res.status(404).sendFile(path.join(PUBLIC, "404.html"));
});

// 500 kustom
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err?.message || err);
  res.status(500).type("html").send(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>500 — Error Server</title><style>body{font-family:system-ui,sans-serif;background:#0a0e17;color:#e6edf3;display:flex;align-items:center;justify-content:center;min-height:100vh}.wrap{text-align:center}.code{font-size:72px;font-weight:800;background:linear-gradient(135deg,#f85149,#d29922);-webkit-background-clip:text;-webkit-text-fill-color:transparent}h1{font-size:20px}p{color:#8b949e}a{display:inline-block;padding:10px 20px;background:linear-gradient(135deg,#58a6ff,#a371f7);color:#fff;border-radius:10px;text-decoration:none;font-weight:600}</style></head><body><div class="wrap"><div class="code">500</div><h1>Terjadi Kesalahan</h1><p>Coba refresh atau kembali ke beranda.</p><a href="/">← Kembali</a></div></body></html>`);
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
