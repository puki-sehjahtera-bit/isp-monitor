// Worker-safe checks. Tidak ada ICMP / child_process / dns module.
// "ping" = HTTP RTT (https ke domain, http ke IP). Sama filosofi dgn user-ping.

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

export async function checkHttp(url, timeout = 10000) {
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

// RTT ke target: domain -> https, IP -> http (hindari TLS gagal di IP).
export async function checkPing(target, timeout = 8000) {
  if (!target) return { ok: false, latency: null, err: "no target" };
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(target);
  const url = isIp ? `http://${target}` : `https://${target}`;
  return checkHttp(url, timeout);
}

export async function checkStatusPage(url, timeout = 10000) {
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

export async function checkOne(isp) {
  const pingTarget = hostOf(isp.http_url) || isp.real_ip || isp.isp_ip;
  const ping = pingTarget ? await checkPing(pingTarget) : { ok: false, latency: null, err: "no target" };
  const http = isp.http_url ? await checkHttp(isp.http_url) : { ok: false, latency: null, err: "no url" };
  const status = isp.status_url ? await checkStatusPage(isp.status_url) : null;
  const combined = ping.ok || http.ok;
  const combinedLatency = ping.ok ? ping.latency : http.ok ? http.latency : null;
  return { ping, http, status, combined, combinedLatency };
}

// ── DNS-over-HTTPS (Cloudflare) untuk verify ASN ──
const DOH = "https://1.1.1.1/dns-query";
async function doh(name, type) {
  const r = await fetch(DOH, {
    method: "POST",
    headers: { Accept: "application/dns-json", "Content-Type": "application/dns-json" },
    body: JSON.stringify({ name, type }),
  });
  const j = await r.json();
  return j.Answer || [];
}

function cymruName(ip) { return ip.split(".").reverse().join(".") + ".origin.asn.cymru.com"; }

export async function asnOf(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;
  try {
    const ans = await doh(cymruName(ip), "TXT");
    const txt = ans.map((a) => a.data).join(" | ").replace(/"/g, "");
    const asn = parseInt(txt.split("|")[0].trim(), 10);
    return Number.isNaN(asn) ? null : asn;
  } catch { return null; }
}

export async function verifyIsp(isp) {
  const raw = isp.real_ip || isp.isp_ip || hostOf(isp.http_url);
  if (!raw) return { ip: null, asn: null, expected: isp.asn || null, match: null, note: "tidak ada target" };
  let ip = raw;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    try { const a = await doh(ip, "A"); ip = a[0]?.data || null; }
    catch { return { ip: null, asn: null, expected: isp.asn || null, match: null, note: "gagal resolve " + raw }; }
  }
  if (!ip) return { ip: null, asn: null, expected: isp.asn || null, match: null, note: "gagal resolve " + raw };
  const asn = await asnOf(ip);
  const expected = isp.asn ? parseInt(isp.asn, 10) : null;
  let match = null;
  if (expected && asn) match = expected === asn;
  else if (!expected) match = null;
  return { ip, asn, expected, match, note: match === false ? "ASN beda — bukan server ISP ini" : match === true ? "ASN cocok" : "" };
}
