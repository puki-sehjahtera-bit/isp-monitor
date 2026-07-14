"""
Database layer untuk ISP Monitor - Struktur sederhana dan bersih.
"""
import aiosqlite
from datetime import date, datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "isp_monitor.db"


async def init_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=3000")
        
        # Tabel utama ISP
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS isp_list (
                id             INTEGER PRIMARY KEY,
                name           TEXT    NOT NULL,
                country        TEXT    NOT NULL,
                region         TEXT,
                isp_ip         TEXT,
                http_url       TEXT,
                order_index    INTEGER DEFAULT 0,
                is_active      INTEGER DEFAULT 1,
                notes          TEXT,
                created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Migrasi: tambah updated_at kalau tabel lama belum punya
        cols = set()
        async with db.execute("PRAGMA table_info(isp_list)") as cur:
            for row in await cur.fetchall():
                cols.add(row[1])
        if "updated_at" not in cols:
            await db.execute("ALTER TABLE isp_list ADD COLUMN updated_at DATETIME")
        
        # Tabel riwayat status langsung (tanpa kolom migration rumit)
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS isp_status_history (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                isp_id         INTEGER NOT NULL,
                check_type     TEXT    NOT NULL,
                status         INTEGER NOT NULL,
                latency_ms     INTEGER,
                probe          TEXT    NOT NULL DEFAULT 'local',
                recorded_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (isp_id) REFERENCES isp_list(id) ON DELETE CASCADE
            );
        """)

        # Migrasi: tambah kolom probe kalau tabel lama belum punya
        hcols = set()
        async with db.execute("PRAGMA table_info(isp_status_history)") as cur:
            for row in await cur.fetchall():
                hcols.add(row[1])
        if "probe" not in hcols:
            await db.execute("ALTER TABLE isp_status_history ADD COLUMN probe TEXT NOT NULL DEFAULT 'local'")

        # Tabel status alert (tracking down/up per ISP, hindari spam)
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS alert_state (
                isp_id      INTEGER PRIMARY KEY,
                is_down     INTEGER NOT NULL DEFAULT 0,
                last_change DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (isp_id) REFERENCES isp_list(id) ON DELETE CASCADE
            );
        """)
        
        # Tabel cache uptime harian sederhana
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS isp_uptime_cache (
                isp_id         INTEGER NOT NULL,
                check_date     DATE    NOT NULL,
                total_checks   INTEGER NOT NULL,
                successful     INTEGER NOT NULL,
                uptime_percent  REAL NOT NULL,
                updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (isp_id, check_date)
            );
        """)
        
        await db.commit()


# ── CRUD ISP ───────────────────────────────────────────────────────────────

async def get_or_create_isp(name, country, region=None, isp_ip=None, http_url=None, order_index=0, notes=None):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=3000")
        async with db.execute(
            "SELECT id FROM isp_list WHERE name = ? AND country = ?",
            (name, country)
        ) as cur:
            row = await cur.fetchone()
            if row:
                return row["id"]
        cur = await db.execute(
            """INSERT INTO isp_list (name, country, region, isp_ip, http_url, order_index, notes, updated_at)
               VALUES (?,?,?,?,?,?,?, CURRENT_TIMESTAMP)""",
            (name, country, region, isp_ip, http_url, order_index, notes)
        )
        await db.commit()
        return cur.lastrowid


async def get_all_isps():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=3000")
        async with db.execute(
            "SELECT * FROM isp_list WHERE is_active = 1 ORDER BY order_index, name"
        ) as cur:
            return [dict(row) for row in await cur.fetchall()]


async def get_isp_by_id(isp_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=3000")
        async with db.execute("SELECT * FROM isp_list WHERE id = ?", (isp_id,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def update_isp(isp_id: int, **fields):
    """Perbarui kolom ISP. Terima kwargs: name, country, region, isp_ip, http_url, order_index, is_active, notes."""
    allowed = {"name", "country", "region", "isp_ip", "http_url", "order_index", "is_active", "notes"}
    sets = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not sets:
        return
    cols = ", ".join(f"{k}=?" for k in sets)
    vals = list(sets.values()) + [isp_id]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=3000")
        await db.execute(f"UPDATE isp_list SET {cols}, updated_at=CURRENT_TIMESTAMP WHERE id=?", vals)
        await db.commit()


async def delete_isp(isp_id: int):
    """Soft delete: set is_active=0."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=3000")
        await db.execute("UPDATE isp_list SET is_active=0 WHERE id=?", (isp_id,))
        await db.commit()


async def update_isp_status(isp_id, check_type, status, latency_ms=None, probe="local"):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=3000")
        await db.execute(
            "INSERT INTO isp_status_history (isp_id, check_type, status, latency_ms, probe) VALUES (?,?,?,?,?)",
            (isp_id, check_type, status, latency_ms, probe)
        )
        await db.commit()
        await refresh_uptime_cache(db, isp_id)


async def refresh_uptime_cache(db, isp_id):
    today = date.today()
    async with db.execute(
        """SELECT 
              COUNT(*) as total,
              SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as success,
              AVG(CASE WHEN status = 1 THEN latency_ms ELSE NULL END) as avg_latency
           FROM isp_status_history 
           WHERE isp_id = ? AND date(recorded_at) = ?""",
        (isp_id, today)
    ) as cur:
        row = await cur.fetchone()
        total = row["total"] if row else 0
        successful = row["success"] if row else 0
        uptime = (successful / total * 100) if total else 0
        
        async with db.execute(
            "SELECT * FROM isp_uptime_cache WHERE isp_id = ? AND check_date = ?",
            (isp_id, today)
        ) as cur2:
            cached = await cur2.fetchone()
            if cached:
                await db.execute(
                    "UPDATE isp_uptime_cache SET total_checks = ?, successful = ?, uptime_percent = ?, updated_at = CURRENT_TIMESTAMP WHERE isp_id = ? AND check_date = ?",
                    (total, successful, uptime, isp_id, today)
                )
            else:
                await db.execute(
                    "INSERT INTO isp_uptime_cache (isp_id, check_date, total_checks, successful, uptime_percent) VALUES (?,?,?,?,?)",
                    (isp_id, today, total, successful, uptime)
                )
        await db.commit()


async def get_isp_dashboard():
    isps = await get_all_isps()
    result = []
    for isp in isps:
        isp_id = isp["id"]
        today = date.today()
        
        # cache hari ini
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            await db.execute("PRAGMA journal_mode=WAL")
            await db.execute("PRAGMA busy_timeout=3000")
            async with db.execute(
                "SELECT * FROM isp_uptime_cache WHERE isp_id = ? AND check_date = ?",
                (isp_id, today)
            ) as cur:
                row = await cur.fetchone()
                cache = dict(row) if row else None
                
            async with db.execute(
                """SELECT status, latency_ms, recorded_at 
                   FROM isp_status_history 
                   WHERE isp_id = ? ORDER BY recorded_at DESC LIMIT 5""",
                (isp_id,)
            ) as cur:
                recent = [dict(row) for row in await cur.fetchall()]

            # Breakdown per region/probe (status combined terbaru tiap probe)
            regions = {}
            async with db.execute(
                """SELECT probe, status, latency_ms FROM isp_status_history
                   WHERE isp_id = ? AND check_type = 'combined'
                   AND recorded_at = (SELECT MAX(recorded_at) FROM isp_status_history h2
                                       WHERE h2.isp_id = isp_status_history.isp_id
                                       AND h2.probe = isp_status_history.probe
                                       AND h2.check_type = 'combined')""",
                (isp_id,)
            ) as cur:
                for row in await cur.fetchall():
                    regions[row["probe"]] = {
                        "status": bool(row["status"]),
                        "latency_ms": row["latency_ms"],
                    }

        result.append({
            "id": isp_id,
            "name": isp["name"],
            "country": isp["country"],
            "region": isp.get("region"),
            "isp_ip": isp.get("isp_ip"),
            "http_url": isp.get("http_url"),
            "order_index": isp["order_index"],
            "notes": isp.get("notes"),
            "cache": cache,
            "recent_status": recent,
            "regions": regions,
        })
    return result


async def get_probes():
    """Daftar region/probe unik yang pernah lapor."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=3000")
        async with db.execute("SELECT DISTINCT probe FROM isp_status_history ORDER BY probe") as cur:
            return [row["probe"] for row in await cur.fetchall()]


async def get_alert_state(isp_id: int) -> int:
    """Return 1 kalau terakhir tercatat down, 0 kalau up, -1 kalau belum ada."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA busy_timeout=3000")
        async with db.execute("SELECT is_down FROM alert_state WHERE isp_id=?", (isp_id,)) as cur:
            row = await cur.fetchone()
        return row["is_down"] if row else -1


async def set_alert_state(isp_id: int, is_down: bool):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA busy_timeout=3000")
        await db.execute(
            """INSERT INTO alert_state (isp_id, is_down, last_change) VALUES (?,?,CURRENT_TIMESTAMP)
               ON CONFLICT(isp_id) DO UPDATE SET is_down=excluded.is_down, last_change=CURRENT_TIMESTAMP""",
            (isp_id, 1 if is_down else 0),
        )
        await db.commit()


async def get_latest_by_probe(isp_id: int) -> dict:
    """Return {probe: status_bool} dari cek combined terbaru tiap probe."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA busy_timeout=3000")
        res = {}
        async with db.execute(
            """SELECT s.probe AS probe, s.status AS status FROM isp_status_history s
               WHERE s.isp_id=? AND s.check_type='combined'
               AND s.recorded_at = (SELECT MAX(s2.recorded_at) FROM isp_status_history s2
                                     WHERE s2.isp_id=s.isp_id AND s2.probe=s.probe
                                     AND s2.check_type='combined')""",
            (isp_id,)
        ) as cur:
            for row in await cur.fetchall():
                res[row["probe"]] = bool(row["status"])
        return res
