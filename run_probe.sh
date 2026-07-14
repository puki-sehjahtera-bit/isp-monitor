#!/usr/bin/env bash
# Jalankan ISP Monitor sebagai PROBE REGION (mode multi-region, Node.js).
# Probe cek semua ISP lalu LAPOR ke central API via /report (tag region).
# Butuh: PROBE_REGION dan CENTRAL_URL. REPORT_TOKEN harus sama dengan central.
#
# Contoh (di VPS region lain):
#   PROBE_REGION=eu-west CENTRAL_URL=https://<central>.trycloudflare.com \
#   REPORT_TOKEN=<token> ./run_probe.sh
set -e
cd "$(dirname "$0")"

: "${PROBE_REGION:?Set PROBE_REGION (mis. eu-west, us-east, asia)}"
: "${CENTRAL_URL:?Set CENTRAL_URL ke URL public central}"
: "${REPORT_TOKEN:=}"

exec node src/probe.js
