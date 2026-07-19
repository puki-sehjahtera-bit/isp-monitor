"use strict";
const API_BASE = (window.CONFIG && window.CONFIG.API_BASE) || "";
const store = {};
window.onerror = (m) => console.error("JS:", m);
let openId = null, detailChart = null, globalChart = null, compChartA = null, compChartB = null;
let countryFilter = "", catFilter = "", regionFilter = "", searchQuery = "", sortKey = "id", scope = "all";
let compactView = false, searchDebounce = null;
const globalPts = [];

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3000);
}
window.toast = toast;

// Real-time ISP alert (dedup 5 min)
let lastAlert = new Map();
function alertIsp(ispName, status, latency) {
  const key = ispName + status;
  const now = Date.now();
  if (lastAlert.get(key) && now - lastAlert.get(key) < 5 * 60 * 1000) return;
  lastAlert.set(key, now);
  const emoji = status === "down" ? "🔴" : status === "up" ? "🟢" : "🟡";
  const msg = `${emoji} ${ispName} ${status === "down" ? "DOWN" : status === "up" ? "RECOVERED" : "DEGRADED"}${latency ? ` (${latency}ms)` : ""}`;
  toast(msg, status === "down" ? "err" : status === "up" ? "ok" : "warn");
}

const FLAGS = { ID:"🇮🇩", US:"🇺🇸", PH:"🇵🇭", MY:"🇲🇾", SG:"🇸🇬", JP:"🇯🇵", DE:"🇩🇪", FR:"🇫🇷", BR:"🇧🇷", SE:"🇸🇪", Global:"🌐" };
const CNAMES = { ID:"Indonesia", US:"Amerika", PH:"Filipina", MY:"Malaysia", SG:"Singapura", JP:"Jepang", DE:"Jerman", FR:"Prancis", BR:"Brazil", SE:"Swedia", Global:"Global" };
const CAT_LABEL = { isp:"ISP", cdn:"CDN", cache:"CACHE", local:"LOKAL" };

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const fmt = (ms) => (ms == null ? "–" : `${ms}ms`);
const badge = (ok) => (ok ? '<span class="pill on">ONLINE</span>' : '<span class="pill off">OFFLINE</span>');
function hostOf(url){ try { return new URL(url).hostname; } catch { return ""; } }
function pingTarget(s){ return s.real_ip || s.isp_ip || hostOf(s.http_url) || "–"; }
function officialBadge(s){
  const o = s.official;
  if (!o) return "";
  if (o.ok) return ` <span class="off-status ok">🌐 ok</span>`;
  return ` <span class="off-status bad">🌐 ${o.incident ? "INCIDENT" : "gangguan"}</span>`;
}
function isOnline(s){ return s.regions && Object.values(s.regions).some((x) => x.status); }

// ── i18n + State ──
let lang = localStorage.getItem("lang") || "id";
let compactMode = localStorage.getItem("compactMode") === "true";
let notificationsEnabled = localStorage.getItem("notificationsEnabled") !== "false";
let autoRefreshInterval = parseInt(localStorage.getItem("refreshInterval") || "15000", 10);
let searchDebounceTimer = null;
let lastOnlineState = new Map(); // track ISP online state for alerts

const I18N = {
  id: {
    searchPlaceholder: "🔍 Cari ISP…",
    all: "Semua",
    refresh: "↻ Refresh",
    exportCsv: "📥 CSV",
    exportJson: "📥 JSON",
    adminPanel: "⚙️ Admin",
    intervalHint: "Cek realtime tiap 10-30 dtk",
    tabs: { all: "Semua", local: "🇮🇩 Lokal", global: "🌐 Global" },
    verifyAll: "✓ Verifikasi Semua",
    refreshBtn: "↻ Refresh",
    loading: "⏳ Memuat data…",
    errorLoad: "❌ Gagal memuat. Coba lagi 3 detik…",
    offline: "TIDAK TERHUBUNG",
    online: "LIVE",
    downloadChart: "📷 Download",
    compare: "📊 Bandingkan",
    embedBadge: "🪪",
    verify: "✓",
    check: "Cek",
    graph: "Grafik",
    download: "📷 Download",
    compareBtn: "📊 Bandingkan",
    statusOk: "ONLINE",
    statusOff: "OFFLINE",
    uptime: "Uptime",
    latency: "Latensi",
    ping: "Ping",
    http: "HTTP",
    status: "Status",
    onlineCount: "Online",
    offlineCount: "Offline",
    avgLatency: "Latensi rata²",
    allSystems: "◉ ALL SYSTEMS OPERATIONAL",
    degraded: "◉ DEGRADED",
    globalOutage: "◉ GLOBAL OUTAGE",
    shareTitle: "ISP Monitor — Pantau Kesehatan ISP secara Real-time",
    copyUrl: "🔗 Salin URL",
    shareTikTok: "🎵 TikTok",
    shareLinkedin: "In LinkedIn",
    shareCopy: "🔗 Salin URL",
    copied: "URL disalin ke clipboard!",
    settings: "⚙️ Pengaturan",
    theme: "Tema",
    dark: "Gelap",
    light: "Terang",
    compactView: "Tampilan Kompak",
    language: "Bahasa",
    autoRefresh: "Auto Refresh",
    refreshInterval: "Interval Refresh (detik)",
    notifications: "Notifikasi Real-time",
    save: "Simpan",
    close: "Tutup",
    emptyState: "Tidak ada ISP yang cocok",
    clearSearch: "Bersihkan pencarian",
    compact: "Kompak",
    normal: "Normal",
    indonesia: "Indonesia",
    english: "English",
    stats: {
      total: "target",
      failed: "gagal",
      lowest: "terendah",
      avg: "rata²",
      highest: "tertinggi"
    },
    connected: "Terhubung",
    disconnected: "Terputus",
    reconnecting: "Reconnect…",
    allSystemsOk: "ALL SYSTEMS OPERATIONAL",
    degradedText: "DEGRADED",
    globalOutageText: "GLOBAL OUTAGE",
  },
  en: {
    searchPlaceholder: "🔍 Search ISP…",
    all: "All",
    refresh: "↻ Refresh",
    exportCsv: "📥 CSV",
    exportJson: "📥 JSON",
    adminPanel: "⚙️ Admin",
    intervalHint: "Realtime check every 10-30s",
    tabs: { all: "All", local: "🇮🇩 Local", global: "🌐 Global" },
    verifyAll: "✓ Verify All",
    refreshBtn: "↻ Refresh",
    loading: "⏳ Loading data…",
    errorLoad: "❌ Failed to load. Retry in 3s…",
    offline: "OFFLINE",
    online: "LIVE",
    downloadChart: "📷 Download",
    compare: "📊 Compare",
    embedBadge: "🪪",
    verify: "✓",
    check: "Check",
    graph: "Graph",
    download: "📷 Download",
    compareBtn: "📊 Compare",
    statusOk: "ONLINE",
    statusOff: "OFFLINE",
    uptime: "Uptime",
    latency: "Latency",
    ping: "Ping",
    http: "HTTP",
    status: "Status",
    onlineCount: "Online",
    offlineCount: "Offline",
    avgLatency: "Avg Latency",
    allSystems: "◉ ALL SYSTEMS OPERATIONAL",
    degraded: "◉ DEGRADED",
    globalOutage: "◉ GLOBAL OUTAGE",
    shareTitle: "ISP Monitor — Real-time ISP Health Monitoring",
    copyUrl: "🔗 Copy URL",
    shareTikTok: "🎵 TikTok",
    shareLinkedin: "In LinkedIn",
    shareCopy: "🔗 Copy URL",
    copied: "URL copied to clipboard!",
    settings: "⚙️ Settings",
    theme: "Theme",
    dark: "Dark",
    light: "Light",
    compactView: "Compact View",
    language: "Language",
    autoRefresh: "Auto Refresh",
    refreshInterval: "Refresh Interval (sec)",
    notifications: "Real-time Notifications",
    save: "Save",
    close: "Close",
    emptyState: "No ISP matches",
    clearSearch: "Clear search",
    compact: "Compact",
    normal: "Normal",
    indonesia: "Indonesia",
    english: "English",
    stats: {
      total: "targets",
      failed: "failed",
      lowest: "lowest",
      avg: "avg",
      highest: "highest"
    },
    connected: "Connected",
    disconnected: "Disconnected",
    reconnecting: "Reconnecting…",
    allSystemsOk: "ALL SYSTEMS OPERATIONAL",
    degradedText: "DEGRADED",
    globalOutageText: "GLOBAL OUTAGE",
  }
};

function t(key) {
  const keys = key.split(".");
  let obj = I18N[lang];
  for (const k of keys) obj = obj?.[k];
  return obj || key;
}

function setLang(l) {
  lang = l;
  localStorage.setItem("lang", l);
  document.documentElement.lang = l;
  applyI18n();
}

function applyI18n() {
  const adminLink = $("a[href='/admin']");
  if (adminLink) adminLink.setAttribute("title", t("adminPanel"));
  const tabAll = $$(".tab[data-scope='all']")[0];
  if (tabAll) tabAll.textContent = t("tabs.all");
  const tabLocal = $$(".tab[data-scope='local']")[0];
  if (tabLocal) tabLocal.textContent = t("tabs.local");
  const tabGlobal = $$(".tab[data-scope='global']")[0];
  if (tabGlobal) tabGlobal.textContent = t("tabs.global");
  const btnVerify = $("#btn-verify-all");
  if (btnVerify) btnVerify.textContent = t("verifyAll");
  const liveTxt = $("#live-txt");
  if (liveTxt) liveTxt.textContent = t("online");
  // Update modal buttons
  const modalClose = $("#modal-close");
  if (modalClose) modalClose.textContent = "✕";
  const compareClose = $("#compare-close");
  if (compareClose) compareClose.textContent = "✕";
  // Update buttons
  $$(".mini").forEach((b, i) => {
    if (b.textContent.includes("Grafik") || b.textContent.includes("Graph")) b.textContent = "📊";
    if (b.textContent.includes("Cek") || b.textContent.includes("Check")) b.textContent = t("check");
    if (b.textContent.includes("Grafik") || b.textContent.includes("Graph")) b.textContent = t("graph");
    if (b.textContent.includes("🪪") || b.textContent.includes("Embed")) b.textContent = "🪪";
    if (b.textContent.includes("✓")) b.textContent = t("verify");
    if (b.textContent.includes("Cek") || b.textContent.includes("Check")) b.textContent = t("check");
  });
  // Re-render table to update headers
  renderTable();
}

// ── Load ──
async function loadDashboard() {
  try {
    const grid = $("#grid");
    if (grid && !grid.children.length) {
      grid.innerHTML = Array(8).fill(0).map(() => `
        <div class="ispcard skeleton-card">
          <div class="skeleton-title"></div>
          <div class="skeleton-text short"></div>
          <div class="skeleton-metric"></div>
          <div class="skeleton-metric"></div>
          <div class="skeleton-metric"></div>
          <div class="skeleton-metric"></div>
          <div class="skeleton-spark"></div>
          <div class="skeleton-text medium"></div>
          <div class="skeleton-actions"></div>
        </div>
      `).join("");
    }
    const [dash, regions, stats] = await Promise.all([
      fetch(`${API_BASE}/api/dashboard`).then((r) => r.json()),
      fetch(`${API_BASE}/api/regions`).then((r) => r.json()),
      fetch(`${API_BASE}/api/stats`).then((r) => r.json()),
    ]);
    dash.forEach((d) => {
      const prev = store[d.id];
      const latest = prev?.latest || {};
      if (!latest.combined && d.recent_status?.length) {
        const r = d.recent_status[0];
        latest.combined = { ok: !!r.status, latency: r.latency_ms };
      }
      const spark = prev?.spark || [];
      const lat = latest.combined?.latency;
      if (lat != null) { spark.push(lat); if (spark.length > 30) spark.shift(); }
      store[d.id] = { ...d, latest, spark };
    });
    $("#st-online-total") && ($("#st-online-total").textContent = stats.total_isps);
    renderSummary(stats);
    renderHero();
    renderRegionGroups();
    renderTable();
    renderStatusBanner();
    setLive(true);
  } catch (e) {
    console.error("dashboard gagal:", e);
    setLive(false);
    const grid = $("#grid");
    if (grid && grid.querySelector(".loading")) {
      grid.innerHTML = '<div class="loading" style="grid-column:1/-1;text-align:center;padding:30px;color:var(--fail)">❌ Gagal memuat. Coba lagi 3 detik…</div>';
    }
    toast("Gagal muat data — coba lagi", "err");
    setTimeout(loadDashboard, 3000);
  }
}

function setLive(on) {
  const p = $("#live-dot"); if (!p) return;
  const wrap = p.parentElement;
  if (on) { wrap.classList.remove("off"); p.classList.add("pulse"); $("#live-txt").textContent = "LIVE"; }
  else { wrap.classList.add("off"); p.classList.remove("pulse"); $("#live-txt").textContent = "TIDAK TERHUBUNG"; }
}

function renderHero() {
  const all = Object.values(store);
  const on = all.filter(isOnline).length;
  const off = all.length - on;
  const lat = all.filter(isOnline).map((s) => s.latest?.combined?.latency).filter((l) => l != null);
  const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0;
  const pct = all.length ? Math.round((on / all.length) * 100) : 0;
  $("#hero-online").textContent = on;
  $("#hero-offline").textContent = off;
  $("#hero-avg").textContent = avg ? avg + "ms" : "–";
  $("#hero-sub").textContent = `Memantau ${all.length} target di ${new Set(all.map((s) => s.country)).size} negara secara realtime.`;
  const g = $("#gauge");
  const col = off === 0 ? "var(--ok)" : on === 0 ? "var(--fail)" : "var(--warn)";
  g.style.background = `conic-gradient(${col} ${pct * 3.6}deg, var(--line) 0)`;
  $("#gauge-val").textContent = pct + "%";
  const badge = $("#hero-badge");
  if (off === 0) { badge.textContent = "◉ ALL SYSTEMS OPERATIONAL"; badge.className = "hero-badge ok"; }
  else if (on === 0) { badge.textContent = "◉ GLOBAL OUTAGE"; badge.className = "hero-badge bad"; }
  else { badge.textContent = `◉ DEGRADED — ${off} offline`; badge.className = "hero-badge warn"; }
}

// ── Summary ──
function renderSummary(stats) {
  const all = Object.values(store);
  const on = all.filter(isOnline).length;
  const off = all.length - on;
  const onlineL = all.filter(isOnline).map((s) => s.latest?.combined?.latency).filter((l) => l != null);
  const avg = onlineL.length ? Math.round(onlineL.reduce((a, b) => a + b, 0) / onlineL.length) : 0;
  const withCache = all.filter((s) => s.cache && s.cache.total_checks > 0);
  const best = withCache.slice().sort((a, b) => (b.cache.uptime_percent || 0) - (a.cache.uptime_percent || 0))[0];
  const worst = withCache.slice().sort((a, b) => (a.cache.uptime_percent || 0) - (b.cache.uptime_percent || 0))[0];
  const cards = [
    { v: all.length, l: "Total Target", accent: "var(--acc)", ic: "🎯" },
    { v: `${on}`, l: "Online", accent: "var(--ok)", ic: "✅" },
    { v: `${off}`, l: "Offline", accent: "var(--fail)", ic: "❌" },
    { v: avg ? avg + "ms" : "–", l: "Avg Latensi", accent: "var(--acc2)", ic: "⚡" },
    { v: best ? `${best.name} ${best.cache.uptime_percent.toFixed(0)}%` : "–", l: "Terbaik", accent: "var(--ok)", ic: "🏆" },
    { v: worst ? `${worst.name} ${worst.cache.uptime_percent.toFixed(0)}%` : "–", l: "Terburuk", accent: "var(--warn)", ic: "⚠️" },
    { v: (stats && stats.checks_today) || 0, l: "Cek Hari Ini", accent: "var(--acc)", ic: "📊" },
  ];
  $("#summary").innerHTML = cards.map((c) =>
    `<div class="scard" style="--accent:${c.accent}"><span class="ic">${c.ic}</span><div class="v">${c.v}</div><div class="l">${c.l}</div></div>`
  ).join("");
}

// ── Banner status keseluruhan (gaya Checkmate) ──
function renderStatusBanner() {
  const all = Object.values(store);
  if (!all.length) return;
  const on = all.filter(isOnline).length;
  const off = all.length - on;
  const dot = $("#sb-dot"), title = $("#sb-title"), sub = $("#sb-sub");
  const up = $("#sb-up"), down = $("#sb-down");
  if (off === 0) { dot.className = "sb-dot ok"; title.textContent = "All systems operational"; }
  else if (on === 0) { dot.className = "sb-dot bad"; title.textContent = "Major outage detected"; }
  else { dot.className = "sb-dot warn"; title.textContent = "Degraded performance"; }
  sub.textContent = `${all.length} monitors · ${new Set(all.map((s) => s.country)).size} countries`;
  up.textContent = on; down.textContent = off;
}

// ── Region groups ──
function renderRegionGroups() {
  const groups = {};
  Object.values(store).forEach((s) => {
    const c = s.country || "?";
    groups[c] = groups[c] || { total: 0, on: 0 };
    groups[c].total++;
    if (isOnline(s)) groups[c].on++;
  });
  const el = $("#region-groups");
  el.innerHTML = Object.entries(groups).map(([c, g]) => {
    const pct = g.total ? Math.round((g.on / g.total) * 100) : 0;
    const state = g.on === 0 ? "off" : g.on === g.total ? "on" : "part";
    const active = countryFilter === c ? "outline:2px solid var(--acc)" : "";
    return `<div class="rcard" data-country="${c}" style="${active}">
      <div class="flag">${FLAGS[c] || "🌐"}</div>
      <div class="cname">${CNAMES[c] || c}</div>
      <div class="cstat"><span class="rdot ${state}"></span>${g.on}/${g.total} online</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join("");
  el.querySelectorAll(".rcard").forEach((card) => {
    card.onclick = () => {
      countryFilter = countryFilter === card.dataset.country ? "" : card.dataset.country;
      renderRegionGroups(); renderTable();
    };
  });
}

// ── Grid kartu ISP ──
function renderTable() {
  const grid = $("#grid");
  grid.innerHTML = "";
  const q = searchQuery.toLowerCase();
  Object.values(store)
    .filter((s) => !catFilter || (s.category || "isp") === catFilter)
    .filter((s) => !regionFilter || (s.regions && s.regions[regionFilter]))
    .filter((s) => !countryFilter || s.country === countryFilter)
    .filter((s) => scope === "all" || (scope === "local" ? s.country === "ID" : s.country !== "ID"))
    .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.country || "").toLowerCase().includes(q) || (s.isp_ip || "").includes(q) || (s.asn || "").includes(q))
    .sort((a, b) => sortCards(a, b))
    .forEach((s) => grid.appendChild(cardEl(s)));
}

function sortCards(a, b) {
  switch (sortKey) {
    case "name": return a.name.localeCompare(b.name);
    case "latency": return (a.latest?.combined?.latency ?? 1e9) - (b.latest?.combined?.latency ?? 1e9);
    case "uptime": return (b.cache?.uptime_percent ?? 0) - (a.cache?.uptime_percent ?? 0);
    case "status": {
      const da = a.latest?.combined?.ok ? 0 : 1, db_ = b.latest?.combined?.ok ? 0 : 1;
      return da - db_ || a.id - b.id;
    }
    default: return a.id - b.id;
  }
}

function cardEl(s) {
  const div = document.createElement("div");
  div.id = "card-" + s.id;
  const cat = s.category || "isp";
  div.className = "ispcard";
  div.innerHTML = `
    <div class="ic-head">
      <span class="sdot" id="sdot-${s.id}"></span>
      <div class="ic-id">
        <div class="ic-name"><b>${s.name}</b> <span class="tag tag-${cat}">${CAT_LABEL[cat] || cat}</span>${s.asn ? ` <span class="asn">AS${s.asn}</span>` : ""}</div>
        <div class="ic-sub">${FLAGS[s.country] || ""} ${s.country}${s.region && s.region !== "Global" ? " · " + s.region : ""} · ↳ ${pingTarget(s)}</div>
      </div>
    </div>
    <div class="ic-metrics">
      <div class="m"><span>Uptime</span><b id="up-${s.id}">–</b></div>
      <div class="m"><span>Latency</span><b id="comb-${s.id}">–</b></div>
      <div class="m"><span>Ping</span><b id="ping-${s.id}">–</b></div>
      <div class="m"><span>HTTP</span><b id="http-${s.id}">–</b></div>
    </div>
    <canvas class="spark" id="spark-${s.id}" width="140" height="34"></canvas>
    <div id="reg-${s.id}" class="regions-cell ic-reg"></div>
    <div class="ic-actions">
      <button class="mini" onclick="manual(${s.id})">Cek</button>
      <button class="mini" onclick="openDetail(${s.id})">Grafik</button>
      <button class="mini" onclick="embedBadge(${s.id})">🪪</button>
      <button class="mini" onclick="verifyOne(${s.id})">✓</button>
      <span id="vrf-${s.id}" class="vbadge">${s.verify?.match === true ? "✅" : s.verify?.match === false ? "⚠️" : ""}</span>
    </div>`;
  setTimeout(() => { updateRow(s.id); drawSpark(s.id); if (!s.verify) loadVerify(s.id); }, 0);
  return div;
}

async function loadVerify(id) {
  try {
    const v = await fetch(`${API_BASE}/verify/${id}`).then((r) => r.json());
    store[id].verify = v;
    const el = $(`#vrf-${id}`);
    if (el) el.textContent = v.match === true ? "✅" : v.match === false ? "⚠️" : "";
  } catch {}
}
window.verifyOne = async (id) => {
  const el = $(`#vrf-${id}`);
  if (el) el.textContent = "…";
  const v = await fetch(`${API_BASE}/verify/${id}`).then((r) => r.json());
  store[id].verify = v;
  if (el) el.textContent = v.match === true ? "✅" : v.match === false ? "⚠️" : "";
  if (v.match === false) console.warn(`Verifikasi ${id}: ASN beda`, v);
};
window.verifyAll = async () => {
  const ids = Object.values(store).filter((s) => !catFilter || (s.category || "isp") === catFilter)
    .filter((s) => !countryFilter || s.country === countryFilter)
    .filter((s) => scope === "all" || (scope === "local" ? s.country === "ID" : s.country !== "ID"))
    .map((s) => s.id);
  for (const id of ids) { await window.verifyOne(id); await new Promise((r) => setTimeout(r, 250)); }
};

function updateRow(id) {
  const s = store[id]; if (!s) return;
  const ping = s.latest?.ping, http = s.latest?.http, comb = s.latest?.combined;
  const card = $(`#card-${id}`);
  if (card) { card.classList.toggle("row-off", !(comb?.ok)); card.classList.toggle("row-on", !!comb?.ok); }
  const dot = $(`#sdot-${id}`);
  if (dot) dot.className = "sdot " + (comb?.ok ? "ok" : "bad");
  const set = (sel, html) => { const e = $(sel); if (e) e.innerHTML = html; };
  set(`#ping-${id}`, ping?.ok !== undefined ? `${ping.ok ? "✅" : "❌"} ${fmt(ping.latency)}` : "–");
  set(`#http-${id}`, http?.ok !== undefined ? `${http.ok ? "✅" : "❌"} ${fmt(http.latency)}` : "–");
  set(`#comb-${id}`, (comb?.ok !== undefined ? badge(comb.ok) + ` <small>${fmt(comb.latency)}</small>` : "–") + officialBadge(s));
  set(`#up-${id}`, s.cache ? `${s.cache.uptime_percent.toFixed(1)}%<div class="bar"><i style="width:${s.cache.uptime_percent}%"></i></div>` : "–");
  set(`#reg-${id}`, s.regions ? Object.entries(s.regions).map(([p, v]) => `<span class="${v.status ? "ok" : "bad"}">${p}${v.asn ? `(AS${v.asn})` : ""}:${v.status ? "✓" : "✗"}</span>`).join("") : "");
}

function flashRow(id) {
  const el = $(`#card-${id}`); if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth; // reflow biar animasi bisa diulang
  el.classList.add("flash");
}

function drawSpark(id) {
  const s = store[id]; const cv = $(`#spark-${id}`); if (!cv || !s) return;
  const ctx = cv.getContext("2d");
  const data = s.spark;
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!data.length) return;
  const w = cv.width, h = cv.height, pad = 2;
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / rng) * (h - pad * 2);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = data[data.length - 1] != null ? "#58a6ff" : "#8b949e";
  ctx.lineWidth = 1.6; ctx.stroke();
}

// ── Realtime (polling tiap 15 dtk, bukan socket.io) ──
let pollTimer = null;
async function pollDashboard() {
  try { await loadDashboard(); }
  catch (e) { setLive(false); }
}
  if (pollTimer) clearInterval(pollTimer);
pollTimer = setInterval(pollDashboard, 60000);

function pushGlobal() {
  const on = Object.values(store).filter((s) => s.latest?.combined?.ok && s.latest.combined.latency != null);
  const avg = on.length ? Math.round(on.reduce((a, s) => a + s.latest.combined.latency, 0) / on.length) : 0;
  globalPts.push({ x: new Date().toLocaleTimeString(), y: avg });
  if (globalPts.length > 60) globalPts.shift();
  if (globalChart) globalChart.update("none");
}

function initGlobalChart() {
  globalChart = new Chart($("#globalChart"), {
    type: "line",
    data: { datasets: [{ label: "Avg latensi (ms)", data: globalPts, borderColor: "#58a6ff",
      backgroundColor: "rgba(88,166,255,.15)", fill: true, tension: 0.35, pointRadius: 0 }] },
    options: { animation: false, responsive: true,
      scales: { x: { ticks: { color: "#8b949e", maxTicksLimit: 6 }, grid: { color: "#21262d" } },
                y: { ticks: { color: "#8b949e" }, grid: { color: "#21262d" }, beginAtZero: true } },
      plugins: { legend: { labels: { color: "#8b949e" } } } },
  });
}

// ── Detail ──
function buildChart(id, canvasId, hist, labelA = "Ping", labelB = "HTTP", labelC = "Combined") {
  const ping = hist.filter((h) => h.check_type === "ping").map((h) => ({ x: h.recorded_at, y: h.latency_ms }));
  const http = hist.filter((h) => h.check_type === "http").map((h) => ({ x: h.recorded_at, y: h.latency_ms }));
  const cmb = hist.filter((h) => h.check_type === "combined").map((h) => ({ x: h.recorded_at, y: h.latency_ms }));
  return new Chart($(canvasId), {
    type: "line",
    data: { datasets: [
      { label: labelA, data: ping, borderColor: "#3fb950", pointRadius: 0, tension: 0.3 },
      { label: labelB, data: http, borderColor: "#58a6ff", pointRadius: 0, tension: 0.3 },
      { label: labelC, data: cmb, borderColor: "#d29922", pointRadius: 0, tension: 0.3 },
    ]},
    options: { animation: false, responsive: true,
      scales: { x: { ticks: { color: "#8b949e", maxTicksLimit: 6 }, grid: { color: "#21262d" } },
                y: { ticks: { color: "#8b949e" }, grid: { color: "#21262d" }, beginAtZero: true } },
      plugins: { legend: { labels: { color: "#8b949e" } } } },
  });
}
function renderTimeline(hist) {
  const el = $("#modal-timeline");
  if (!hist.length) return el.innerHTML = "";
  const dayMs = 86400000;
  const now = Date.now();
  const oldest = now - (hist[0]?.recorded_at ? Math.min(now - new Date(hist[hist.length-1].recorded_at).getTime(), dayMs) : dayMs);
  const buckets = 48;
  const gap = (now - oldest) / buckets;
  const bars = Array(buckets).fill(0);
  const counts = Array(buckets).fill(0);
  for (const h of hist) {
    const idx = Math.min(buckets - 1, Math.floor((new Date(h.recorded_at).getTime() - oldest) / gap));
    if (h.check_type === "combined") { bars[idx] += h.status ? 1 : 0; counts[idx]++; }
  }
  el.innerHTML = counts.map((c, i) => {
    if (!c) return '<div class="bar" style="background:var(--line)"></div>';
    const pct = bars[i] / c;
    const cls = pct === 1 ? "up" : pct > 0.5 ? "mixed" : "down";
    const hgt = Math.max(4, Math.round(pct * 28));
    return `<div class="bar ${cls}" style="height:${hgt}px" title="${Math.round(pct*100)}%"></div>`;
  }).join("");
}
async function openDetail(id, range = "24h") {
  openId = id; const s = store[id];
  $("#modal-title").textContent = `Analitik — ${s.name}`;
  $("#modal").classList.remove("hidden");
  $$(".range-btn").forEach((b) => b.classList.toggle("active", b.dataset.range === range));
  const hist = await fetch(`${API_BASE}/history/${id}?range=${range}`).then((r) => r.json());
  const last = hist[0];
  $("#modal-spark").textContent = last ? `Terakhir: ${last.recorded_at} · ${last.status ? "UP" : "DOWN"}` : "Belum ada data";
  if (detailChart) detailChart.destroy();
  detailChart = buildChart(id, "#detailChart", hist);
  renderTimeline(hist);
  window._detailHist = hist;
}
document.querySelectorAll(".range-btn").forEach((b) => {
  b.onclick = () => { if (openId) openDetail(openId, b.dataset.range); };
});

function pushDetail(p) {
  if (!detailChart) return;
  const t = new Date().toISOString();
  const ds = detailChart.data.datasets;
  if (p.ping) ds[0].data.push({ x: t, y: p.ping.latency });
  if (p.http) ds[1].data.push({ x: t, y: p.http.latency });
  if (p.combined) ds[2].data.push({ x: t, y: p.combined.latency });
  ds.forEach((s) => { if (s.data.length > 300) s.data.shift(); });
  detailChart.update("none");
  $("#modal-live").textContent = `Live @ ${new Date().toLocaleTimeString()} · ping ${fmt(p.ping?.latency)} · http ${fmt(p.http?.latency)}`;
}
window.openDetail = openDetail;
window.manual = (id) => {
  fetch(`${API_BASE}/api/isps/${id}/check`, { method: "POST" })
    .then(() => loadDashboard())
    .catch(() => toast("Gagal cek ulang", "err"));
};
$("#modal-close").onclick = () => { $("#modal").classList.add("hidden"); openId = null; };
document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    scope = t.dataset.scope;
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    renderTable();
  };
});
$("#btn-verify-all").onclick = () => window.verifyAll();

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea")) return;
  switch (e.key.toLowerCase()) {
    case "r": loadDashboard(); break;
    case "escape":
      if (!$("#modal").classList.contains("hidden")) $("#modal-close").click();
      if (!$("#compare-modal").classList.contains("hidden")) $("#compare-close").click();
      break;
    case "1": scope = "all"; document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.scope === "all")); renderTable(); break;
    case "2": scope = "local"; document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.scope === "local")); renderTable(); break;
    case "3": scope = "global"; document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.scope === "global")); renderTable(); break;
    case "c": compactMode = !compactMode; localStorage.setItem("compactMode", compactMode); applyCompactMode(); break;
  }
});

function applyCompactMode() {
  document.body.classList.toggle("compact", compactMode);
  localStorage.setItem("compactMode", compactMode);
}

// ── Share functions ──
const SHARE_URL = window.location.origin;
const SHARE_TITLE = "ISP Monitor — Pantau Kesehatan ISP secara Real-time";
function onlineCount() {
  const all = Object.values(store);
  const on = all.filter(isOnline).length;
  return `${on}/${all.length} ISP online · Latensi rata-rata: ${
    (() => {
      const lats = all.filter(isOnline).map((s) => s.latest?.combined?.latency).filter((l) => l != null);
      return lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) + "ms" : "–";
    })()
  }`;
}
window.shareTikTok = () => {
  window.open("https://vt.tiktok.com/ZSXkMfy2m/", "_blank");
};
window.shareLinkedin = () => {
  const text = encodeURIComponent(`${onlineCount()} — ${SHARE_TITLE}`);
  window.open(`https://linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SHARE_URL)}&title=${text}`, "_blank", "width=600,height=400");
};
window.shareCopyUrl = () => {
  navigator.clipboard.writeText(SHARE_URL).then(() => alert("URL disalin ke clipboard!")).catch(() => prompt("Salin URL ini:", SHARE_URL));
};

// ── Download chart ──
window.downloadChart = () => {
  const c = $("#detailChart");
  if (!c) return;
  const link = document.createElement("a");
  link.download = `isp-${openId}-${new Date().toISOString().slice(0,10)}.png`;
  link.href = c.toDataURL("image/png");
  link.click();
};

// ── Compare ISP ──
function fillCompSelects() {
  const opts = Object.values(store).sort((a, b) => a.name.localeCompare(b.name)).map((s) =>
    `<option value="${s.id}">${s.name}</option>`
  ).join("");
  $("#comp-a").innerHTML = opts;
  $("#comp-b").innerHTML = opts;
}
async function loadCompChart(id, canvasId, nameId) {
  const hist = await fetch(`${API_BASE}/history/${id}?range=24h`).then((r) => r.json());
  $(nameId).textContent = Object.values(store).find((s) => s.id === id)?.name || "";
  const ch = buildChart(id, canvasId, hist);
  return ch;
}
window.compareIsp = async () => {
  fillCompSelects();
  $("#compare-modal").classList.remove("hidden");
  const a = Number($("#comp-a").value) || Object.values(store)[0]?.id;
  const b = Number($("#comp-b").value) || Object.values(store)[1]?.id;
  if (compChartA) { compChartA.destroy(); compChartB.destroy(); }
  compChartA = await loadCompChart(a, "#compChartA", "#comp-a-name");
  compChartB = await loadCompChart(b, "#compChartB", "#comp-b-name");
};
$("#comp-a").onchange = window.compareIsp;
$("#comp-b").onchange = window.compareIsp;
$("#compare-close").onclick = () => { $("#compare-modal").classList.add("hidden"); };

// ── Affiliate links loader ──
async function loadAffiliates() {
  try {
    const res = await fetch(`${API_BASE}/api/affiliates`);
    const data = await res.json();
    const container = $("#affiliate-links");
    if (!container || !data?.links?.length) return;
    container.innerHTML = data.links.map(l =>
      `<a href="${l.url}" target="_blank" rel="noopener" class="aff-link" title="${l.desc || ''}">${l.label}</a>`
    ).join("");
  } catch (e) { console.warn("Affiliate load failed:", e); }
}

// ── Embed badge generator ──
window.embedBadge = (id) => {
  const url = `${window.location.origin}/badge/${id}`;
  const code = `<a href="${window.location.origin}" target="_blank"><img src="${url}" alt="ISP Status" /></a>`;
  navigator.clipboard.writeText(code).then(() => alert("Kode embed badge disalin!"));
};

// ── Mode gelap / terang ──
function applyTheme(theme) {
  if (theme === "light") document.body.classList.add("light");
  else document.body.classList.remove("light");
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = theme === "light" ? "🌞" : "🌙";
}
(function initTheme() {
  const t = localStorage.getItem("theme") || "dark";
  applyTheme(t);
})();
const themeBtn = document.getElementById("theme-toggle");
if (themeBtn) themeBtn.addEventListener("click", () => {
  const next = document.body.classList.contains("light") ? "dark" : "light";
  localStorage.setItem("theme", next);
  applyTheme(next);
});

loadAffiliates();
initGlobalChart();
loadDashboard();
