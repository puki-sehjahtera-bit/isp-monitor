"""
Eksekutor worker latar belakang untuk ISP Monitor.
Worker ini berjalan di latar belakang, memeriksa semua ISP yang aktif secara periodik.
"""
import asyncio
import logging
import os
import subprocess
import re
import database as db
import httpx
from dotenv import load_dotenv
load_dotenv()
from datetime import datetime

logging.basicConfig(
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


async def check_ping(isp_ip: str):
    """Lakukan ping ke ISP dan kembalikan status & latency."""
    try:
        cmd = ["ping", "-c", "3", "-W", "2", isp_ip]
        result = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True)
        if result.returncode == 0:
            match = re.search(r'time=(\d+\.?\d*)', result.stdout)
            latency = int(float(match.group(1)) * 1000) if match else None
            return True, latency, ""
        else:
            return False, None, f"ping code {result.returncode}: {result.stderr.strip()[:100]}"
    except Exception as e:
        return False, None, str(e)


async def check_http(http_url: str, timeout: float = 10.0):
    """Lakukan HTTP GET dan kembalikan status & latency."""
    if not http_url or not http_url.startswith(("http://", "https://")):
        return False, None, "HTTP URL tidak valid"
    try:
        start = datetime.now()
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(http_url, follow_redirects=True)
            latency = int((datetime.now() - start).total_seconds() * 1000)
            if resp.status_code == 200:
                return True, latency, ""
            else:
                return False, latency, f"HTTP {resp.status_code}"
    except Exception as e:
        return False, None, str(e)


async def check_one_isp(isp, probe="local", report_url=None, report_token=""):
    """Periksa satu ISP secara lengkap.
    Kalau report_url diset, hasil dikirim ke central API (mode probe region).
    Kalau tidak, tulis ke DB lokal.
    """
    isp_id = isp["id"]
    name = isp["name"]

    # Ping
    ping_ok, ping_latency, ping_err = (False, None, "")
    if isp.get("isp_ip"):
        ping_ok, ping_latency, ping_err = await check_ping(isp["isp_ip"])

    # HTTP
    http_ok, http_latency, http_err = (False, None, "")
    if isp.get("http_url"):
        http_ok, http_latency, http_err = await check_http(isp["http_url"])

    # Combined (status gabungan)
    combined_ok = ping_ok or http_ok
    combined_latency = ping_latency if ping_ok else (http_latency if http_ok else None)

    if report_url:
        # Mode probe: lapor ke central API
        async with httpx.AsyncClient(timeout=10) as client:
            for ctype, ok, lat in (
                ("ping", ping_ok, ping_latency),
                ("http", http_ok, http_latency),
                ("combined", combined_ok, combined_latency),
            ):
                try:
                    await client.post(
                        f"{report_url}/report",
                        json={"isp_id": isp_id, "check_type": ctype,
                              "status": 1 if ok else 0, "latency_ms": lat, "probe": probe},
                        headers={"Authorization": f"Bearer {report_token}"} if report_token else {},
                    )
                except Exception as e:
                    logger.warning("Gagal lapor %s ke central: %s", ctype, str(e)[:80])
    else:
        # Mode lokal: tulis ke DB
        if isp.get("isp_ip"):
            await db.update_isp_status(isp_id, "ping", 1 if ping_ok else 0, ping_latency, probe)
        if isp.get("http_url"):
            await db.update_isp_status(isp_id, "http", 1 if http_ok else 0, http_latency, probe)
        await db.update_isp_status(isp_id, "combined", 1 if combined_ok else 0, combined_latency, probe)

    if ping_ok or http_ok:
        logger.info("[%s] ✅ %s — ping:%s http:%s", probe, name, "Y" if ping_ok else "N", "Y" if http_ok else "N")
    else:
        logger.warning("[%s] ❌ %s — ping_err:%s http_err:%s", probe, name, ping_err[:60] if ping_err else "", http_err[:60] if http_err else "")


async def fetch_central_isps(report_url, report_token=""):
    """Ambil daftar ISP dari central API (mode probe)."""
    async with httpx.AsyncClient(timeout=15) as client:
        headers = {"Authorization": f"Bearer {report_token}"} if report_token else {}
        r = await client.get(f"{report_url}/isps", headers=headers)
        r.raise_for_status()
        return r.json()


async def worker_loop():
    """Worker utama. Mode lokal (DB) atau probe (lapor ke central)."""
    logger.info("Worker latar belakang ISP Monitor dimulai")

    MONITOR_INTERVAL_MINUTES = int(os.getenv("MONITOR_INTERVAL_MINUTES", "3"))
    PROBE = os.getenv("PROBE_REGION", "local")
    CENTRAL_URL = os.getenv("CENTRAL_URL", "").rstrip("/")
    REPORT_TOKEN = os.getenv("REPORT_TOKEN", "")

    probe_mode = bool(CENTRAL_URL)
    if probe_mode:
        logger.info("MODE PROBE → lapor ke central %s sebagai region '%s'", CENTRAL_URL, PROBE)

    while True:
        try:
            if probe_mode:
                isps = await fetch_central_isps(CENTRAL_URL, REPORT_TOKEN)
            else:
                isps = await db.get_all_isps()

            if not isps:
                logger.warning("Tidak ada ISP, menunggu...")
                await asyncio.sleep(60)
                continue

            logger.info("[%s] Memeriksa %d ISP...", PROBE, len(isps))
            for idx, isp in enumerate(isps):
                if isp.get("is_active", 1):
                    await check_one_isp(isp, probe=PROBE, report_url=CENTRAL_URL or None, report_token=REPORT_TOKEN)
                if idx < len(isps) - 1:
                    await asyncio.sleep(30)

            logger.info("[%s] Putaran selesai, jeda %d menit", PROBE, MONITOR_INTERVAL_MINUTES)
            await asyncio.sleep(MONITOR_INTERVAL_MINUTES * 60)

        except Exception as e:
            logger.exception("Error worker: %s", e)
            await asyncio.sleep(60)


if __name__ == "__main__":
    asyncio.run(worker_loop())
