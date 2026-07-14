"use strict";
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

// ICMP ping via system `ping`. Di banyak cloud (Railway/Render) ICMP diblokir
// -> return ok:false, caller fallback ke HTTP.
async function checkPing(ip) {
  if (!ip) return { ok: false, latency: null, err: "no ip" };
  try {
    const { stdout } = await execFileP("ping", ["-c", "1", "-W", "2", ip], { timeout: 5000 });
    const m = stdout.match(/time=(\d+\.?\d*)\s*ms/);
    const latency = m ? Math.round(parseFloat(m[1])) : null;
    return { ok: true, latency, err: "" };
  } catch (e) {
    return { ok: false, latency: null, err: String(e.message || e).slice(0, 100) };
  }
}

async function checkHttp(url, timeout = 10000) {
  if (!url || !/^https?:\/\//.test(url)) return { ok: false, latency: null, err: "invalid url" };
  const t = Date.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctrl.signal });
    clearTimeout(to);
    const latency = Date.now() - t;
    const ok = r.status >= 200 && r.status < 400;
    return { ok, latency, err: ok ? "" : `HTTP ${r.status}` };
  } catch (e) {
    clearTimeout(to);
    return { ok: false, latency: null, err: String(e.message || e).slice(0, 100) };
  }
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

module.exports = { checkPing, checkHttp, checkStatusPage, checkOne, hostOf };

// Cek status-page resmi (Statuspage.io summary.json).
// Indicator: none=operasional, minor/major/critical=gangguan. Incident aktif = down.
async function checkStatusPage(url, timeout = 10000) {
  if (!url || !/^https?:\/\//.test(url)) return { ok: true, indicator: "unknown", description: "no status_url", incident: false };
  const t = Date.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(to);
    if (!r.ok) return { ok: true, indicator: "unknown", description: `HTTP ${r.status}`, incident: false };
    const j = await r.json();
    const indicator = (j.status && j.status.indicator) || "none";
    const description = (j.status && j.status.description) || "";
    const incidents = Array.isArray(j.incidents) ? j.incidents : [];
    const active = incidents.filter((i) => i.status !== "resolved" && i.status !== "postmortem" && i.impact !== "none");
    const incident = indicator !== "none" || active.length > 0;
    return { ok: !incident, indicator, description, incident, latency_ms: Date.now() - t };
  } catch (e) {
    clearTimeout(to);
    return { ok: true, indicator: "unknown", description: String(e.message || e).slice(0, 80), incident: false };
  }
}

// Cek satu ISP: ICMP (real_ip/isp_ip/domain) + HTTP + status-page resmi (kalau ada).
async function checkOne(isp) {
  const pingTarget = isp.real_ip || isp.isp_ip || hostOf(isp.http_url);
  const ping = pingTarget ? await checkPing(pingTarget) : { ok: false, latency: null, err: "no target" };
  const http = isp.http_url ? await checkHttp(isp.http_url) : { ok: false, latency: null, err: "no url" };
  const status = isp.status_url ? await checkStatusPage(isp.status_url) : null;
  const combined = ping.ok || http.ok;
  const combinedLatency = ping.ok ? ping.latency : http.ok ? http.latency : null;
  return { ping, http, status, combined, combinedLatency };
}
