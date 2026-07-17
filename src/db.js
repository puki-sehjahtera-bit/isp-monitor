"use strict";
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "isp_monitor.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 3000");

db.exec(`
  CREATE TABLE IF NOT EXISTS isp_list (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    country      TEXT NOT NULL,
    region       TEXT,
    isp_ip       TEXT,
    http_url     TEXT,
    order_index  INTEGER DEFAULT 0,
    is_active    INTEGER DEFAULT 1,
    notes        TEXT,
    category     TEXT DEFAULT 'isp',
    asn          TEXT,
    real_ip      TEXT,
    status_url   TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS isp_status_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    isp_id       INTEGER NOT NULL,
    check_type   TEXT NOT NULL,
    status       INTEGER NOT NULL,
    latency_ms   INTEGER,
    probe        TEXT NOT NULL DEFAULT 'local',
    recorded_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (isp_id) REFERENCES isp_list(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS alert_state (
    isp_id      INTEGER PRIMARY KEY,
    is_down     INTEGER NOT NULL DEFAULT 0,
    last_change DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS isp_uptime_cache (
    isp_id         INTEGER NOT NULL,
    check_date     DATE NOT NULL,
    total_checks   INTEGER NOT NULL,
    successful     INTEGER NOT NULL,
    uptime_percent REAL NOT NULL,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (isp_id, check_date)
  );

  CREATE TABLE IF NOT EXISTS probes (
    probe     TEXT PRIMARY KEY,
    asn       TEXT,
    location  TEXT,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS isp_verify (
    isp_id    INTEGER PRIMARY KEY,
    target_ip TEXT,
    target_asn INTEGER,
    expected_asn INTEGER,
    match     INTEGER,
    note      TEXT,
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (isp_id) REFERENCES isp_list(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_hist_isp ON isp_status_history(isp_id, recorded_at);
  CREATE INDEX IF NOT EXISTS idx_hist_isp_type_time ON isp_status_history(isp_id, check_type, recorded_at);
  CREATE INDEX IF NOT EXISTS idx_hist_rt ON isp_status_history(recorded_at);
  CREATE INDEX IF NOT EXISTS idx_hist_stat ON isp_status_history(isp_id, recorded_at) WHERE check_type = 'status';
  CREATE INDEX IF NOT EXISTS idx_hist_comb ON isp_status_history(isp_id, recorded_at) WHERE check_type = 'combined';

  CREATE TABLE IF NOT EXISTS api_keys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash    TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used   DATETIME,
    is_active   INTEGER DEFAULT 1,
    rate_limit  INTEGER DEFAULT 60
  );
`);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreateIsp({ name, country, region, isp_ip, http_url, order_index = 0, notes, category = "isp", asn = "", real_ip = "", status_url = "" }) {
  const row = db.prepare("SELECT id FROM isp_list WHERE name = ? AND country = ?").get(name, country);
  if (row) return row.id;
  const info = db
    .prepare(
      `INSERT INTO isp_list (name, country, region, isp_ip, http_url, order_index, notes, category, asn, real_ip, status_url, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)`
    )
    .run(name, country, region, isp_ip, http_url, order_index, notes, category, asn, real_ip, status_url);
  return info.lastInsertRowid;
}

function getAllIsps() {
  return db
    .prepare("SELECT * FROM isp_list WHERE is_active = 1 ORDER BY order_index, name")
    .all();
}

function getIspById(id) {
  return db.prepare("SELECT * FROM isp_list WHERE id = ?").get(id) || null;
}

function updateIsp(id, fields) {
  const allowed = new Set([
    "name", "country", "region", "isp_ip", "http_url", "order_index", "is_active", "notes", "category", "asn", "real_ip", "status_url",
  ]);
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.has(k) && v !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE isp_list SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...vals);
}

function deleteIsp(id) {
  db.prepare("UPDATE isp_list SET is_active = 0 WHERE id = ?").run(id);
}

function updateIspStatus(isp_id, check_type, status, latency_ms, probe = "local") {
  const st = status ? 1 : 0;                       // boolean/number -> 0/1
  const lat = latency_ms == null ? null : Number(latency_ms); // tolak boolean/null
  db.prepare(
    "INSERT INTO isp_status_history (isp_id, check_type, status, latency_ms, probe) VALUES (?,?,?,?,?)"
  ).run(isp_id, check_type, st, lat, probe);
  refreshUptimeCache(isp_id);
}

function refreshUptimeCache(isp_id) {
  const day = todayISO();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS success,
              AVG(CASE WHEN status = 1 THEN latency_ms ELSE NULL END) AS avg_latency
       FROM isp_status_history WHERE isp_id = ? AND date(recorded_at) = ?`
    )
    .get(isp_id, day);
  const total = row.total || 0;
  const successful = row.success || 0;
  const uptime = total ? (successful / total) * 100 : 0;
  const cached = db
    .prepare("SELECT 1 FROM isp_uptime_cache WHERE isp_id = ? AND check_date = ?")
    .get(isp_id, day);
  if (cached) {
    db.prepare(
      `UPDATE isp_uptime_cache SET total_checks=?, successful=?, uptime_percent=?, updated_at=CURRENT_TIMESTAMP
       WHERE isp_id=? AND check_date=?`
    ).run(total, successful, uptime, isp_id, day);
  } else {
    db.prepare(
      "INSERT INTO isp_uptime_cache (isp_id, check_date, total_checks, successful, uptime_percent) VALUES (?,?,?,?,?)"
    ).run(isp_id, day, total, successful, uptime);
  }
}

function getHistory(isp_id, { check_type, since, limit = 100 } = {}) {
  let q = "SELECT * FROM isp_status_history WHERE isp_id = ?";
  const p = [isp_id];
  if (check_type) { q += " AND check_type = ?"; p.push(check_type); }
  if (since) { q += " AND recorded_at >= ?"; p.push(since); }
  q += " ORDER BY recorded_at DESC LIMIT ?";
  p.push(limit);
  return db.prepare(q).all(...p);
}

let _probesCache = null, _probesCacheTime = 0;

function getProbes() {
  const now = Date.now();
  if (_probesCache && now - _probesCacheTime < CACHE_TTL) return _probesCache;
  _probesCache = db
    .prepare("SELECT DISTINCT probe FROM isp_status_history ORDER BY probe")
    .all()
    .map((r) => r.probe);
  _probesCacheTime = Date.now();
  return _probesCache;
}

function upsertProbe(probe, asn = "", location = "") {
  db.prepare(
    `INSERT INTO probes (probe, asn, location, last_seen) VALUES (?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(probe) DO UPDATE SET asn=excluded.asn, location=excluded.location, last_seen=CURRENT_TIMESTAMP`
  ).run(probe, asn || "", location || "");
}

function getProbesMeta() {
  const rows = db.prepare("SELECT probe, asn, location, last_seen FROM probes").all();
  const m = {};
  for (const r of rows) m[r.probe] = { asn: r.asn, location: r.location, last_seen: r.last_seen };
  return m;
}

function getLatestByProbe(isp_id) {
  const rows = db
    .prepare(
      `SELECT s.probe AS probe, s.status AS status FROM isp_status_history s
       WHERE s.isp_id = ? AND s.check_type = 'combined'
         AND s.recorded_at = (SELECT MAX(s2.recorded_at) FROM isp_status_history s2
                              WHERE s2.isp_id = s.isp_id AND s2.probe = s.probe AND s2.check_type = 'combined')`
    )
    .all(isp_id);
  const res = {};
  for (const r of rows) res[r.probe] = !!r.status;
  return res;
}

function getAlertState(isp_id) {
  const r = db.prepare("SELECT is_down FROM alert_state WHERE isp_id = ?").get(isp_id);
  return r ? r.is_down : -1;
}

function setAlertState(isp_id, state) {
  db.prepare(
    `INSERT INTO alert_state (isp_id, is_down, last_change) VALUES (?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(isp_id) DO UPDATE SET is_down=excluded.is_down, last_change=CURRENT_TIMESTAMP`
  ).run(isp_id, state | 0);
}

let _dashCache = null, _dashCacheTime = 0;
const CACHE_TTL = 2000;

function getDashboard() {
  const now = Date.now();
  if (_dashCache && now - _dashCacheTime < CACHE_TTL) return _dashCache;
  const day = todayISO();
  const isps = getAllIsps();
  const ids = isps.map(i => i.id);
  const ph = ids.map(() => "?").join(",");

  const caches = {};
  db.prepare(`SELECT * FROM isp_uptime_cache WHERE isp_id IN (${ph}) AND check_date = ?`)
    .all(...ids, day).forEach(r => { caches[r.isp_id] = r; });

  const pmeta = getProbesMeta();

  // Batch per ISP — SQLite single-threaded, tapi kita kurangi jumlah query
  const getRecent = db.prepare("SELECT status, latency_ms, recorded_at, probe FROM isp_status_history WHERE isp_id = ? ORDER BY recorded_at DESC LIMIT 5");
  const getRegion = db.prepare("SELECT probe, status, latency_ms FROM isp_status_history WHERE isp_id = ? AND check_type = 'combined' AND recorded_at >= datetime('now', '-5 minutes')");
  const getOff = db.prepare("SELECT status, latency_ms FROM isp_status_history WHERE isp_id = ? AND check_type = 'status' ORDER BY recorded_at DESC LIMIT 1");

  const result = isps.map((isp) => {
    const cache = caches[isp.id] || null;
    const recent = getRecent.all(isp.id);
    const regionRows = getRegion.all(isp.id);
    const regions = {};
    for (const r of regionRows) {
      const meta = pmeta[r.probe] || {};
      regions[r.probe] = { status: !!r.status, latency_ms: r.latency_ms, asn: meta.asn || "", location: meta.location || "" };
    }
    const off = getOff.get(isp.id);
    return {
      id: isp.id, name: isp.name, country: isp.country, region: isp.region,
      category: isp.category || "isp", asn: isp.asn || "",
      real_ip: isp.real_ip || "", status_url: isp.status_url || "",
      isp_ip: isp.isp_ip, http_url: isp.http_url,
      order_index: isp.order_index, notes: isp.notes,
      cache, recent_status: recent, regions,
      official: off ? { ok: !!off.status, code: off.latency_ms } : null,
    };
  });
  _dashCache = result;
  _dashCacheTime = Date.now();
  return result;
}

function pruneOldHistory(days = 30) {
  const info = db
    .prepare("DELETE FROM isp_status_history WHERE recorded_at < datetime('now', ?)")
    .run(`-${days} days`);
  return info.changes;
}

function getVerify(isp_id) {
  return db.prepare("SELECT * FROM isp_verify WHERE isp_id = ?").get(isp_id) || null;
}
function upsertVerify(isp_id, v) {
  db.prepare(
    `INSERT INTO isp_verify (isp_id, target_ip, target_asn, expected_asn, match, note, checked_at)
     VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(isp_id) DO UPDATE SET target_ip=excluded.target_ip, target_asn=excluded.target_asn,
       expected_asn=excluded.expected_asn, match=excluded.match, note=excluded.note, checked_at=CURRENT_TIMESTAMP`
  ).run(isp_id, v.ip, v.asn, v.expected, v.match === null ? null : v.match ? 1 : 0, v.note || "");
}

// API Keys
const crypto = require("crypto");

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function genKey() {
  return "ispm_" + crypto.randomBytes(24).toString("base64url");
}

function createApiKey({ name, rateLimit = 60 }) {
  const key = genKey();
  const hash = hashKey(key);
  db.prepare("INSERT INTO api_keys (key_hash, name, rate_limit) VALUES (?,?,?)")
    .run(hash, name, rateLimit);
  return { key, name, rateLimit };
}

function getApiKey(key) {
  const hash = hashKey(key);
  return db.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1").get(hash);
}

function listApiKeys() {
  return db.prepare("SELECT id, name, created_at, last_used, is_active, rate_limit FROM api_keys ORDER BY created_at DESC").all();
}

function revokeApiKey(id) {
  db.prepare("UPDATE api_keys SET is_active = 0 WHERE id = ?").run(id);
}

function updateApiKeyLastUsed(key) {
  const hash = hashKey(key);
  db.prepare("UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE key_hash = ?").run(hash);
}

let _statsCache = null, _statsCacheTime = 0;

function getStats() {
  const now = Date.now();
  if (_statsCache && now - _statsCacheTime < CACHE_TTL) return _statsCache;
  const day = todayISO();
  const total_isps = getAllIsps().length;
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT isp_id) AS unique_isps, SUM(total_checks) AS total_checks,
              SUM(successful) AS successful_checks, MAX(updated_at) AS last_updated
       FROM isp_uptime_cache WHERE check_date = ?`
    )
    .get(day);
  const checks = row.total_checks || 0;
  const ok = row.successful_checks || 0;
  _statsCache = {
    total_isps,
    checks_today: checks,
    successful_checks: ok,
    overall_uptime_percent: checks ? Math.round((ok / checks) * 100 * 100) / 100 : 0,
    last_updated: row.last_updated || null,
  };
  _statsCacheTime = Date.now();
  return _statsCache;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS ping_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    isp TEXT NOT NULL,
    city TEXT,
    ping INTEGER,
    server_ping INTEGER,
    saran TEXT,
    kategori TEXT DEFAULT 'global',
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
  )
`);

function addPingReport({ isp, city, ping, serverPing, saran, kategori }) {
  db.prepare(
    "INSERT INTO ping_reports (isp, city, ping, server_ping, saran, kategori) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(isp, city || null, ping ?? null, serverPing ?? null, saran || null, kategori || "global");
}

function getPingReports(limit = 200, kategori = null) {
  if (kategori && kategori !== "all") {
    return db.prepare(
      "SELECT isp, city, ping, server_ping AS serverPing, saran, kategori, created_at FROM ping_reports WHERE kategori = ? ORDER BY id DESC LIMIT ?"
    ).all(kategori, limit);
  }
  return db.prepare(
    "SELECT isp, city, ping, server_ping AS serverPing, saran, kategori, created_at FROM ping_reports ORDER BY id DESC LIMIT ?"
  ).all(limit);
}

// Migrasi kolom opsional (DB lama yang dibuat sebelum ada kolom ini).
// Dipanggil SETELAH semua CREATE TABLE agar tabel sudah ada.
for (const [table, col, ddl] of [
  ["isp_list", "category", "TEXT DEFAULT 'isp'"],
  ["isp_list", "asn", "TEXT"],
  ["isp_list", "real_ip", "TEXT"],
  ["isp_list", "status_url", "TEXT"],
  ["ping_reports", "kategori", "TEXT DEFAULT 'global'"],
]) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
    if (!cols.includes(col)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`).run();
  } catch (e) {
    // table belum ada di DB sangat lama -> skip
  }
}

module.exports = {
  db,
  DB_PATH,
  addPingReport,
  getPingReports,
  getOrCreateIsp,
  getAllIsps,
  getIspById,
  updateIsp,
  deleteIsp,
  updateIspStatus,
  refreshUptimeCache,
  getHistory,
  getProbes,
  upsertProbe,
  getProbesMeta,
  getLatestByProbe,
  getAlertState,
  setAlertState,
  getDashboard,
  getStats,
  pruneOldHistory,
  getVerify,
  upsertVerify,
  createApiKey,
  getApiKey,
  listApiKeys,
  revokeApiKey,
  updateApiKeyLastUsed,
};
