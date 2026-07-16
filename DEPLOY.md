# Deploy — Frontend Statis (Cloudflare Pages) + Backend API Terpisah

Arsitektur akhir:
- **Frontend**: `isp-monitor.my.id` → Cloudflare Pages (folder `public/`, static murni)
- **Backend API**: `api.isp-monitor.my.id` → server ini (Node/Express/Socket.IO via tunnel)

---

## 1. Backend API — `api.isp-monitor.my.id`

Di server ini (VPS/Railway), pastikan:
- `server.js` jalan di `:8000` (sudah ada `isp-monitor.service`).
- `.env` punya `CORS_ORIGINS=https://isp-monitor.my.id`.
- Cloudflare Tunnel expose `api.isp-monitor.my.id` → `localhost:8000`.

### Tambah hostname api ke tunnel (di mesin lokal, butuh `cloudflared login`)
```bash
# di lokal, sudah login cloudflared:
cloudflared tunnel route dns <nama-tunnel> api.isp-monitor.my.id
```
Atau di Cloudflare Dashboard → DNS: tambah `CNAME api.isp-monitor.my.id` → `<id-tunnel>.cfargotunnel.com`.

Tunnel sudah jalan (`cloudflared.service`) akan otomatis serve hostname baru.
Cek: `curl https://api.isp-monitor.my.id/healthz` → `{"status":"ok",...}`.

---

## 2. Frontend — Cloudflare Pages (di mesin lokal, butuh `wrangler login`)

```bash
# di lokal, clone / pull repo ini:
cd isp-monitor
npm install
npx wrangler login          # browser OAuth sekali
npm run deploy:pages        # = wrangler pages deploy public --project-name isp-monitor-frontend
```

Setelah deploy:
- Di Cloudflare Dashboard → Pages → project `isp-monitor-frontend` → **Custom domains**
  → add `isp-monitor.my.id` (Cloudflare otomatis add DNS CNAME).
- Pastikan `public/config.js` `API_BASE`/`WS_URL` = `https://api.isp-monitor.my.id`
  (sudah default). Kalau domain beda, edit lalu `npm run deploy:pages` lagi.

---

## 3. Verifikasi

```bash
# API reachable + CORS header
curl -i https://api.isp-monitor.my.id/dashboard \
  -H "Origin: https://isp-monitor.my.id" | grep -i "access-control"

# Frontend
curl -s https://isp-monitor.my.id/ | grep -o "config.js"
curl -s https://isp-monitor.my.id/config.js
```

Buka `https://isp-monitor.my.id` di browser → DevTools Network:
- request `/dashboard`, `/history`, WS ke `api.isp-monitor.my.id` (status 200, 101).
- kolom "Per Region" / tabel ISP update realtime.

---

## 4. Catatan

- **Admin panel** (`/admin`) TIDAK di-deploy ke Pages. Akses di
  `https://api.isp-monitor.my.id/admin` (butuh `ADMIN_TOKEN`).
- Jangan commit `.env`, `.cf-tunnel-token`, `*.db`.
- Kalau ganti domain frontend, update `CORS_ORIGINS` di `.env` server API + `config.js`.
- `sw.js` (service worker) di Pages tetap jalan untuk PWA/offline shell.
