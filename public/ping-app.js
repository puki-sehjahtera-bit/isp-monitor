// Hubungkan ke Server via Socket.IO (otomatis menyesuaikan host)
// Paksa websocket dulu biar cloudflare gak buffer polling (update realtime).
const API_BASE = (window.CONFIG && window.CONFIG.API_BASE) || "";
const WS_URL = (window.CONFIG && window.CONFIG.WS_URL) || undefined;
const socket = io(WS_URL, { transports: ["websocket", "polling"] });

socket.on("connect", () => {
  console.log("Terhubung ke server via Socket.IO");
});

socket.on("connect_error", (err) => {
  console.error("Socket connect error:", err.message);
});

// Mode gelap/terang
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
function toggleTheme() {
  const next = document.body.classList.contains("light") ? "dark" : "light";
  localStorage.setItem("theme", next);
  applyTheme(next);
}
socket.on("ping:dashboard", (payload) => {
  if (payload.type === "INIT_DATA") {
    window.__lastReports = payload.reports;
    renderTargets(payload.targets);
    renderReports(payload.reports);
  } else if (payload.type === "INTERNAL_MONITOR_UPDATE") {
    renderTargets(payload.data);
  } else if (payload.type === "NEW_USER_REPORT") {
    window.__lastReports = payload.allReports;
    renderReports(payload.allReports);
  } else if (payload.type === "REPORTS_CLEARED") {
    window.__lastReports = [];
    renderReports([]);
  }
});

// Hapus semua laporan (butuh token admin)
async function clearReports() {
  const token = prompt("Token admin untuk hapus semua laporan:");
  if (!token) return;
  try {
    const r = await fetch(`${API_BASE}/api/reports`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!r.ok) return alert("Gagal: token salah atau tidak punya akses.");
    alert("Semua laporan dihapus.");
  } catch (e) { alert("Gagal: " + e.message); }
}

// Render Data Target Internal ke Dashboard
function renderTargets(targets) {
  const container = document.getElementById("internal-targets");
  container.innerHTML = targets.map(target =>
    `<div class="flex justify-between items-center p-3 bg-gray-950 rounded-lg border border-gray-800">
      <div>
        <span class="font-medium text-white">${target.name}</span>
        <span class="text-xs text-gray-500 block">${target.ip}</span>
      </div>
      <div class="text-right">
        <span class="text-emerald-400 font-mono font-bold">${target.ping} ms</span>
        <span class="text-xs px-2 py-0.5 rounded ml-2 ${target.status === "ONLINE" ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400"}">${target.status}</span>
      </div>
    </div>`
  ).join("");
}

// Render Laporan Pengunjung Lain (filter per kategori)
let currentKat = "all";
function renderReports(reports) {
  const container = document.getElementById("user-reports-list");
  const filtered = (currentKat === "all" ? reports : reports.filter(r => r.kategori === currentKat));
  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-sm">Belum ada laporan di kategori ini.</p>';
    return;
  }
  container.innerHTML = filtered.slice().reverse().map(rep => {
    const server = rep.serverPing != null ? ` · server ${rep.serverPing}ms` : "";
    const saran = rep.saran ? `<p class="text-xs text-gray-400 mt-1 italic">"${rep.saran}"</p>` : "";
    return `<div class="p-2.5 bg-gray-950 rounded-lg border border-gray-850 text-sm">
      <div class="flex justify-between">
        <span class="font-bold text-gray-300">${rep.isp}</span>
        <span class="text-emerald-400 font-mono font-bold">${rep.ping}ms</span>
      </div>
      <p class="text-xs text-gray-500">${rep.city} • Baru saja${server}</p>
      ${saran}
    </div>`;
  }).join("");
}

// Pilih tab kategori (Global/Lokal/Sosmed)
function pilihKategori(kat) {
  currentKat = kat;
  document.querySelectorAll(".tab-kat").forEach(b => {
    b.classList.toggle("active", b.dataset.kat === kat);
  });
  // re-render dari data terakhir (userReports global di memory)
  if (window.__lastReports) renderReports(window.__lastReports);
}

// Logika Modal Pop-up
function bukaModalTes() {
  document.getElementById("modal-tes").classList.remove("hidden");
}

function tutupModalTes() {
  document.getElementById("modal-tes").classList.add("hidden");
}

// Proses Pengetesan dari Sisi Pengunjung (Client-Side)
// SEMUA request ke domain sendiri (isp-monitor.my.id) -> tahan adblock 100%.
async function jalankanTesISP() {
  const btn = document.getElementById("btn-jalankan-tes");
  btn.disabled = true;
  btn.innerText = "Mengukur...";

  const errEl = document.getElementById("modal-err");
  const showErr = (m) => { if (errEl) { errEl.textContent = m; errEl.classList.remove("hidden"); } };

  try {
    // 1. Deteksi ISP (backend fetch ipwho.is, adblock gak sentuh)
    let info = { isp: "Unknown", city: "-", region: "" };
    try {
      const r = await fetch(`${API_BASE}/api/isp-info`, { cache: "no-store" });
      info = await r.json();
    } catch (e) { showErr("Gagal ambil info ISP: " + e.message); }
    document.getElementById("modal-isp").innerText = info.isp || "Unknown";
    document.getElementById("modal-loc").innerText = `${info.city || "-"}${info.region ? ", " + info.region : ""}`;

    // 2. Ping ke cloudflare EDGE domain sendiri (user -> internet -> user, gak lewat VPS)
    let ping = null;
    try {
      const start = performance.now();
      await fetch("/cdn-cgi/trace?c=" + Date.now(), { mode: "no-cors", cache: "no-store" });
      ping = Math.round(performance.now() - start);
      document.getElementById("modal-ping").innerText = `${ping} ms`;
    } catch (e) { showErr("Gagal ukur ping: " + e.message); }

    // 2b. Ping ke VPS kita sendiri (bonus, gak wajib)
    let serverPing = null;
    try {
      const start = performance.now();
      await fetch(`${API_BASE}/api/probe?c=` + Date.now(), { cache: "no-store" });
      serverPing = Math.round(performance.now() - start);
      document.getElementById("modal-server-ping").innerText = `${serverPing} ms`;
    } catch (_) {}

    // 3. Saran user + kategori
    const saran = (document.getElementById("modal-saran").value || "").trim();
    const kategori = (document.getElementById("modal-kat") || {}).value || "global";

    // 4. Kirim ke server (ping = latensi user -> internet, diukur di browser)
    try {
      await fetch(`${API_BASE}/api/report-isp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isp: info.isp || "Unknown",
          city: info.city || "-",
          ping: ping || 0,
          serverPing,
          saran,
          kategori,
        }),
      });
    } catch (e) { showErr("Gagal kirim laporan: " + e.message); }

    document.getElementById("modal-ping").innerText = serverPing != null ? `${serverPing} ms` : "-";

  } catch (error) {
    console.error(error);
    showErr("Gagal mengukur: " + (error && error.message ? error.message : error));
  } finally {
    btn.disabled = false;
    btn.innerText = "Mulai Tes";
  }
}
