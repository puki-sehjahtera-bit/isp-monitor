# Deploy — Frontend (Cloudflare Pages) + Backend (Cloudflare Worker)

## 1. Backend API — Worker `isp-monitor-api`

```bash
# sekali: buat D1 (cocokkan database_id di wrangler.worker.toml)
wrangler d1 create isp-monitor --config wrangler.worker.toml

# migrasi skema ke REMOTE D1 (penting: jangan local)
npm run migrate          # wrangler d1 execute ... --file=worker/schema.sql --remote

# secrets
wrangler secret put ADMIN_TOKEN --config wrangler.worker.toml
wrangler secret put TG_BOT_TOKEN --config wrangler.worker.toml   # opsional
wrangler secret put TG_CHAT_ID   --config wrangler.worker.toml   # opsional

# deploy
npm run deploy            # -> https://isp-monitor-api.<subdomain>.workers.dev
```

Cron (`* * * * *` di `wrangler.worker.toml`) cek semua ISP tiap menit +
eval alert Telegram otomatis jalan setelah deploy.

Custom domain API (opsional): Worker → Settings → Domains & Routes → Add →
`api.isp-monitor.my.id`, lalu set `API_WORKER_URL` di `wrangler.toml` ke URL itu
dan `npm run deploy:pages`.

## 2. Frontend — Cloudflare Pages

```bash
npm run deploy:pages      # -> https://<project>.pages.dev
```

Dashboard CF → Pages → `isp-monitor` → Custom domains → add `isp-monitor.my.id`.
`functions/api/[[path]].js` proxy `/api/*` ke Worker lewat env `API_WORKER_URL`.
`public/config.js` `API_BASE` = domain frontend (sama origin).

## 3. Verifikasi

```bash
curl https://isp-monitor.my.id/api/healthz     # {"status":"ok",...}
curl https://isp-monitor.my.id/api/dashboard    # 21 ISP
```

Buka `https://isp-monitor.my.id` → dashboard + tabel ISP update dari cron.

## Catatan

- Tidak ada lagi `server.js`, systemd, atau cloudflared tunnel — semua di
  Cloudflare (Worker + D1 + Pages).
- Admin panel (`/admin`, butuh `ADMIN_TOKEN`) di-serve Pages via `functions/admin.js`.
- Jangan commit `node_modules`, `.wrangler/`.
