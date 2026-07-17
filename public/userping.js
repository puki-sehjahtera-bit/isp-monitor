"use strict";
// Mode USER PING: list ISP diambil dari API, tapi PING dilakukan dari browser
// user langsung ke target (http_url / isp_ip), bukan dari server.
// Latensi = performance.now() selisih fetch no-cors. Server TIDAK mem-ping apa-apa.

const API_BASE = (window.CONFIG && window.CONFIG.API_BASE) || "";
const WS_URL = (window.CONFIG && window.CONFIG.WS_URL) || undefined;

let isps = [];
let sortKey = "id", searchQuery = "", catFilter = "", regionFilter = "", scope = "all";
let userLatency = {}; // id -> {ms, ok, ts}
const PING_TIMEOUT = 4000;

// ── Ambil list ISP dari API ──
async function loadIsps() {
  const grid = document.getElementById("grid");
  grid.innerHTML = '<div class="loading" style="grid-column:1/-1;text-align:center;padding:30px">Memuat daftar ISP…</div>';
  try {
    const res = await fetch(`${API_BASE}/isps`);
    isps = await res.json();
  } catch (e) {
    grid.innerHTML = '<div class="loading" style="grid-column:1/-1;text-align:center;padding:30px;color:var(--fail)">❌ Gagal memuat /isps. Cek koneksi API.</div>';
    return;
  }
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

// ── Loop ping semua (user-side) ──
let pinging = false;
async function startPingLoop() {
  if (pinging) return;
  pinging = true;
  while (pinging) {
    for (const isp of filtered()) {
      const r = await pingOne(isp);
      userLatency[isp.id] = { ...r, ts: Date.now() };
      updateCard(isp.id);
    }
    updateSummary();
    pulseLive();
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
  // live dot
  const dot = document.getElementById("live-dot");
  if (dot) { dot.classList.add("pulse"); }
});
