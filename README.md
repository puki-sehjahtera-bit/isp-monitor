# ISP Monitor — Aplikasi Monitoring Jaringan ISP Global

Aplikasi untuk memantau status kesehatan ISP di seluruh dunia:
- Ping ICMP ke IP/hostname ISP
- HTTP GET ke endpoint health-check ISP
- Status gabungan (combined) per ISP
- Dashboard terminal & REST API (FastAPI)
- Uptime harian & riwayat status tersimpan di SQLite

## Struktur

```
isp-monitor/
├── database.py          # Layer DB (SQLite + aiosqlite)
├── worker.py            # Worker: ping + HTTP check tiap ISP
├── api.py               # REST API (FastAPI)
├── cli.py               # CLI dashboard terminal
├── main.py              # Entry point: jalankan API + worker
├── requirements.txt
└── .env.example
```

## Install

```bash
cd /home/bahcron/isp-monitor
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # edit jika perlu
```

## Jalankan

**Cara 1 — semua sekaligus (API + worker):**
```bash
python3 main.py
```

**Cara 2 — API saja:**
```bash
uvicorn api:app --host 0.0.0.0 --port 8000
```

**Cara 3 — worker saja (jika API jalan di tempat lain):**
```bash
python3 -m worker
```

**CLI dashboard:**
```bash
python3 cli.py --list          # list semua ISP
python3 cli.py --add-isps "Telkomsel" "ID|Java|139.255.0.1|https://.."
python3 cli.py --check-all     # jalankan satu putaran cek
python3 cli.py --dashboard     # tampilkan status
```

## REST API

| Method | Endpoint | Keterangan |
|--------|----------|------------|
| GET | `/healthz` | Health check |
| GET | `/isps` | List ISP (filter: `?country=ID&region=Java`) |
| POST | `/isps` | Tambah ISP |
| GET | `/isps/{id}` | Detail ISP |
| PUT | `/isps/{id}` | Update ISP |
| DELETE | `/isps/{id}` | Soft delete ISP |
| GET | `/dashboard` | Dashboard semua ISP |
| GET | `/status/{id}` | Uptime hari ini |
| GET | `/history/{id}` | Riwayat status mentah |
| GET | `/stats` | Statistik keseluruhan |
| POST | `/health/{id}` | Trigger cek manual 1 ISP |
| POST | `/health/all` | Trigger cek manual semua ISP |
| POST | `/worker/start` | Start worker background |

Contoh:
```bash
curl http://localhost:8000/dashboard
curl -X POST http://localhost:8000/isps \
  -H "Content-Type: application/json" \
  -d '{"name":"IndiHome","country":"ID","isp_ip":"8.8.8.8","http_url":"https://www.google.com/generate_204"}'
```

## Catatan

- DB: `data/isp_monitor.db` (otomatis dibuat)
- Interval default: 3 menit, jeda antar ISP 30 detik
- Atur via env `MONITOR_INTERVAL_MINUTES`

## Web UI (untuk semua orang)

Buka di browser:

```
http://<host>:8000/
```

Dashboard menampilkan tabel ISP global, status ONLINE/OFFLINE, uptime harian,
bar progress, tombol cek manual, dan form tambah/hapus ISP. Auto-refresh tiap 15 dtk.

## Seed data global

Pertama kali jalan (DB kosong), `main.py` otomatis mengisi ~17 ISP global nyata
(ID, US, PH, MY, SG, JP, DE, FR, BR). Untuk reseed manual:

```bash
python3 seed_data.py
```

## Deploy publik (agar bisa diakses semua orang)

**Opsi A — Docker (paling mudah):**
```bash
docker compose up -d --build
# buka http://<server-ip>:8000/
```

**Opsi B — systemd + reverse proxy:**
```bash
sudo cp isp-monitor.service /etc/systemd/system/
sudo systemctl enable --now isp-monitor
```
Lalu pasang reverse proxy (Caddy/Nginx) supaya domain publik → `localhost:8000`.
Contoh Caddy ada di `Caddyfile.example` (auto-HTTPS).

**Opsi C — Lokal saja:**
```bash
python3 main.py   # akses http://localhost:8000/
```

> Catatan: ping ICMP butuh permission. Di Docker/`setcap` tidak wajib karena
> health-check juga pakai HTTP. Di host Linux biasa ping jalan sebagai user.

## Multi-region (pemantauan beneran "global")

Satu server = satu titik pandang. Biar global, jalankan **probe worker** di
beberapa region, semua lapor ke **1 central DB**.

```
region "asia"  ─┐
region "eu"    ─┼─► POST /report ─► central API ─► DB (tag probe)
region "us"    ─┘
central        ─► API + UI (agregasi per region)
```

**Central** (Railway / server ini): jalanin normal `main.py`. Optional set
`REPORT_TOKEN` biar `/report` butuh auth.

**Probe region** (VPS/cloud manapun): jalanin worker saja dengan env:
```bash
PROBE_REGION=asia \
CENTRAL_URL=https://isp-monitor-xxx.up.railway.app \
REPORT_TOKEN=token_yang_sama \
python3 worker.py
```
Worker GET `/isps` dari central, cek tiap ISP, lalu POST hasil ke `/report`
dengan tag region. Tidak perlu DB lokal.

**Lihat per region:** kolom "Per Region" + filter dropdown di UI, atau
`GET /regions` dan field `regions` di `GET /dashboard`.

> Kalau central set `REPORT_TOKEN`, tiap probe wajib kirim header
> `Authorization: Bearer <token>` yang sama.

