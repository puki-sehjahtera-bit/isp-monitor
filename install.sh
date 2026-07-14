#!/usr/bin/env bash
# Install ISP Monitor: buat venv, install deps, siapkan .env
set -e
cd "$(dirname "$0")"

python3 -m venv venv
source venv/bin/activate
pip install -q -r requirements.txt

if [ ! -f .env ]; then
    cp .env.example .env
    echo "Buat .env dari .env.example — edit MONITOR_INTERVAL_MINUTES jika perlu"
fi

echo "Install selesai. Jalankan: python3 main.py"
echo "Atau CLI: python3 cli.py --dashboard"
