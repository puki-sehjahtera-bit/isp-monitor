import { makeDb } from "./db.mjs";
import { seed } from "./seed.mjs";
import { checkOne, checkStatusPage, verifyIsp } from "./checks.mjs";

const PROBE = "cf";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" },
    status,
  });
}
function svg(body) {
  return new Response(body, {
    headers: { "content-type": "image/svg+xml", "cache-control": "no-cache", "access-control-allow-origin": "*" },
  });
}

function requireAdmin(req, env) {
  if (!env.ADMIN_TOKEN) return true;
  const auth = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return auth === `Bearer ${env.ADMIN_TOKEN}` || url.searchParams.get("token") === env.ADMIN_TOKEN;
}

const hits = new Map();
function rateLimit(key, max, windowMs = 60000) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length <= max;
}

async function requireApiKey(req, env, db) {
  const key = req.headers.get("x-api-key") || new URL(req.url).searchParams.get("api_key");
  if (!key) return { error: "API key diperlukan" };
  const ak = await db.getApiKey(key);
  if (!ak) return { error: "API key tidak valid" };
  await db.updateApiKeyLastUsed(key);
  if (!rateLimit("key:" + ak.id, ak.rate_limit || 60)) return { error: "Rate limit terlampaui" };
  return null;
}

async function sendTelegram(text, env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text, parse_mode: "Markdown" }),
    });
  } catch {}
}
const ALERT_COOLDOWN_MS = (parseInt(env0("ALERT_COOLDOWN", "30"), 10) || 30) * 60000;
function env0(k, d) { return (globalThis.__ENV && globalThis.__ENV[k]) || d; }
const lastAlertAt = new Map();

async function evaluateAlerts(db, env) {
  const isps = await db.getAllIsps();
  for (const isp of isps) {
    const probes = await db.getLatestByProbe(isp.id);
    const keys = Object.keys(probes);
    if (!keys.length) continue;
    const up = keys.filter((k) => probes[k]);
    const state = up.length === 0 ? 1 : up.length < keys.length ? 2 : 0;
    const prev = await db.getAlertState(isp.id);
    const now = Date.now();
    const cooled = now - (lastAlertAt.get(isp.id) || 0) > ALERT_COOLDOWN_MS;
    if (state === prev) continue;
    if (state === 1) {
      if (cooled) { await sendTelegram(`🔴 DOWN — ${isp.name} (${isp.country})`, env); lastAlertAt.set(isp.id, now); }
      await db.setAlertState(isp.id, 1);
    } else if (state === 2) {
      if (cooled) { await sendTelegram(`🟡 DEGRADED — ${isp.name} (${isp.country})`, env); lastAlertAt.set(isp.id, now); }
      await db.setAlertState(isp.id, 2);
    } else {
      await sendTelegram(`🟢 RECOVERED — ${isp.name} (${isp.country})`, env);
      lastAlertAt.set(isp.id, 0);
      await db.setAlertState(isp.id, 0);
    }
  }
}

async function runCheckFor(db, isp, env) {
  const r = await checkOne(isp);
  const c = { ok: r.combined, latency: r.combinedLatency };
  if (r.ping.ok) await db.updateIspStatus(isp.id, "ping", r.ping.ok, r.ping.latency, PROBE);
  if (r.http.ok) await db.updateIspStatus(isp.id, "http", r.http.ok, r.http.latency, PROBE);
  if (r.status) await db.updateIspStatus(isp.id, "status", r.status.ok, r.status.incident ? 1 : 0, PROBE);
  await db.updateIspStatus(isp.id, "combined", c.ok ? 1 : 0, c.latency, PROBE);
  return { id: isp.id, name: isp.name, combined: c };
}

async function ensureSeeded(db) {
  const list = await db.getAllIsps();
  if (!list.length) await seed(db);
}

let _db = null;
function getDb(env) {
  if (!_db) _db = makeDb(env.DB);
  return _db;
}

function fetch(req, env, ctx) {
  return new Promise((resolve, reject) => {
    (async () => {
      globalThis.__ENV = env;
      const db = getDb(env);
      await ensureSeeded(db);
      const url = new URL(req.url);
      const p = url.pathname;
      const method = req.method;

      if (method === "OPTIONS") return resolve(new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS" } }));

      if (p === "/api/healthz") return resolve(json({ status: "ok", service: "isp-monitor-api" }));

      try { await ensureSeeded(db); } catch (e) { console.error("seed error:", e.message); }

      // Dashboard / ringkasan ──
      if (p === "/api/dashboard") return resolve(json(await db.getDashboard()));
      if (p === "/api/regions") return resolve(json(await db.getProbes()));
      if (p === "/api/stats") return resolve(json(await db.getStats()));

      // ISP ──
      if (p === "/api/isps" && method === "GET") {
        let isps = await db.getAllIsps();
        const country = url.searchParams.get("country");
        const region = url.searchParams.get("region");
        const is_active = url.searchParams.get("is_active");
        if (country) isps = isps.filter((i) => i.country === country);
        if (region) isps = isps.filter((i) => i.region === region);
        if (is_active !== null) isps = isps.filter((i) => String(i.is_active) === String(is_active));
        return resolve(json(isps));
      }
      if (p === "/api/isps" && method === "POST") {
        if (!requireAdmin(req, env)) return resolve(json({ error: "Admin token diperlukan" }, 401));
        const body = await req.json().catch(() => ({}));
        const id = await db.getOrCreateIsp(body);
        return resolve(json({ ...body, id }, 201));
      }

      let m;
      if ((m = p.match(/^\/api\/isps\/(\d+)$/))) {
        const id = Number(m[1]);
        if (method === "GET") { const isp = await db.getIspById(id); return resolve(isp ? json(isp) : json({ error: "ISP tidak ditemukan" }, 404)); }
        if (method === "PUT") { if (!requireAdmin(req, env)) return resolve(json({ error: "Admin token diperlukan" }, 401)); const body = await req.json().catch(() => ({})); await db.updateIsp(id, body); return resolve(json(await db.getIspById(id))); }
        if (method === "DELETE") { if (!requireAdmin(req, env)) return resolve(json({ error: "Admin token diperlukan" }, 401)); await db.deleteIsp(id); return resolve(new Response(null, { status: 204 })); }
      }
      if ((m = p.match(/^\/api\/isps\/(\d+)\/check$/)) && method === "POST") {
        const isp = await db.getIspById(Number(m[1]));
        if (!isp) return resolve(json({ error: "ISP tidak ditemukan" }, 404));
        const res = await runCheckFor(db, isp, env);
        ctx.waitUntil(evaluateAlerts(db, env));
        return resolve(json({ status: "done", ...res }));
      }

      if ((m = p.match(/^\/api\/history\/(\d+)$/))) {
        const { check_type, since, limit, range } = url.searchParams;
        let s = since;
        if (range === "7d") s = new Date(Date.now() - 7 * 86400000).toISOString();
        else if (range === "30d") s = new Date(Date.now() - 30 * 86400000).toISOString();
        else if (range === "24h" || !s) s = new Date(Date.now() - 86400000).toISOString();
        return resolve(json(await db.getHistory(Number(m[1]), { check_type, since: s, limit: limit ? Number(limit) : 9999 })));
      }
      if ((m = p.match(/^\/api\/status\/(\d+)$/))) {
        const day = new Date().toISOString().slice(0, 10);
        const row = await db.DB.prepare("SELECT * FROM isp_uptime_cache WHERE isp_id = ? AND check_date = ?").bind(Number(m[1]), day).first();
        if (!row) return resolve(json({ error: "Status tidak ditemukan" }, 404));
        return resolve(json({ isp_id: row.isp_id, uptime_percent: row.uptime_percent, total_checks: row.total_checks, successful: row.successful, avg_latency_ms: null }));
      }
      if ((m = p.match(/^\/api\/verify\/(\d+)$/))) {
        const isp = await db.getIspById(Number(m[1]));
        if (!isp) return resolve(json({ error: "ISP tidak ditemukan" }, 404));
        const cached = await db.getVerify(Number(m[1]));
        const fresh = cached && Date.now() - new Date(cached.checked_at).getTime() < 86400000;
        if (fresh) return resolve(json({ ...cached, cached: true }));
        const v = await verifyIsp(isp);
        await db.upsertVerify(Number(m[1]), v);
        return resolve(json({ ...v, cached: false }));
      }
      if ((m = p.match(/^\/api\/badge\/(\d+)$/))) {
        const isp = await db.getIspById(Number(m[1]));
        if (!isp) return resolve(new Response("ISP not found", { status: 404 }));
        const dash = (await db.getDashboard()).find((d) => d.id === Number(m[1]));
        const st = dash?.recent_status?.[0];
        const ok = st?.status;
        const uptime = dash?.cache ? Math.round(dash.cache.uptime_percent || 0) : 0;
        const lat = dash?.cache ? Math.round(dash.cache.avg_latency || 0) : "";
        const color = ok ? "3fb950" : uptime > 0 ? "d29922" : "f85149";
        const label = ok ? "UP" : uptime > 0 ? "DEGRADED" : "DOWN";
        const out = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" rx="10" fill="#161b22" stroke="#30363d"/><text x="16" y="28" font-family="sans-serif" font-size="11" fill="#8b949e">${isp.name}</text><rect x="16" y="40" width="208" height="12" rx="6" fill="#21262d"/><rect x="16" y="40" width="${uptime}%" height="12" rx="6" fill="#${color}"/><text x="16" y="70" font-family="sans-serif" font-size="22" font-weight="bold" fill="#${color}">${label}</text><text x="16" y="88" font-family="sans-serif" font-size="10" fill="#8b949e">uptime ${uptime.toFixed(1)}%${lat ? " · " + lat + "ms" : ""}</text></svg>`;
        return resolve(json(out));
      }

      if (p === "/api/report-isp" && method === "POST") {
        const b = await req.json().catch(() => ({}));
        if (!b.isp || b.ping === undefined) return resolve(json({ error: "Data tidak lengkap" }, 400));
        const kat = ["lokal", "global", "sosmed"].includes(b.kategori) ? b.kategori : "global";
        await db.addPingReport({ isp: b.isp, city: b.city, ping: b.ping, serverPing: typeof b.serverPing === "number" ? b.serverPing : null, saran: typeof b.saran === "string" ? b.saran.slice(0, 280) : "", kategori: kat });
        return resolve(json({ status: "OK" }));
      }
      if (p === "/api/reports" && method === "GET") return resolve(json({ data: await db.getPingReports(500, url.searchParams.get("kategori") || "all"), kategori: url.searchParams.get("kategori") || "all" }));
      if (p === "/api/reports" && method === "DELETE") {
        if (!requireAdmin(req, env)) return resolve(json({ error: "Admin token diperlukan" }, 401));
        await db.DB.prepare("DELETE FROM ping_reports").run();
        return resolve(json({ status: "OK", cleared: true }));
      }

      if (p === "/api/affiliates") return resolve(json({ links: [
        { category: "game_booster", label: "ExitLag", url: "https://www.exitlag.com/refer/10327709", desc: "Game booster & ping reducer" },
        { category: "game_booster", label: "GearUP Booster", url: "https://www.gearupbooster.com", desc: "Optimasi routing game" },
        { category: "vpn", label: "NordVPN", url: "https://www.nordvpn.com", desc: "VPN cepat & aman" },
        { category: "vpn", label: "ExpressVPN", url: "https://www.expressvpn.com", desc: "VPN premium global" },
      ] }));

      if (p === "/api/isp-info") {
        const cf = req.cf || {};
        const xff = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
        const ip = xff || req.headers.get("cf-connecting-ip") || "";
        const isp = cf.asOrganization || (cf.asn ? "AS" + cf.asn : "Unknown");
        const city = cf.city || "-";
        const region = cf.region || cf.regionCode || "";
        return resolve(json({ ip, isp, city, region }));
      }
      if (p === "/api/probe") return resolve(json({ t: Date.now() }));

      if (p === "/api/v1/keys" && method === "POST") {
        if (!requireAdmin(req, env)) return resolve(json({ error: "Admin token diperlukan" }, 401));
        const b = await req.json().catch(() => ({}));
        if (!b.name) return resolve(json({ error: "Nama key wajib" }, 400));
        return resolve(json(await db.createApiKey({ name: b.name, rateLimit: b.rateLimit || 60 }), 201));
      }
      if (p === "/api/v1/keys" && method === "GET") {
        if (!requireAdmin(req, env)) return resolve(json({ error: "Admin token diperlukan" }, 401));
        return resolve(json(await db.listApiKeys()));
      }
      if ((m = p.match(/^\/api\/v1\/keys\/(\d+)$/)) && method === "DELETE") {
        if (!requireAdmin(req, env)) return resolve(json({ error: "Admin token diperlukan" }, 401));
        await db.revokeApiKey(Number(m[1]));
        return resolve(json({ success: true }));
      }

      if (p.startsWith("/api/v1/")) {
        const akErr = await requireApiKey(req, env, db);
        if (akErr) return resolve(json(akErr, 401));
        if (!rateLimit("v1:" + (req.headers.get("cf-connecting-ip") || "anon"), 60)) return resolve(json({ error: "Rate limit terlampaui" }, 429));
        if (p === "/api/v1/isps") return resolve(json({ data: await db.getAllIsps(), count: (await db.getAllIsps()).length }));
        if (p === "/api/v1/dashboard") return resolve(json({ data: await db.getDashboard(), timestamp: new Date().toISOString() }));
        if (p === "/api/v1/stats") return resolve(json(await db.getStats()));
        if (p === "/api/v1/status") return resolve(json({ data: (await db.getDashboard()).map((i) => ({ id: i.id, name: i.name, country: i.country, online: i.recent_status?.[0]?.status ?? false, latency: i.recent_status?.[0]?.latency_ms ?? null, uptime: i.cache?.uptime_percent ?? 0 })), count: (await db.getAllIsps()).length, timestamp: new Date().toISOString() }));
        if ((m = p.match(/^\/api\/v1\/history\/(\d+)$/))) {
          const { range = "24h", type } = url.searchParams;
          let since;
          const map = { "1h": 36e5, "6h": 216e5, "24h": 864e5, "7d": 6048e5, "30d": 2592e6 };
          since = new Date(Date.now() - (map[range] || 864e5)).toISOString();
          const hist = await db.getHistory(Number(m[1]), { check_type: type, since, limit: 500 });
          return resolve(json({ data: hist, count: hist.length, range, type: type || "all" }));
        }
        if ((m = p.match(/^\/api\/v1\/verify\/(\d+)$/))) {
          const isp = await db.getIspById(Number(m[1]));
          if (!isp) return resolve(json({ error: "ISP tidak ditemukan" }, 404));
          return resolve(json({ data: await verifyIsp(isp) }));
        }
        return resolve(json({ error: "Not found" }, 404));
      }

      return resolve(json({ error: "Not found", path: p }, 404));
    })().then(resolve).catch(reject);
  });
}

async function scheduled(controller, env, ctx) {
  globalThis.__ENV = env;
  const db = makeDb(env.DB);
  await ensureSeeded(db);
  const isps = await db.getAllIsps();
  const BATCH = 5;
  for (let i = 0; i < isps.length; i += BATCH) {
    const slice = isps.slice(i, i + BATCH);
    await Promise.all(slice.map((isp) =>
      runCheckFor(db, isp, env).catch((e) => console.error("check gagal", isp.name, e.message))
    ));
  }
  await evaluateAlerts(db, env);
}

export default { fetch, scheduled };
