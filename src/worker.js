"use strict";
require("dotenv").config();
const db = require("./db");
const { checkPing, checkHttp, checkStatusPage, checkOne, hostOf } = require("./checks");

const PROBE = process.env.PROBE_REGION || "local";
const CENTRAL_URL = (process.env.CENTRAL_URL || "").replace(/\/+$/, "");
const REPORT_TOKEN = process.env.REPORT_TOKEN || "";
const PROBE_ASN = process.env.PROBE_ASN || "";
const PROBE_LOCATION = process.env.PROBE_LOCATION || "";

// Interval terpisah per protokol (detik).
const PING_INTERVAL = Math.max(1, parseInt(process.env.PING_INTERVAL_SECONDS || "10", 10)) * 1000;
const HTTP_INTERVAL = Math.max(5, parseInt(process.env.HTTP_INTERVAL_SECONDS || "30", 10)) * 1000;
const STATUS_INTERVAL = Math.max(30, parseInt(process.env.STATUS_INTERVAL_SECONDS || "300", 10)) * 1000;
const STAGGER_MS = Math.max(0, parseInt(process.env.STAGGER_MS || "500", 10));

async function sendTelegram(text) {
  const token = process.env.TG_BOT_TOKEN;
  const chat = process.env.TG_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "Markdown" }),
    });
  } catch (e) {
    console.warn("Telegram gagal:", e.message);
  }
}

// Cooldown antar alert agar flap gak spam Telegram.
const ALERT_COOLDOWN_MS = Math.max(0, parseInt(process.env.ALERT_COOLDOWN_MINUTES || "30", 10)) * 60 * 1000;
const lastAlertAt = new Map(); // ispId -> timestamp alert down/degrared terakhir

// State: 0=semua up, 1=semua down (global), 2=sebagian down (degraded).
async function evaluateAlerts() {
  for (const isp of db.getAllIsps()) {
    const probes = db.getLatestByProbe(isp.id);
    const keys = Object.keys(probes);
    if (!keys.length) continue;
    const up = keys.filter((k) => probes[k]);
    const state = up.length === 0 ? 1 : up.length < keys.length ? 2 : 0;
    const prev = db.getAlertState(isp.id);
    const now = Date.now();
    const cooled = now - (lastAlertAt.get(isp.id) || 0) > ALERT_COOLDOWN_MS;
    if (state === prev) continue;
    if (state === 1) {
      if (cooled) {
        await sendTelegram(`🔴 *DOWN* — ${isp.name} (${isp.country})\nSemua region gagal: ${keys.join(", ")}`);
        lastAlertAt.set(isp.id, now);
      }
      db.setAlertState(isp.id, 1);
      console.warn("ALERT DOWN:", isp.name);
    } else if (state === 2) {
      if (cooled) {
        await sendTelegram(`🟡 *DEGRADED* — ${isp.name} (${isp.country})\nDown di: ${keys.filter((k) => !probes[k]).join(", ")}\nUp di: ${up.join(", ")}`);
        lastAlertAt.set(isp.id, now);
      }
      db.setAlertState(isp.id, 2);
      console.warn("ALERT DEGRADED:", isp.name);
    } else {
      await sendTelegram(`🟢 *RECOVERED* — ${isp.name} (${isp.country})\nSudah reachable dari: ${up.join(', ')}`);
      lastAlertAt.set(isp.id, 0);
      db.setAlertState(isp.id, 0);
      console.info("ALERT UP:", isp.name);
    }
  }
}

// Cache hasil terakhir tiap ISP (biar combined bisa dihitung walau ping/http jalan di timer beda).
const last = new Map();

function seedLast(isp) {
  const rows = db.db
    .prepare(
      `SELECT check_type, status, latency_ms FROM isp_status_history
       WHERE isp_id = ? AND recorded_at = (SELECT MAX(recorded_at) FROM isp_status_history h2
         WHERE h2.isp_id = isp_status_history.isp_id AND h2.check_type = isp_status_history.check_type)`
    )
    .all(isp.id);
  const o = {};
  for (const r of rows) o[r.check_type] = { ok: !!r.status, latency: r.latency_ms };
  last.set(isp.id, o);
}

function combinedOf(L) {
  const ok = !!(L.ping && L.ping.ok) || !!(L.http && L.http.ok);
  const latency = L.ping && L.ping.ok ? L.ping.latency : L.http && L.http.ok ? L.http.latency : null;
  return { ok, latency };
}

function fullPayload(isp) {
  const L = last.get(isp.id) || {};
  const c = combinedOf(L);
  return {
    ispId: isp.id, name: isp.name, country: isp.country, region: isp.region,
    ping: L.ping || null, http: L.http || null, status: L.status || null,
    combined: c, probe: PROBE, ts: Date.now(),
  };
}

async function reportOne(isp, ctype, res) {
  const body =
    ctype === "status"
      ? { isp_id: isp.id, check_type: "status", status: res.ok ? 1 : 0, latency_ms: res.incident ? 1 : 0, probe: PROBE, asn: PROBE_ASN, location: PROBE_LOCATION }
      : { isp_id: isp.id, check_type: ctype, status: res.ok ? 1 : 0, latency_ms: res.latency, probe: PROBE, asn: PROBE_ASN, location: PROBE_LOCATION };
  try {
    await fetch(`${CENTRAL_URL}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(REPORT_TOKEN ? { Authorization: `Bearer ${REPORT_TOKEN}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn(`Gagal lapor ${ctype} ke central:`, e.message);
  }
}

// Jalankan SATU jenis cek (ping/http/status) lalu simpan + broadcast.
async function runCheck(isp, kind, onCheck) {
  if (isp.is_active === 0 || isp.is_active === false) return;
  let res = null;
  try {
    if (kind === "ping") res = await checkPing(isp.real_ip || isp.isp_ip || hostOf(isp.http_url));
    else if (kind === "http") res = isp.http_url ? await checkHttp(isp.http_url) : { ok: false, latency: null, err: "no url" };
    else if (kind === "status") res = isp.status_url ? await checkStatusPage(isp.status_url) : null;
    else return;
  } catch (e) {
    console.error(`check ${kind} ${isp.name} error:`, e.message);
    return;
  }
  if (res == null) return;

  const L = last.get(isp.id) || {};
  L[kind] = kind === "status" ? { ok: res.ok, incident: res.incident, indicator: res.indicator } : { ok: res.ok, latency: res.latency };
  last.set(isp.id, L);

  const c = combinedOf(L);
  if (CENTRAL_URL) {
    if (kind === "ping" && isp.isp_ip) await reportOne(isp, "ping", res);
    if (kind === "http" && isp.http_url) await reportOne(isp, "http", res);
    if (kind === "status" && isp.status_url) await reportOne(isp, "status", res);
    await reportOne(isp, "combined", c);
  } else {
    if (kind === "ping" && isp.isp_ip) db.updateIspStatus(isp.id, "ping", res.ok, res.latency, PROBE);
    if (kind === "http" && isp.http_url) db.updateIspStatus(isp.id, "http", res.ok, res.latency, PROBE);
    if (kind === "status" && isp.status_url) db.updateIspStatus(isp.id, "status", res.ok ? 1 : 0, res.incident ? 1 : 0, PROBE);
    db.updateIspStatus(isp.id, "combined", c.ok ? 1 : 0, c.latency, PROBE);
  }
  if (onCheck) onCheck(fullPayload(isp));
}

// ── Scheduler independen per server, protokol terpisah + stagger ──
async function startWorker(onCheck) {
  const probeMode = Boolean(CENTRAL_URL);
  console.log(probeMode ? `MODE PROBE → ${CENTRAL_URL} sebagai '${PROBE}'` : `MODE LOKAL sebagai '${PROBE}'`);
  console.log(`Interval: ping ${PING_INTERVAL / 1000}s · http ${HTTP_INTERVAL / 1000}s · status ${STATUS_INTERVAL / 1000}s · stagger ${STAGGER_MS}ms`);

  const timers = new Map(); // id -> [timeout/interval handles]

  function scheduleIsp(isp, index) {
    if (timers.has(isp.id)) return;
    seedLast(isp);
    const base = index * STAGGER_MS + Math.floor(Math.random() * 2000);
    const handles = [
      setTimeout(() => { runCheck(isp, "ping", onCheck); setInterval(() => runCheck(isp, "ping", onCheck), PING_INTERVAL); }, base),
      setTimeout(() => { runCheck(isp, "http", onCheck); setInterval(() => runCheck(isp, "http", onCheck), HTTP_INTERVAL); }, base + Math.floor(Math.random() * 3000)),
    ];
    if (isp.status_url) {
      handles.push(setTimeout(() => { runCheck(isp, "status", onCheck); setInterval(() => runCheck(isp, "status", onCheck), STATUS_INTERVAL); }, base + Math.floor(Math.random() * 5000)));
    }
    timers.set(isp.id, handles);
  }

  async function sync() {
    let list;
    try {
      list = probeMode
        ? await (await fetch(`${CENTRAL_URL}/isps`, { headers: REPORT_TOKEN ? { Authorization: `Bearer ${REPORT_TOKEN}` } : {} })).json()
        : db.getAllIsps();
    } catch (e) {
      console.error("sync error:", e.message);
      return;
    }
    let i = 0;
    for (const isp of list) { scheduleIsp(isp, i++); }
  }

  await sync();
  setInterval(sync, HTTP_INTERVAL); // tangkap ISP baru tiap putaran
}

// Cek penuh sekaligus (tombol "Cek" di UI).
async function checkSingleNow(isp, onCheck, probe = PROBE) {
  await runCheck(isp, "ping", onCheck);
  await runCheck(isp, "http", onCheck);
  if (isp.status_url) await runCheck(isp, "status", onCheck);
  return fullPayload(isp);
}

module.exports = { startWorker, checkSingleNow, evaluateAlerts };
