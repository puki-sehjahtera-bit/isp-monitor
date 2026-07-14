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


async def check_one_isp(isp):
    """Periksa satu ISP secara lengkap."""
    isp_id = isp["id"]
    name = isp["name"]

    # Ping
    ping_ok, ping_latency, ping_err = await check_ping(isp["isp_ip"]) if isp.get("isp_ip") else (False, None, "")
    if ping_ok or ping_latency is not None:
        await db.update_isp_status(isp_id, "ping", 1 if ping_ok else 0, ping_latency)

    # HTTP
    http_ok, http_latency, http_err = await check_http(isp["http_url"]) if isp.get("http_url") else (False, None, "")
    if http_ok or http_latency is not None:
        await db.update_isp_status(isp_id, "http", 1 if http_ok else 0, http_latency)

    # Combined (status gabungan)
    combined_ok = ping_ok or http_ok
    combined_latency = ping_latency if ping_ok else (http_latency if http_ok else None)
    await db.update_isp_status(isp_id, "combined", 1 if combined_ok else 0, combined_latency)

    # Logging
    if ping_ok or http_ok:
        logger.info("✅ %s — ping:%s http:%s", name, "Y" if ping_ok else "N", "Y" if http_ok else "N")
    else:
        logger.warning("❌ %s — ping_err:%s http_err:%s", name, ping_err[:80] if ping_err else "", http_err[:80] if http_err else "")


async def worker_loop():
    """Worker utama: loop pemeriksaan ISP secara periodik."""
    logger.info("Worker latar belakang ISP Monitor dimulai")
    
    # Interval pemeriksaan (bisa diatur via env var)
    MONITOR_INTERVAL_MINUTES = int(os.getenv("MONITOR_INTERVAL_MINUTES", "3"))
    
    while True:
        try:
            # Dapatkan semua ISP aktif
            isps = await db.get_all_isps()
            if not isps:
                logger.warning("Tidak ada ISP dikonfigurasi, menunggu...")
                await asyncio.sleep(60)
                continue
            
            logger.info("Memeriksa %d ISP (interval %d menit)...", len(isps), MONITOR_INTERVAL_MINUTES)
            
            # Periksa setiap ISP secara berurutan
            for idx, isp in enumerate(isps):
                if isp.get("is_active"):
                    logger.info("Memeriksa %s...", isp["name"])
                    await check_one_isp(isp)
                
                # Tunggu antar ISP (selain yang terakhir)
                if idx < len(isps) - 1:
                    await asyncio.sleep(30)  # 30 detik jeda antar ISP
            
            # Tunggu sebelum putaran selanjutnya
            logger.info("Putaran pemeriksaan selesai, menunggu %d menit...", MONITOR_INTERVAL_MINUTES)
            await asyncio.sleep(MONITOR_INTERVAL_MINUTES * 60)
            
        except Exception as e:
            logger.exception("Error di background worker: %s", e)
            await asyncio.sleep(60)


if __name__ == "__main__":
    import os
    import asyncio
    
    # Pastikan Python menggunakannya secara langsung
    os.environ.setdefault("PYTHONPATH", "/home/bahcron/isp-monitor")
    
    asyncio.run(worker_loop())
