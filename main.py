"""
Entry point ISP Monitor.
Jalankan API (uvicorn) + worker latar belakang dalam satu proses.
"""
import asyncio
import logging
import os
import sys
from pathlib import Path

# Pastikan module lokal terimport
sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv()

import database as db
from worker import worker_loop

logging.basicConfig(
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("isp-monitor")

API_HOST = os.getenv("API_HOST", "0.0.0.0")
# Railway/Heroku pakai $PORT; lokal pakai $API_PORT (default 8000)
API_PORT = int(os.getenv("PORT") or os.getenv("API_PORT", "8000"))


async def main():
    await db.init_db()
    logger.info("Database siap")

    # Seed ISP global jika DB kosong
    isps = await db.get_all_isps()
    if not isps:
        import seed_data
        await seed_data.seed()
        logger.info("Seed ISP global selesai")

    # Jalankan worker di background task
    asyncio.create_task(worker_loop())
    logger.info("Worker loop berjalan di background")

    # Jalankan API
    import uvicorn
    from api import app
    config = uvicorn.Config(app, host=API_HOST, port=API_PORT, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Dihentikan oleh user")
