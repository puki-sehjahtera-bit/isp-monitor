"""
Unit test untuk ISP Monitor.
Jalankan: python3 -m pytest test_isp_monitor.py -v
"""
import asyncio
import os
from pathlib import Path
import pytest
import database as db  # noqa: E402


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


async def _fresh_db():
    """Reset DB ke kondisi kosong untuk test isolasi."""
    p = db.DB_PATH
    for suffix in ("", "-wal", "-shm"):
        fp = Path(str(p) + suffix)
        if fp.exists():
            os.remove(fp)
    await db.init_db()


@pytest.mark.asyncio
async def test_get_or_create_isp():
    await _fresh_db()
    isp_id = await db.get_or_create_isp(
        name="TestISP", country="ID", region="Java",
        isp_ip="8.8.8.8", http_url="https://httpbin.org/status/200"
    )
    assert isinstance(isp_id, int)
    # Panggil lagi -> id sama (tidak duplikat)
    isp_id2 = await db.get_or_create_isp(
        name="TestISP", country="ID", region="Java",
        isp_ip="8.8.8.8", http_url="https://httpbin.org/status/200"
    )
    assert isp_id == isp_id2


@pytest.mark.asyncio
async def test_update_isp_status():
    await _fresh_db()
    isp_id = await db.get_or_create_isp(name="TestISP2", country="ID")
    await db.update_isp_status(isp_id, "ping", 1, 25)
    await db.update_isp_status(isp_id, "ping", 1, 30)
    await db.update_isp_status(isp_id, "ping", 0, None)
    dashboard = await db.get_isp_dashboard()
    found = [d for d in dashboard if d["name"] == "TestISP2"]
    assert found, "ISP harus muncul di dashboard"
    cache = found[0]["cache"]
    assert cache["total_checks"] == 3
    assert cache["successful"] == 2


@pytest.mark.asyncio
async def test_get_all_isps():
    await _fresh_db()
    isps = await db.get_all_isps()
    assert isinstance(isps, list)


if __name__ == "__main__":
    asyncio.run(test_get_or_create_isp())
    asyncio.run(test_update_isp_status())
    asyncio.run(test_get_all_isps())
    print("Semua test lolos")
