"""
Evaluasi alert: tiap ISP, kalau SEMUA region lapor down -> kirim Telegram.
Hanya notifikasi saat transisi up<->down (state disimpan di alert_state).
"""
import logging
import database as db
from notifier import send_telegram

logger = logging.getLogger(__name__)


async def evaluate_alerts():
    isps = await db.get_all_isps()
    for isp in isps:
        isp_id = isp["id"]
        probes = await db.get_latest_by_probe(isp_id)
        if not probes:
            continue  # belum ada data

        up_probes = [p for p, ok in probes.items() if ok]
        global_down = len(up_probes) == 0

        prev = await db.get_alert_state(isp_id)  # -1 belum ada, 0 up, 1 down

        if global_down and prev != 1:
            await send_telegram(
                f"🔴 *DOWN* — {isp['name']} ({isp['country']})\n"
                f"Semua region gagal: {', '.join(probes.keys())}\n"
                f"Dianggap global-down."
            )
            await db.set_alert_state(isp_id, True)
            logger.warning("ALERT DOWN: %s", isp["name"])

        elif not global_down and prev == 1:
            await send_telegram(
                f"🟢 *RECOVERED* — {isp['name']} ({isp['country']})\n"
                f"Sudah reachable dari: {', '.join(up_probes)}"
            )
            await db.set_alert_state(isp_id, False)
            logger.info("ALERT UP: %s", isp["name"])
