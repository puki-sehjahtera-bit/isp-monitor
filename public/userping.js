"use strict";
// Mode USER PING: list ISP diambil dari API, tapi PING dilakukan dari browser
// user langsung ke target (http_url / isp_ip), bukan dari server.
// Latensi = performance.now() selisih fetch no-cors. Server TIDAK mem-ping apa-apa.

const API_BASE = (window.CONFIG && window.CONFIG.API_BASE) || "";
const WS_URL = (window.CONFIG && window.CONFIG.WS_URL) || undefined;

let isps = [];
let sortKey = "id", searchQuery = "", catFilter = "", regionFilter = "", scope = "all";
let userLatency = {}; // id -> {ms, ok, ts}
let uptime = {}; // id -> {ok, total}
const PING_TIMEOUT = 4000;

// ── Ambil list ISP dari API ──
// ── Ambil info user (ISP, IP, lokasi) ──
async function loadUserInfo() {
  const ispEl = document.getElementById("h-isp");
  const ipEl = document.getElementById("h-ip");
  const locEl = document.getElementById("h-loc");
  const subEl = document.getElementById("hero-sub");
  if (!ispEl || !ipEl) return;
  try {
    const res = await fetch(`${API_BASE}/api/isp-info`);
    const info = await res.json();
    ispEl.textContent = info.isp || "–";
    ipEl.textContent = info.ip || "–";
    locEl.textContent = [info.city, info.region].filter(Boolean).join(", ") || "–";
    if (subEl) subEl.textContent = "Ping dari perangkat kamu ke target ISP tiap 10 dtk";
    document.getElementById("hero-badge").textContent = "◉ TERHUBUNG";
  } catch (_) {
    ispEl.textContent = "–";
    ipEl.textContent = "–";
    locEl.textContent = "–";
    if (subEl) subEl.textContent = "Gagal deteksi info jaringan (server mati)";
    document.getElementById("hero-badge").textContent = "◉ OFFLINE";
    document.getElementById("hero-badge").className = "hero-badge bad";
  }
}

async function loadIsps() {
  const grid = document.getElementById("grid");
  grid.innerHTML = '<div class="loading" style="grid-column:1/-1;text-align:center;padding:30px">Memuat daftar ISP…</div>';
  uptime = {};
  const upEl = document.getElementById("session-uptime");
  const chkEl = document.getElementById("session-checks");
  if (upEl) upEl.textContent = "100";
  if (chkEl) chkEl.textContent = "0";
  // Coba ambil dari file statis lokal (gak butuh server hidup)
  try {
    const res = await fetch("/isps.json");
    if (res.ok) { isps = await res.json(); loadUserInfo(); renderGrid(); startPingLoop(); return; }
  } catch (_) {}
  // Fallback ke API server (kalau server hidup)
  try {
    const res = await fetch(`${API_BASE}/isps`);
    isps = await res.json();
  } catch (e) {
    grid.innerHTML = '<div class="loading" style="grid-column:1/-1;text-align:center;padding:30px;color:var(--fail)">❌ Gagal muat ISP. Server mati.</div>';
    return;
  }
  loadUserInfo();
  renderGrid();
  startPingLoop();
}

// ── Ping satu target dari browser user ──
// Pakai Cloudflare edge (1.1.1.1) sebagai baseline + target http_url ISP.
// no-cors: kita gak baca body, cuma ukur RTT sampai response tiba.
async function pingOne(isp) {
  // Prioritas: isp_ip (kalau ada) -> http_url -> fallback Cloudflare edge
  let target = isp.isp_ip ? `http://${isp.isp_ip}` : (isp.http_url || "");
  if (!target) target = "https://1.1.1.1";
  const start = performance.now();
  try {
    await fetch(target, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(PING_TIMEOUT) });
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch (e) {
    // gagal ke target ISP -> coba Cloudflare edge sebagai fallback reference
    try {
      const s2 = performance.now();
      await fetch("https://1.1.1.1", { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(PING_TIMEOUT) });
      // target ISP gagal, tapi internet user hidup -> unreachable ke target spesifik
      return { ok: false, ms: Math.round(performance.now() - s2), err: e.name, ref: true };
    } catch (e2) {
      return { ok: false, ms: 0, err: e2.name };
    }
  }
}

// ── Baseline DNS: trafik realtime user -> resolver publik (1.1.1.1 / 8.8.8.8) ──
const DNS_TARGETS = [
  { id: "cf", name: "Cloudflare", ip: "1.1.1.1", host: "https://1.1.1.1" },
  { id: "google", name: "Google", ip: "8.8.8.8", host: "https://8.8.8.8" },
];
const dnsState = {};
DNS_TARGETS.forEach((t) => { dnsState[t.id] = { ok: null, ms: null, packets: [], history: [], lastSpawn: 0 }; });

async function pingDnsOnce(t) {
  const start = performance.now();
  try {
    await fetch(t.host, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(PING_TIMEOUT) });
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch (_) {
    return { ok: false, ms: 0 };
  }
}

async function pingDns() {
  await Promise.all(DNS_TARGETS.map(async (t) => {
    const r = await pingDnsOnce(t);
    const st = dnsState[t.id];
    st.ok = r.ok; st.ms = r.ms;
    st.history.push(r.ok ? r.ms : null);
    if (st.history.length > 60) st.history.shift();
  }));
  updateDnsLabels();
}

function buildDnsBaseline() {
  const el = document.getElementById("dns-baseline");
  if (!el) return;
  el.innerHTML = DNS_TARGETS.map((t) => `
    <div class="dns-row" id="dns-${t.id}">
      <div class="dns-head">
        <span class="dns-name">${t.name} <i>${t.ip}</i></span>
        <span class="dns-lat" id="dns-lat-${t.id}">…</span>
      </div>
      <canvas class="dns-canvas" id="dns-cv-${t.id}" height="70"></canvas>
    </div>`).join("");
  updateDnsLabels();
}

function updateDnsLabels() {
  for (const t of DNS_TARGETS) {
    const st = dnsState[t.id];
    const el = document.getElementById(`dns-lat-${t.id}`);
    if (!el) continue;
    el.textContent = st.ok === null ? "…" : st.ok ? `${st.ms} ms` : "TIMEOUT";
    el.className = "dns-lat " + (st.ok === null ? "" : st.ok ? "ok" : "bad");
  }
}

// Animasi trafik realtime: paket mengalir YOU <-> DNS (request/response)
let _dnsLast = 0;
function animateDns(ts) {
  const dt = _dnsLast ? ts - _dnsLast : 16;
  _dnsLast = ts;
  for (const t of DNS_TARGETS) {
    const st = dnsState[t.id];
    const cv = document.getElementById(`dns-cv-${t.id}`);
    if (!cv) continue;
    const ctx = cv.getContext("2d");
    const w = cv.clientWidth || (cv.parentElement && cv.parentElement.clientWidth) || 300;
    const h = cv.height;
    if (cv.width !== w) cv.width = w;
    // spawn paket: latensi rendah -> lebih cepat & rapat
    const rate = st.ok === false ? 0 : Math.min(9, 1200 / Math.max(st.ms || 80, 20));
    if (st.ok !== false && ts - st.lastSpawn > 1000 / rate) {
      st.lastSpawn = ts;
      st.packets.push({ born: ts, dur: Math.max(260, Math.min(2600, (st.ms || 80) * 4)), jitter: Math.random() * 14 - 7 });
    }
    for (const pk of st.packets) pk.p = (ts - pk.born) / pk.dur;
    st.packets = st.packets.filter((pk) => pk.p < 1.05);
    drawDns(ctx, w, h, st, t);
  }
  requestAnimationFrame(animateDns);
}

function drawDns(ctx, w, h, st, t) {
  ctx.clearRect(0, 0, w, h);
  const y = h * 0.40, x0 = 26, x1 = w - 26;
  const ok = st.ok !== false;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  ctx.fillStyle = "#58a6ff";
  ctx.beginPath(); ctx.arc(x0, y, 6, 0, 7); ctx.fill();
  ctx.fillStyle = "#8b949e"; ctx.font = "10px Inter, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("YOU", x0, y + 20);
  ctx.fillStyle = ok ? "#3fb950" : "#f85149";
  ctx.beginPath(); ctx.arc(x1, y, 6, 0, 7); ctx.fill();
  ctx.fillStyle = "#8b949e"; ctx.fillText(t.ip, x1, y + 20);
  for (const pk of st.packets) {
    const px = x0 + (x1 - x0) * Math.min(pk.p, 1);
    const py = y + (pk.jitter || 0) * Math.sin(pk.p * Math.PI);
    const g = ctx.createRadialGradient(px, py, 0, px, py, 6);
    g.addColorStop(0, ok ? "rgba(63,185,80,0.95)" : "rgba(248,81,73,0.9)");
    g.addColorStop(1, "rgba(63,185,80,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill();
  }
  const hs = st.history;
  if (hs.length > 1) {
    const baseY = h - 8, max = Math.max(...hs.filter((v) => v).concat(200));
    ctx.strokeStyle = "rgba(88,166,255,0.55)"; ctx.lineWidth = 1;
    ctx.beginPath();
    let first = true;
    hs.forEach((v, i) => {
      const x = (w / (hs.length - 1)) * i;
      const yy = v ? baseY - (v / max) * 16 : baseY;
      if (first) { ctx.moveTo(x, yy); first = false; } else ctx.lineTo(x, yy);
    });
    ctx.stroke();
  }
}

// ── Loop ping semua (user-side) ──
let pinging = false;
async function startPingLoop() {
  if (pinging) return;
  pinging = true;
  while (pinging) {
    for (const isp of filtered()) {
      const r = await pingOne(isp);
      userLatency[isp.id] = { ...r, ts: Date.now() };
      const u = uptime[isp.id] || { ok: 0, total: 0 };
      u.total++;
      if (r.ok) u.ok++;
      uptime[isp.id] = u;
      updateCard(isp.id);
    }
    updateSummary();
    pulseLive();
    await pingDns();
    await new Promise((res) => setTimeout(res, 10000)); // interval 10 dtk
  }
}

// ── Filter & sort ──
function filtered() {
  let list = isps.filter((i) => i.is_active !== 0);
  if (scope === "local") list = list.filter((i) => i.country === "ID");
  if (scope === "global") list = list.filter((i) => i.country !== "ID");
  if (catFilter) list = list.filter((i) => (i.category || "") === catFilter);
  if (regionFilter) list = list.filter((i) => (i.region || "") === regionFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter((i) => (i.name || "").toLowerCase().includes(q));
  }
  if (sortKey === "latency") list.sort((a, b) => ((userLatency[a.id]?.ms) || 9999) - ((userLatency[b.id]?.ms) || 9999));
  else if (sortKey === "status") list.sort((a, b) => (userLatency[a.id]?.ok ? 1 : 0) - (userLatency[b.id]?.ok ? 1 : 0));
  else if (sortKey === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

// ── Render grid ──
function renderGrid() {
  const grid = document.getElementById("grid");
  const list = filtered();
  if (!list.length) { grid.innerHTML = '<div class="loading" style="grid-column:1/-1;text-align:center;padding:30px">Tidak ada ISP.</div>'; return; }
  grid.innerHTML = list.map(cardHtml).join("");
  list.forEach((i) => updateCard(i.id));
}

function cardHtml(isp) {
  return `<div class="card isp-card" id="card-${isp.id}" data-id="${isp.id}">
    <div class="isp-name">${isp.name || "?"}</div>
    <div class="isp-meta">${[isp.country, isp.region, isp.category].filter(Boolean).join(" · ")}</div>
    <div class="isp-lat" id="lat-${isp.id}">…</div>
    <div class="isp-status" id="st-${isp.id}">⏳</div>
    <div class="isp-lp" id="lp-${isp.id}">ping …</div>
    <div class="isp-up" id="up-${isp.id}">uptime –</div>
  </div>`;
}

function updateCard(id) {
  const isp = isps.find((i) => i.id === id);
  const r = userLatency[id];
  const lat = document.getElementById(`lat-${id}`);
  const st = document.getElementById(`st-${id}`);
  const card = document.getElementById(`card-${id}`);
  if (!lat || !st || !isp) return;
  if (!r) { lat.textContent = "…"; st.textContent = "⏳"; return; }
  if (r.ok) {
    lat.textContent = `${r.ms} ms`;
    st.textContent = "🟢";
    st.className = "isp-status ok";
  } else if (r.ref) {
    lat.textContent = `↓ ${r.ms} ms`;
    st.textContent = "🟡";
    st.className = "isp-status";
    st.style.color = "var(--warn, #e0a800)";
    return;
  } else {
    lat.textContent = "—";
    st.textContent = "🔴";
    st.className = "isp-status bad";
  }
  if (st) st.style.color = "";
  // flash kartu tiap update
  if (card) {
    card.classList.remove("flash");
    void card.offsetWidth; // reflow biar animasi restart
    card.classList.add("flash");
  }
  // last-ping timestamp
  const lp = document.getElementById(`lp-${id}`);
  if (lp) lp.textContent = "ping " + timeAgo(r.ts);
  // uptime lokal (sejak page dibuka)
  const up = document.getElementById(`up-${id}`);
  const u = uptime[id];
  if (up && u && u.total > 0) {
    const pct = Math.round((u.ok / u.total) * 100);
    up.textContent = `uptime ${pct}% (${u.ok}/${u.total})`;
  }
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return "baru saja";
  if (s < 60) return s + " dtk lalu";
  return Math.round(s / 60) + " mnt lalu";
}

// ── Summary ──
function updateSummary() {
  const el = document.getElementById("summary");
  const vals = Object.values(userLatency);
  const ok = vals.filter((v) => v.ok).length;
  const off = vals.length - ok;
  const lats = vals.filter((v) => v.ok).map((v) => v.ms);
  const avg = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : "–";
  el.innerHTML = `
    <div class="summary-card"><b>${ok}</b><span>Reachable (dari kamu)</span></div>
    <div class="summary-card"><b>${off}</b><span>Unreachable</span></div>
    <div class="summary-card"><b>${avg}</b><span>Latensi rata² (ms)</span></div>`;

  // Uptime sesi global (akumulasi semua ping user)
  let sOk = 0, sTot = 0;
  Object.values(uptime).forEach((u) => { sOk += u.ok; sTot += u.total; });
  const upEl = document.getElementById("session-uptime");
  const chkEl = document.getElementById("session-checks");
  if (upEl) upEl.textContent = sTot ? Math.round((sOk / sTot) * 100) : 100;
  if (chkEl) chkEl.textContent = sTot;

  // Hero ping summary
  const hReach = document.getElementById("h-reach");
  const hUnreach = document.getElementById("h-unreach");
  const hAvg = document.getElementById("h-avg-lat");
  if (hReach) hReach.textContent = ok;
  if (hUnreach) hUnreach.textContent = off;
  if (hAvg) hAvg.textContent = avg;
}

// ── Controls ──
function bindControls() {
  const si = document.getElementById("search-input");
  if (si) si.addEventListener("input", (e) => { searchQuery = e.target.value; renderGrid(); });
  const cf = document.getElementById("cat-filter");
  if (cf) cf.addEventListener("change", (e) => { catFilter = e.target.value; renderGrid(); });
  const rf = document.getElementById("region-filter");
  if (rf) rf.addEventListener("change", (e) => { regionFilter = e.target.value; renderGrid(); });
  const sf = document.getElementById("sort-filter");
  if (sf) sf.addEventListener("change", (e) => { sortKey = e.target.value; renderGrid(); });
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      scope = t.dataset.scope || "all";
      renderGrid();
    })
  );
  // populate category/region from data after load
  setTimeout(() => {
    const cats = [...new Set(isps.map((i) => i.category).filter(Boolean))];
    const regs = [...new Set(isps.map((i) => i.region).filter(Boolean))];
    if (cf) cats.forEach((c) => cf.insertAdjacentHTML("beforeend", `<option value="${c}">${c}</option>`));
    if (rf) regs.forEach((r) => rf.insertAdjacentHTML("beforeend", `<option value="${r}">${r}</option>`));
  }, 500);
}

// ── Live dot berkedip tiap loop ──
function pulseLive() {
  const dot = document.getElementById("live-dot");
  const txt = document.getElementById("live-txt");
  if (dot) { dot.classList.remove("pulse"); void dot.offsetWidth; dot.classList.add("pulse"); }
  if (txt) txt.textContent = "LIVE · user-ping";
}

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  bindControls();
  loadIsps();
  buildDnsBaseline();
  pingDns();
  requestAnimationFrame(animateDns);
  // live dot
  const dot = document.getElementById("live-dot");
  if (dot) { dot.classList.add("pulse"); }
});
