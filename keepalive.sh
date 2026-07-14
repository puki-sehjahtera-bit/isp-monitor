#!/usr/bin/env bash
# Keepalive ISP Monitor: pastikan server jalan. Dipanggil cron tiap menit.
# Tidak menyentuh cloudflared (dikelola app 9router).
DIR=/home/bahcron/isp-monitor
LOG=/tmp/isp-monitor.log

if pgrep -f "node $DIR/src/server.js" >/dev/null 2>&1; then
  exit 0
fi
echo "[$(date)] server mati, restart…" >> "$LOG"
cd "$DIR" || exit 1
setsid node src/server.js >> "$LOG" 2>&1 < /dev/null &
