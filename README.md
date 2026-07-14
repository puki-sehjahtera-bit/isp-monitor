# ISP Monitor — Global Network Health (Node.js)

Aplikasi monitoring kesehatan ISP di seluruh dunia dengan **ping realtime** dan
**grafik analitik per cek**. Backend Node.js (Express + Socket.IO + better-sqlite3),
frontend realtime (Chart.js) lewat WebSocket.

Fitur:
- Ping ICMP ke IP/hostname ISP, **fallback HTTP** kalau ICMP diblokir (cloud).
- Cek HTTP GET ke endpoint health-check ISP (latency).
- Status gabungan (combined) per ISP.
- **Realtime**: tiap cek di-broadcast via WebSocket → tabel & grafik update langsung.
- Grafik: latensi gabungan rata-rata global (realtime) + grafik latensi per-ISP
  (ping/http/combined) dari riwayat.
- Multi-region: probe di banyak lokasi lapor ke 1 central DB (tag region).
- Dashboard web + REST API (FastAPI-style) + notifikasi Telegram (global-down).

## Struktur

```
isp-monitor/
├── src/
│   ├── server.js     # Express + Socket.IO + REST API + static
│   ├── worker.js     # Loop monitoring (lokal / probe) + alert global-down
│   ├── checks.js     # ICMP ping (fallback HTTP)
│   ├── db.js         # Layer DB (better-sqlite3)
│   ├── seed.js       # Seed ~19 ISP global nyata
│   └── probe.js      # Entry probe region (tanpa API server)
├── public/           # Frontend (index.html, app.js, style.css)
├── package.json
├── Dockerfile
├── docker-compose.yml
├── railway.json
└── .env.example
```

## Install (lokal)

```bash
cd /home/bahcron/isp-monitor
npm install
cp .env.example .env      # edit kalau perlu
node src/server.js        # http://localhost:8000
```

## Jalankan sebagai service (systemd, lokal/central)

Biarkan monitor nyala terus & auto-start pas boot:

```bash
# central (API + UI):
sudo cp isp-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now isp-monitor

# probe region (VPS lain, tanpa API server):
sudo cp isp-monitor-probe.service /etc/systemd/system/
sudo systemctl enable --now isp-monitor-probe
```
Cek log: `journalctl -u isp-monitor -f`.

## Akses dari HP / publik (Cloudflare Tunnel)

Biar bisa dibuka dari mana aja (terutama HP di luar LAN) pakai tunnel.

**Quick tunnel (URL berubah tiap restart, gak perlu akun):**
```bash
cloudflared tunnel --url http://localhost:8000
```

**Named tunnel (URL TETAP, butuh akun Cloudflare gratis):**
```bash
# 1. install binary (contoh Debian/Ubuntu):
sudo curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared

# 2. login (interaktif, buka browser untuk OAuth) — sekali saja:
cloudflared tunnel login

# 3. buat tunnel (isi nama bebas):
cloudflared tunnel create isp-monitor

# 4. jadikan service (auto-start + restart kalau mati):
sudo cp cloudflared.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now isp-monitor cloudflared
```
URL tetap: `https://<id-tunnel>.cfargotunnel.com` (atau custom domain lewat
`cloudflared tunnel route dns isp-monitor namadomain.com`).

> Catatan: kalau pakai systemd untuk server, matikan keepalive cron biar gak
> dobel: `crontab -e` lalu hapus baris `*/1 * * * * .../keepalive.sh`.

## REST API

| Method | Endpoint | Keterangan |
|--------|----------|------------|
| GET | `/healthz` | Health check |
| GET | `/isps` | List ISP (`?country=ID&region=Java`) |
| POST | `/isps` | Tambah ISP (**butuh `ADMIN_TOKEN`**) |
| GET/PUT/DELETE | `/isps/{id}` | Detail/update/hapus ISP (tulis **butuh `ADMIN_TOKEN`**) |
| GET | `/dashboard` | Dashboard semua ISP (+ breakdown per region) |
| GET | `/regions` | List region/probe |
| GET | `/stats` | Statistik keseluruhan |
| GET | `/history/{id}` | Riwayat status (`?check_type=ping&limit=300`) |
| GET | `/export.csv` | Export snapshot semua ISP ke CSV |
| POST | `/health/{id}` | Trigger cek manual 1 ISP (realtime, **butuh `ADMIN_TOKEN`**) |
| POST | `/health/all` | Trigger cek manual semua ISP (**butuh `ADMIN_TOKEN`**) |
| POST | `/report` | Terima laporan probe region (butuh `REPORT_TOKEN`) |
| POST | `/worker/start` | Start worker background |

WebSocket: connect ke `/`, event `check` tiap hasil cek `{ispId,name,ping,http,combined,probe,ts}`.
Client bisa emit `pingNow` `{ispId}` untuk cek instan.

## Deploy publik (Railway)

```bash
# railway CLI
railway login
railway link          # pilih projek / init
railway up            # build via Dockerfile, startCommand node src/server.js
```

- `railway.json` sudah diset: Dockerfile, port 8000, healthcheck `/healthz`, env
  `PROBE_REGION=central` + `REPORT_TOKEN`.
- **Mount volume** ke `/data` biar DB (`isp_monitor.db`) persisten antar deploy.
- Set `REPORT_TOKEN` (atau biarkan `{{RAILWAY_REPORT_TOKEN}}` dari Railway variable).

Atau Docker lokal:
```bash
docker compose up -d --build     # http://<host>:8000
```

## Multi-region (pemantauan beneran "global")

Satu central = satu titik pandang. Jalankan **probe** di banyak region, semua lapor
ke **1 central DB**.

```
region "asia"  ─┐
region "eu"    ─┼─► POST /report ─► central API ─► DB (tag probe)
region "us"    ─┘
central        ─► API + UI (agregasi per region)
```

**Central** (Railway / server ini): jalanin normal `node src/server.js`. Set
`REPORT_TOKEN` biar `/report` butuh auth.

**Probe region** (VPS/cloud manapun) — turnkey:
```bash
# di mesin probe (setelah code ada di /opt/isp-monitor):
./install-probe.sh /opt/isp-monitor
# lalu isi CENTRAL_URL, PROBE_REGION, REPORT_TOKEN, PROBE_ASN, PROBE_LOCATION
```
Atau manual:
```bash
PROBE_REGION=eu-west \
CENTRAL_URL=https://<central>.up.railway.app \
REPORT_TOKEN=<token_yang_sama> \
PROBE_ASN=7713 \
PROBE_LOCATION=Europe \
./run_probe.sh
```
Worker GET `/isps` dari central, cek tiap ISP (ping + HTTP + **status-page resmi**),
lalu POST hasil ke `/report` dengan tag region + metadata `asn`/`location`.
Tanpa DB lokal.

**Metadata probe** (biar "Per Region" jadi per-ISP nyata): tiap probe lapor
`PROBE_ASN` + `PROBE_LOCATION`. Dashboard menampilkan ASN tiap region, dan
`GET /probes` balikin metadata semua probe. Jadi kolom "Per Region" menunjukkan
mis. `eu-west(AS7713)`. Tambah probe di ASN beda = titik pandang beda = deteksi
global-down jadi valid.

Lihat per region: kolom "Per Region" di UI, `GET /regions`, `GET /probes`,
field `regions` di `GET /dashboard` (tiap region punya `asn`/`location`).

## Notifikasi Telegram (alert per-ISP)

Bot kirim pesan per state ISP:
- 🔴 **DOWN** — gagal di semua region (global-down)
- 🟡 **DEGRADED** — gagal di sebagian region
- 🟢 **RECOVERED** — sudah reachable lagi

Set env:
```
TG_BOT_TOKEN=...   # dari @BotFather
TG_CHAT_ID=...
ALERT_COOLDOWN_MINUTES=30   # anti-spam kalau flap
```
Kosong → notifikasi off (cuma log).

## Catatan

- DB: `data/isp_monitor.db` (SQLite, WAL). Semua tulisan lewat central → 1 writer.
- Interval default: 3 menit, jeda antar ISP 30 dtk. Atur `MONITOR_INTERVAL_MINUTES`.
- ICMP butuh `ping` (di Docker: `iputils-ping`). Kalau platform blokir ICMP,
  otomatis fallback ke HTTP latency.
