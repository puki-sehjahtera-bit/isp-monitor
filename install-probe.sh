#!/usr/bin/env bash
# Installer probe region ISP Monitor di VPS/device (bukan central).
# Jalankan sebagai root di mesin yang jadi probe:
#   ./install-probe.sh /opt/isp-monitor
#
# Prasyarat: node 18+, git (kalau clone), akses ke central URL.
set -e
DIR="${1:-/opt/isp-monitor}"
echo "== Install probe di $DIR =="

if [ ! -f "$DIR/package.json" ]; then
  echo "Project tidak ada di $DIR. Clone dulu:"
  echo "  git clone <repo-isp-monitor> $DIR"
  exit 1
fi

cd "$DIR"
[ -x node ] || { echo "node tidak ditemukan"; exit 1; }
npm install --omit=dev >/dev/null 2>&1 && echo "npm install selesai"

read -p "CENTRAL_URL (https://<central>): " CENTRAL_URL
read -p "PROBE_REGION (mis. eu-west, asia-sg): " PROBE_REGION
read -p "REPORT_TOKEN (sama dengan central): " REPORT_TOKEN
read -p "PROBE_ASN (mis. 7713, boleh kosong): " PROBE_ASN
read -p "PROBE_LOCATION (mis. Singapore): " PROBE_LOCATION

cat > "$DIR/.env" <<EOF
API_HOST=0.0.0.0
API_PORT=8000
MONITOR_INTERVAL_MINUTES=1
INTER_TARGET_GAP_SECONDS=2
PROBE_REGION=$PROBE_REGION
CENTRAL_URL=$CENTRAL_URL
REPORT_TOKEN=$REPORT_TOKEN
PROBE_ASN=$PROBE_ASN
PROBE_LOCATION=$PROBE_LOCATION
EOF
echo ".env probe ditulis."

if command -v systemctl >/dev/null 2>&1; then
  cp "$DIR/isp-monitor-probe.service" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now isp-monitor-probe
  echo "Service isp-monitor-probe enabled & started."
else
  echo "systemd tidak tersedia. Jalankan manual: node src/probe.js (di $DIR)"
fi
echo "Selesai. Cek: journalctl -u isp-monitor-probe -f"
