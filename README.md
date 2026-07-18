# ISP Monitor — Global Network Health

Monitoring kesehatan ISP di seluruh dunia: **ping + HTTP + status-page resmi**, dicek
berkala dan ditampilkan realtime di dashboard web.

Arsitektur sekarang (**Cloudflare**, bukan Node/Express):

- **Backend API** = Cloudflare **Worker** (`worker/`) + **D1** (SQLite serverless).
  Cron tiap 1 menit cek semua ISP, tulis ke D1, eval alert Telegram.
- **Frontend** = static `public/` di-deploy ke **Cloudflare Pages**.
  `functions/api/[[path]].js` proxy `/api/*` ke Worker (same-origin, tembus adblock).
- **Realtime** = dashboard fetch ulang `/api/dashboard` + `/api/history`; tidak pakai
  WebSocket (Worker gak pegang koneksi long-lived).

Fitur:
- Ping ICMP ke IP/hostname ISP, **fallback HTTP** kalau ICMP diblokir.
- Cek HTTP GET ke endpoint ISP (latency) + **status-page resmi** (incident).
- Status gabungan (combined) per ISP + breakdown per region/probe.
- Dashboard web + REST API + badge SVG + laporan user (ping test).
- Multi-region: probe di banyak lokasi lapor ke 1 central DB (tag region).
- Notifikasi Telegram saat ISP down/degraded/recover.

## Struktur

```
isp-monitor/
├── worker/                 # Backend API (Cloudflare Worker)
│   ├── index.mjs           # Router REST + cron handler (export default { fetch, scheduled })
│   ├── db.mjs              # Layer D1 (parameterized queries)
│   ├── checks.mjs          # ICMP ping (fallback HTTP) + status-page + ASN verify
│   ├── seed.mjs            # Seed ~21 ISP global (idempoten)
│   └── schema.sql          # Skema D1
├── functions/              # Pages Functions (proxy + admin)
│   ├── api/[[path]].js     # Proxy /api/* -> Worker (env API_WORKER_URL)
│   └── admin.js            # Panel admin (butuh ADMIN_TOKEN)
├── public/                 # Frontend statis (index.html, app.js, config.js, style.css, ...)
│   └── config.js           # API_BASE/WS_URL -> domain frontend (sama origin)
├── wrangler.worker.toml    # Deploy Worker + binding D1 + cron
├── wrangler.toml          # Deploy Pages (pages_build_output_dir = public) + [vars]
├── package.json
└── test/                   # node --test (cek checks.mjs)
```

## Setup lokal

```bash
npm install
cp .env.example .env        # (opsional, wrangler baca secret/env dari dashboard)
```

### 1. Buat + migrasi D1

```bash
# buat DB (sekali): wrangler d1 create isp-monitor --config wrangler.worker.toml
# cocokkan database_id di wrangler.worker.toml
npm run migrate             # wrangler d1 execute ... --file=worker/schema.sql --remote
```

> `npm run migrate` wajib dijalankan **remote** (`--remote`). `wrangler d1 execute`
> default ke local SQLite — seed/table di local gak akan kelihatan di Worker.

### 2. Secrets (Worker)

```bash
wrangler secret put ADMIN_TOKEN --config wrangler.worker.toml
wrangler secret put TG_BOT_TOKEN --config wrangler.worker.toml   # opsional alert
wrangler secret put TG_CHAT_ID   --config wrangler.worker.toml   # opsional alert
```

`API_WORKER_URL` (buat proxy Pages) di-set di `wrangler.toml` → `[vars]`
(default `https://isp-monitor-api.<subdomain>.workers.dev`, ganti kalau sudah
punya domain `api.isp-monitor.my.id`).

## Jalankan lokal (dev)

```bash
npm run dev                 # wrangler dev --config wrangler.worker.toml (local D1)
```

`functions/` (Pages proxy) butuh `wrangler pages dev` kalau mau test proxy lokal.

## Deploy

```bash
npm run deploy             # Worker -> https://isp-monitor-api.<subdomain>.workers.dev
npm run deploy:pages       # Pages  -> https://<project>.pages.dev (lalu custom domain)
```

- **Custom domain frontend**: Dashboard CF → Pages → `isp-monitor` → Custom domains →
  add `isp-monitor.my.id` (auto DNS CNAME).
- **Custom domain API (opsional)**: Worker → Settings → Domains & Routes → Add →
  `api.isp-monitor.my.id`.
- Cron jalan otomatis tiap 1 menit setelah deploy (lihat `crons` di wrangler.worker.toml).

## REST API (Worker)

| Method | Endpoint | Keterangan |
|--------|----------|------------|
| GET | `/api/healthz` | Health check |
| GET | `/api/isps` | List ISP (`?country=ID&region=Java`) |
| POST | `/api/isps` | Tambah ISP (**ADMIN_TOKEN**) |
| GET/PUT/DELETE | `/api/isps/{id}` | Detail/update/hapus (tulis **ADMIN_TOKEN**) |
| GET | `/api/dashboard` | Dashboard semua ISP + breakdown region |
| GET | `/api/stats` | Statistik keseluruhan |
| GET | `/api/regions` | List region/probe |
| GET | `/api/history/{id}` | Riwayat (`?range=24h&type=ping`) |
| GET | `/api/status/{id}` | Uptime cache harian |
| GET | `/api/verify/{id}` | Verifikasi ASN/routing ISP |
| GET | `/api/badge/{id}` | Badge SVG status |
| POST | `/api/report-isp` | Laporan ping dari user |
| GET | `/api/v1/*` | API publik (**API key** lewat `x-api-key`) |
| POST | `/api/v1/keys` | Buat API key (**ADMIN_TOKEN**) |

Cron handler `scheduled()` cek semua ISP tiap menit + eval alert.

## Test

```bash
npm test                   # node --test (test/checks.test.mjs)
```
