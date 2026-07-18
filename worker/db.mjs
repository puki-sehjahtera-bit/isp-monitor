// D1-backed data layer (port db.js). Dipakai oleh Worker.
// DB = binding D1 (env.DB). Semua query diparameterisasi.

const CACHE_TTL = 2000;

export function makeDb(DB) {
  const all = (sql, ...p) => DB.prepare(sql).bind(...p).all().then((r) => r.results);
  const get = (sql, ...p) => DB.prepare(sql).bind(...p).first();
  const run = (sql, ...p) => DB.prepare(sql).bind(...p).run();

  function todayISO() { return new Date().toISOString().slice(0, 10); }

  async function getOrCreateIsp({ name, country, region, isp_ip, http_url, order_index = 0, notes, category = "isp", asn = "", real_ip = "", status_url = "" } = {}) {
    const row = await get("SELECT id FROM isp_list WHERE name = ? AND country = ?", name, country);
    if (row) return row.id;
    const info = await run(
      `INSERT INTO isp_list (name, country, region, isp_ip, http_url, order_index, notes, category, asn, real_ip, status_url, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)`,
      name, country, region, isp_ip, http_url, order_index, notes, category, asn, real_ip, status_url
    );
    return Number(info.meta.last_row_id);
  }

  async function getAllIsps() {
    return all("SELECT * FROM isp_list WHERE is_active = 1 ORDER BY order_index, name");
  }

  async function getIspById(id) {
    return get("SELECT * FROM isp_list WHERE id = ?", id) || null;
  }

  async function updateIsp(id, fields) {
    const allowed = new Set(["name", "country", "region", "isp_ip", "http_url", "order_index", "is_active", "notes", "category", "asn", "real_ip", "status_url"]);
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.has(k) && v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (!sets.length) return;
    vals.push(id);
    await run(`UPDATE isp_list SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, ...vals);
  }

  async function deleteIsp(id) {
    await run("UPDATE isp_list SET is_active = 0 WHERE id = ?", id);
  }

  async function updateIspStatus(isp_id, check_type, status, latency_ms, probe = "cf") {
    const st = status ? 1 : 0;
    const lat = latency_ms == null ? null : Number(latency_ms);
    await run("INSERT INTO isp_status_history (isp_id, check_type, status, latency_ms, probe) VALUES (?,?,?,?,?)", isp_id, check_type, st, lat, probe);
    await refreshUptimeCache(isp_id);
  }

  async function refreshUptimeCache(isp_id) {
    const day = todayISO();
    const row = await get(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS success,
              AVG(CASE WHEN status = 1 THEN latency_ms ELSE NULL END) AS avg_latency
       FROM isp_status_history WHERE isp_id = ? AND date(recorded_at) = ?`,
      isp_id, day
    );
    const total = row.total || 0;
    const successful = row.success || 0;
    const uptime = total ? (successful / total) * 100 : 0;
    const cached = await get("SELECT 1 FROM isp_uptime_cache WHERE isp_id = ? AND check_date = ?", isp_id, day);
    if (cached) {
      await run("UPDATE isp_uptime_cache SET total_checks=?, successful=?, uptime_percent=?, updated_at=CURRENT_TIMESTAMP WHERE isp_id=? AND check_date=?", total, successful, uptime, isp_id, day);
    } else {
      await run("INSERT INTO isp_uptime_cache (isp_id, check_date, total_checks, successful, uptime_percent) VALUES (?,?,?,?,?)", isp_id, day, total, successful, uptime);
    }
  }

  async function getHistory(isp_id, { check_type, since, limit = 100 } = {}) {
    let q = "SELECT * FROM isp_status_history WHERE isp_id = ?";
    const p = [isp_id];
    if (check_type) { q += " AND check_type = ?"; p.push(check_type); }
    if (since) { q += " AND recorded_at >= ?"; p.push(since); }
    q += " ORDER BY recorded_at DESC LIMIT ?";
    p.push(limit);
    return all(q, ...p);
  }

  async function getProbes() {
    return (await all("SELECT DISTINCT probe FROM isp_status_history ORDER BY probe")).map((r) => r.probe);
  }

  async function upsertProbe(probe, asn = "", location = "") {
    await run(
      `INSERT INTO probes (probe, asn, location, last_seen) VALUES (?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(probe) DO UPDATE SET asn=excluded.asn, location=excluded.location, last_seen=CURRENT_TIMESTAMP`,
      probe, asn || "", location || ""
    );
  }

  async function getProbesMeta() {
    const rows = await all("SELECT probe, asn, location, last_seen FROM probes");
    const m = {};
    for (const r of rows) m[r.probe] = { asn: r.asn, location: r.location, last_seen: r.last_seen };
    return m;
  }

  async function getLatestByProbe(isp_id) {
    const rows = await all(
      `SELECT s.probe AS probe, s.status AS status FROM isp_status_history s
       WHERE s.isp_id = ? AND s.check_type = 'combined'
         AND s.recorded_at = (SELECT MAX(s2.recorded_at) FROM isp_status_history s2
                              WHERE s2.isp_id = s.isp_id AND s2.probe = s.probe AND s2.check_type = 'combined')`,
      isp_id
    );
    const res = {};
    for (const r of rows) res[r.probe] = !!r.status;
    return res;
  }

  async function getAlertState(isp_id) {
    await ensureAlertTable();
    const r = await get("SELECT is_down FROM alert_state WHERE isp_id = ?", isp_id);
    return r ? r.is_down : -1;
  }

  // alert_state tabel kecil, dibuat di sini (db.js asli bug: fungsi record/closeDowntime gak ada)
  async function ensureAlertTable() {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS alert_state (isp_id INTEGER PRIMARY KEY, is_down INTEGER NOT NULL DEFAULT 0, last_change DATETIME DEFAULT CURRENT_TIMESTAMP)`).run();
  }

  async function setAlertState(isp_id, state) {
    await ensureAlertTable();
    await run(
      `INSERT INTO alert_state (isp_id, is_down, last_change) VALUES (?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(isp_id) DO UPDATE SET is_down=excluded.is_down, last_change=CURRENT_TIMESTAMP`,
      isp_id, state | 0
    );
  }

  let _dashCache = null, _dashCacheTime = 0;
  async function getDashboard() {
    const now = Date.now();
    if (_dashCache && now - _dashCacheTime < CACHE_TTL) return _dashCache;
    const day = todayISO();
    const isps = await getAllIsps();
    const ids = isps.map((i) => i.id);
    const ph = ids.map(() => "?").join(",");
    const caches = {};
    if (ids.length) {
      (await all(`SELECT * FROM isp_uptime_cache WHERE isp_id IN (${ph}) AND check_date = ?`, ...ids, day))
        .forEach((r) => { caches[r.isp_id] = r; });
    }
    const pmeta = await getProbesMeta();
    const result = [];
    for (const isp of isps) {
      const cache = caches[isp.id] || null;
      const recent = await all("SELECT status, latency_ms, recorded_at, probe FROM isp_status_history WHERE isp_id = ? ORDER BY recorded_at DESC LIMIT 5", isp.id);
      const regionRows = await all("SELECT probe, status, latency_ms FROM isp_status_history WHERE isp_id = ? AND check_type = 'combined' AND recorded_at >= datetime('now', '-5 minutes')", isp.id);
      const regions = {};
      for (const r of regionRows) {
        const meta = pmeta[r.probe] || {};
        regions[r.probe] = { status: !!r.status, latency_ms: r.latency_ms, asn: meta.asn || "", location: meta.location || "" };
      }
      const off = await get("SELECT status, latency_ms FROM isp_status_history WHERE isp_id = ? AND check_type = 'status' ORDER BY recorded_at DESC LIMIT 1", isp.id);
      result.push({
        id: isp.id, name: isp.name, country: isp.country, region: isp.region,
        category: isp.category || "isp", asn: isp.asn || "",
        real_ip: isp.real_ip || "", status_url: isp.status_url || "",
        isp_ip: isp.isp_ip, http_url: isp.http_url,
        order_index: isp.order_index, notes: isp.notes,
        cache, recent_status: recent, regions,
        official: off ? { ok: !!off.status, code: off.latency_ms } : null,
      });
    }
    _dashCache = result; _dashCacheTime = Date.now();
    return result;
  }

  async function pruneOldHistory(days = 30) {
    return (await DB.prepare("DELETE FROM isp_status_history WHERE recorded_at < datetime('now', ?)").bind(`-${days} days`).run()).meta.changes;
  }

  async function getVerify(isp_id) { return get("SELECT * FROM isp_verify WHERE isp_id = ?", isp_id) || null; }
  async function upsertVerify(isp_id, v) {
    await run(
      `INSERT INTO isp_verify (isp_id, target_ip, target_asn, expected_asn, match, note, checked_at)
       VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(isp_id) DO UPDATE SET target_ip=excluded.target_ip, target_asn=excluded.target_asn,
         expected_asn=excluded.expected_asn, match=excluded.match, note=excluded.note, checked_at=CURRENT_TIMESTAMP`,
      isp_id, v.ip, v.asn, v.expected, v.match === null ? null : v.match ? 1 : 0, v.note || ""
    );
  }

  // API keys
  async function createApiKey({ name, rateLimit = 60 }) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const key = "ispm_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    const hash = await hashKey(key);
    await run("INSERT INTO api_keys (key_hash, name, rate_limit) VALUES (?,?,?)", hash, name, rateLimit);
    return { key, name, rateLimit };
  }
  async function getApiKey(key) {
    const hash = await hashKey(key);
    return get("SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1", hash);
  }
  async function listApiKeys() { return all("SELECT id, name, created_at, last_used, is_active, rate_limit FROM api_keys ORDER BY created_at DESC"); }
  async function revokeApiKey(id) { await run("UPDATE api_keys SET is_active = 0 WHERE id = ?", id); }
  async function updateApiKeyLastUsed(key) {
    const hash = await hashKey(key);
    await run("UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE key_hash = ?", hash);
  }

  async function getStats() {
    const day = todayISO();
    const total_isps = (await getAllIsps()).length;
    const row = await get(
      `SELECT COUNT(DISTINCT isp_id) AS unique_isps, SUM(total_checks) AS total_checks,
              SUM(successful) AS successful_checks, MAX(updated_at) AS last_updated
       FROM isp_uptime_cache WHERE check_date = ?`,
      day
    );
    const checks = row.total_checks || 0;
    const ok = row.successful_checks || 0;
    return {
      total_isps,
      checks_today: checks,
      successful_checks: ok,
      overall_uptime_percent: checks ? Math.round((ok / checks) * 100 * 100) / 100 : 0,
      last_updated: row.last_updated || null,
    };
  }

  async function addPingReport({ isp, city, ping, serverPing, saran, kategori }) {
    await run("INSERT INTO ping_reports (isp, city, ping, server_ping, saran, kategori) VALUES (?, ?, ?, ?, ?, ?)",
      isp, city || null, ping ?? null, serverPing ?? null, saran || null, kategori || "global");
  }
  async function getPingReports(limit = 200, kategori = null) {
    if (kategori && kategori !== "all") {
      return all("SELECT isp, city, ping, server_ping AS serverPing, saran, kategori, created_at FROM ping_reports WHERE kategori = ? ORDER BY id DESC LIMIT ?", kategori, limit);
    }
    return all("SELECT isp, city, ping, server_ping AS serverPing, saran, kategori, created_at FROM ping_reports ORDER BY id DESC LIMIT ?", limit);
  }

  return {
    DB, getOrCreateIsp, getAllIsps, getIspById, updateIsp, deleteIsp, updateIspStatus,
    refreshUptimeCache, getHistory, getProbes, upsertProbe, getProbesMeta, getLatestByProbe,
    getAlertState, setAlertState, getDashboard, getStats, pruneOldHistory,
    getVerify, upsertVerify, createApiKey, getApiKey, listApiKeys, revokeApiKey, updateApiKeyLastUsed,
    addPingReport, getPingReports,
  };
}

async function hashKey(key) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { hashKey };
