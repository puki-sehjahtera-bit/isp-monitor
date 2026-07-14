"use strict";
const socket = io();
const store = {};
let openId = null, detailChart = null, globalChart = null;
let countryFilter = "", catFilter = "", regionFilter = "";
const globalPts = [];

const FLAGS = { ID:"🇮🇩", US:"🇺🇸", PH:"🇵🇭", MY:"🇲🇾", SG:"🇸🇬", JP:"🇯🇵", DE:"🇩🇪", FR:"🇫🇷", BR:"🇧🇷", SE:"🇸🇪", Global:"🌐" };
const CNAMES = { ID:"Indonesia", US:"Amerika", PH:"Filipina", MY:"Malaysia", SG:"Singapura", JP:"Jepang", DE:"Jerman", FR:"Prancis", BR:"Brazil", SE:"Swedia", Global:"Global" };
const CAT_LABEL = { isp:"ISP", cdn:"CDN", cache:"CACHE" };

const $ = (s) => document.querySelector(s);
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

// ── Theme ──
function applyTheme(t){ document.body.classList.toggle("light", t === "light"); }
applyTheme(localStorage.getItem("theme") || "dark");
$("#theme-toggle").onclick = () => {
  const t = document.body.classList.contains("light") ? "dark" : "light";
  applyTheme(t); localStorage.setItem("theme", t);
};

// ── Load ──
async function loadDashboard() {
  const [dash, regions, stats] = await Promise.all([
    fetch("/dashboard").then((r) => r.json()),
    fetch("/regions").then((r) => r.json()),
    fetch("/stats").then((r) => r.json()),
  ]);
  dash.forEach((d) => {
    const prev = store[d.id];
    store[d.id] = {
      ...d, latest: prev?.latest || {},
      spark: prev?.spark || [],
    };
    if (prev?.latest) store[d.id].latest = prev.latest;
  });
  $("#st-online-total") && ($("#st-online-total").textContent = stats.total_isps);
  fillRegionFilter(regions);
  fillCatFilter();
  renderSummary(stats);
  renderHero();
  renderRegionGroups();
  renderTable();
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

function fillRegionFilter(regions) {
  const sel = $("#region-filter"); const cur = sel.value;
  sel.innerHTML = '<option value="">Semua</option>' + regions.map((r) => `<option>${r}</option>`).join("");
  sel.value = cur;
}
function fillCatFilter() {
  const cats = [...new Set(Object.values(store).map((s) => s.category || "isp"))];
  const sel = $("#cat-filter"); const cur = sel.value;
  sel.innerHTML = '<option value="">Semua</option>' + cats.map((c) => `<option value="${c}">${CAT_LABEL[c] || c}</option>`).join("");
  sel.value = cur;
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
    { v: stats.checks_today || 0, l: "Cek Hari Ini", accent: "var(--acc)", ic: "📊" },
  ];
  $("#summary").innerHTML = cards.map((c) =>
    `<div class="scard" style="--accent:${c.accent}"><span class="ic">${c.ic}</span><div class="v">${c.v}</div><div class="l">${c.l}</div></div>`
  ).join("");
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
  Object.values(store)
    .filter((s) => !catFilter || (s.category || "isp") === catFilter)
    .filter((s) => !regionFilter || (s.regions && s.regions[regionFilter]))
    .filter((s) => !countryFilter || s.country === countryFilter)
    .sort((a, b) => a.id - b.id)
    .forEach((s) => grid.appendChild(cardEl(s)));
}

function cardEl(s) {
  const div = document.createElement("div");
  div.id = "card-" + s.id;
  const cat = s.category || "isp";
  div.className = "ispcard";
  div.innerHTML = `
    <div class="ic-top">
      <div class="ic-name"><b>${s.name}</b> <span class="tag tag-${cat}">${CAT_LABEL[cat] || cat}</span>${s.asn ? ` <span class="asn">AS${s.asn}</span>` : ""}</div>
      <div class="ic-loc">${FLAGS[s.country] || ""} ${s.country}${s.region && s.region !== "Global" ? " · " + s.region : ""}</div>
    </div>
    <div class="ic-target">↳ ${pingTarget(s)}</div>
    <div class="ic-metrics">
      <div class="m"><span>Ping</span><b id="ping-${s.id}">–</b></div>
      <div class="m"><span>HTTP</span><b id="http-${s.id}">–</b></div>
      <div class="m"><span>Status</span><b id="comb-${s.id}">–</b></div>
      <div class="m"><span>Uptime</span><b id="up-${s.id}">–</b></div>
    </div>
    <canvas class="spark" id="spark-${s.id}" width="240" height="26"></canvas>
    <div id="reg-${s.id}" class="regions-cell ic-reg"></div>
    <div class="ic-actions">
      <button class="mini" onclick="manual(${s.id})">Cek</button>
      <button class="mini" onclick="openDetail(${s.id})">Grafik</button>
    </div>`;
  setTimeout(() => { updateRow(s.id); drawSpark(s.id); }, 0);
  return div;
}

function updateRow(id) {
  const s = store[id]; if (!s) return;
  const ping = s.latest?.ping, http = s.latest?.http, comb = s.latest?.combined;
  const tr = $(`#row-${id}`);
  if (tr) tr.classList.toggle("row-off", !(comb?.ok)); tr?.classList.toggle("row-on", !!comb?.ok);
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

// ── Realtime ──
socket.on("dashboard", () => loadDashboard());
socket.on("connect", () => { $("#live-dot").parentElement.classList.remove("off"); $("#live-txt").textContent = "LIVE"; });
socket.on("disconnect", () => { const l = $("#live-dot").parentElement; l.classList.add("off"); $("#live-txt").textContent = "OFFLINE"; });

socket.on("check", (p) => {
  const s = store[p.ispId]; if (!s) return;
  if (p.ping && p.http) { s.latest.ping = p.ping; s.latest.http = p.http; s.latest.combined = p.combined; }
  else if (p.combined) s.latest.combined = p.combined;
  if (p.status) s.official = p.status;
  s.regions = s.regions || {};
  s.regions[p.probe] = { status: !!(p.combined?.ok ?? p.ping?.ok), latency: p.combined?.latency ?? p.ping?.latency };
  if (p.combined?.ok && p.combined.latency != null) {
    s.spark = s.spark || [];
    s.spark.push(p.combined.latency);
    if (s.spark.length > 30) s.spark.shift();
  }
  updateRow(p.ispId);
  drawSpark(p.ispId);
  flashRow(p.ispId);
  pushGlobal();
  renderSummary();
  renderHero();
  renderRegionGroups();
  if (openId === p.ispId) pushDetail(p);
});

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
async function openDetail(id) {
  openId = id; const s = store[id];
  $("#modal-title").textContent = `Analitik — ${s.name}`;
  $("#modal").classList.remove("hidden");
  const hist = await fetch(`/history/${id}?limit=300`).then((r) => r.json());
  const ping = hist.filter((h) => h.check_type === "ping").map((h) => ({ x: h.recorded_at, y: h.latency_ms }));
  const http = hist.filter((h) => h.check_type === "http").map((h) => ({ x: h.recorded_at, y: h.latency_ms }));
  const cmb = hist.filter((h) => h.check_type === "combined").map((h) => ({ x: h.recorded_at, y: h.latency_ms }));
  const last = hist[0];
  $("#modal-spark").textContent = last ? `Terakhir: ${last.recorded_at} · ${last.status ? "UP" : "DOWN"}` : "Belum ada data";
  if (detailChart) detailChart.destroy();
  detailChart = new Chart($("#detailChart"), {
    type: "line",
    data: { datasets: [
      { label: "Ping", data: ping, borderColor: "#3fb950", pointRadius: 0, tension: 0.3 },
      { label: "HTTP", data: http, borderColor: "#58a6ff", pointRadius: 0, tension: 0.3 },
      { label: "Combined", data: cmb, borderColor: "#d29922", pointRadius: 0, tension: 0.3 },
    ]},
    options: { animation: false, responsive: true,
      scales: { x: { ticks: { color: "#8b949e", maxTicksLimit: 6 }, grid: { color: "#21262d" } },
                y: { ticks: { color: "#8b949e" }, grid: { color: "#21262d" }, beginAtZero: true } },
      plugins: { legend: { labels: { color: "#8b949e" } } } },
  });
}
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
window.manual = (id) => socket.emit("pingNow", { ispId: id });
$("#modal-close").onclick = () => { $("#modal").classList.add("hidden"); openId = null; };
$("#cat-filter").onchange = (e) => { catFilter = e.target.value; renderTable(); };
$("#region-filter").onchange = (e) => { regionFilter = e.target.value; renderTable(); };
$("#btn-refresh").onclick = loadDashboard;

// ── SSE fallback ──
(() => {
  if (!window.EventSource) return;
  const es = new EventSource("/events");
  es.onmessage = (e) => {
    try {
      const p = JSON.parse(e.data);
      if (p.type === "connected") return;
      const ev = new CustomEvent("sse-check", { detail: p });
      window.dispatchEvent(ev);
    } catch {}
  };
  es.onerror = () => {};
})();

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
window.shareTwitter = () => {
  const text = encodeURIComponent(`${onlineCount()} — ${SHARE_TITLE}\n${SHARE_URL}`);
  window.open(`https://twitter.com/intent/tweet?text=${text}`, "_blank", "width=600,height=400");
};
window.shareLinkedin = () => {
  const text = encodeURIComponent(`${onlineCount()} — ${SHARE_TITLE}`);
  window.open(`https://linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SHARE_URL)}&title=${text}`, "_blank", "width=600,height=400");
};
window.shareCopyUrl = () => {
  navigator.clipboard.writeText(SHARE_URL).then(() => alert("URL disalin ke clipboard!")).catch(() => prompt("Salin URL ini:", SHARE_URL));
};

initGlobalChart();
loadDashboard();
setInterval(loadDashboard, 15000);
