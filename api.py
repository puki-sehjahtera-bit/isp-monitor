"""
REST API untuk ISP Monitor (FastAPI)
"""
import asyncio
import logging
from datetime import date
from typing import Optional, List
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict
import os
import aiosqlite
import database as db

logging.basicConfig(
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(
    title="ISP Monitor API",
    description="API untuk memantau status kesehatan ISP global",
    version="1.0.0",
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/ui", include_in_schema=False)
async def ui():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/", include_in_schema=False)
async def root():
    return FileResponse(STATIC_DIR / "index.html")


# ── Models ──────────────────────────────────────────────────────────────

class ISPBase(BaseModel):
    name: str
    country: str
    region: Optional[str] = None
    isp_ip: Optional[str] = None
    http_url: Optional[str] = None
    order_index: int = 0
    is_active: bool = True
    notes: Optional[str] = None


class ISPUpdate(BaseModel):
    name: Optional[str] = None
    country: Optional[str] = None
    region: Optional[str] = None
    isp_ip: Optional[str] = None
    http_url: Optional[str] = None
    order_index: Optional[int] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class ISPResponse(ISPBase):
    id: int
    created_at: str
    updated_at: str

    model_config = ConfigDict(from_attributes=True)


class ISPStatusHistory(BaseModel):
    id: int
    isp_id: int
    check_type: str
    status: bool
    latency_ms: Optional[int] = None
    recorded_at: str

    model_config = ConfigDict(from_attributes=True)


class ISPStatusResponse(BaseModel):
    isp_id: int
    uptime_percent: float
    total_checks: int
    successful: int
    avg_latency_ms: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


# ── Dependency ────────────────────────────────────────────────────────────


async def get_db():
    """Yield db session (stub - db adalah modul global)."""
    yield


# ── API Endpoints ───────────────────────────────────────────────────────


@app.on_event("startup")
async def startup_event():
    await db.init_db()
    logger.info("ISP Monitor API started")


# ISP CRUD

@app.post("/isps", response_model=ISPResponse, status_code=201)
async def create_isp(isp: ISPBase, background_tasks: BackgroundTasks):
    """Buat ISP baru."""
    isp_id = await db.get_or_create_isp(
        name=isp.name,
        country=isp.country,
        region=isp.region,
        isp_ip=isp.isp_ip,
        http_url=isp.http_url,
        order_index=isp.order_index,
        notes=isp.notes
    )
    
    # Perbarui status langsung setelah membuat
    async def _refresh(isp_id: int):
        async with aiosqlite.connect(db.DB_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            await db.refresh_uptime_cache(conn, isp_id)
    background_tasks.add_task(_refresh, isp_id)

    return {**isp.model_dump(), "id": isp_id, "created_at": "", "updated_at": ""}


@app.get("/isps", response_model=List[ISPResponse])
async def list_isps(
    country: Optional[str] = None,
    region: Optional[str] = None,
    is_active: Optional[bool] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000)
):
    """Dapatkan daftar ISP dengan filter."""
    isps = await db.get_all_isps()
    
    if country:
        isps = [i for i in isps if i.get("country") == country]
    if region:
        isps = [i for i in isps if i.get("region") == region]
    if is_active is not None:
        isps = [i for i in isps if i.get("is_active") == is_active]
    
    return isps[skip:skip + limit]


@app.get("/isps/{isp_id}", response_model=ISPResponse)
async def get_isp(isp_id: int):
    """Dapatkan detail ISP."""
    for isp in await db.get_all_isps():
        if isp["id"] == isp_id:
            return isp
    raise HTTPException(status_code=404, detail="ISP tidak ditemukan")


@app.put("/isps/{isp_id}", response_model=ISPResponse)
async def update_isp(isp_id: int, isp: ISPUpdate):
    """Perbarui ISP (partial)."""
    existing = await db.get_isp_by_id(isp_id)
    if not existing:
        raise HTTPException(status_code=404, detail="ISP tidak ditemukan")
    data = isp.model_dump(exclude_unset=True)
    if data:
        await db.update_isp(isp_id, **data)
    return await db.get_isp_by_id(isp_id)


@app.delete("/isps/{isp_id}", status_code=204)
async def delete_isp(isp_id: int):
    """Hapus ISP (soft delete)."""
    existing = await db.get_isp_by_id(isp_id)
    if not existing:
        raise HTTPException(status_code=404, detail="ISP tidak ditemukan")
    await db.delete_isp(isp_id)
    return None


# Status dan Dashboard

@app.get("/dashboard")
async def dashboard():
    """Dashboard lengkap: tiap ISP + cache uptime + 5 status terbaru + breakdown per region."""
    return await db.get_isp_dashboard()


@app.get("/regions")
async def regions():
    """Daftar region/probe yang pernah lapor."""
    return await db.get_probes()


@app.get("/status/{isp_id}", response_model=ISPStatusResponse)
async def get_isp_status(isp_id: int, check_date: Optional[str] = None):
    """Dapatkan status real-time ISP (cache uptime hari ini)."""
    from datetime import date
    target_date = date.fromisoformat(check_date) if check_date else date.today()
    
    async with aiosqlite.connect(db.DB_PATH) as con:
        con.row_factory = aiosqlite.Row
        async with con.execute(
            "SELECT * FROM isp_uptime_cache WHERE isp_id = ? AND check_date = ?",
            (isp_id, target_date.isoformat())
        ) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Status tidak ditemukan")
            return {
                "isp_id": row["isp_id"],
                "uptime_percent": row["uptime_percent"],
                "total_checks": row["total_checks"],
                "successful": row["successful"],
                "avg_latency_ms": row.get("avg_latency")
            }


@app.get("/health/{isp_id}", response_model=dict)
async def check_isp_health(isp_id: int, background_tasks: BackgroundTasks):
    """Trigger manual health check satu ISP."""
    # Cari ISP
    isps = await db.get_all_isps()
    target_isp = None
    for isp in isps:
        if isp["id"] == isp_id:
            target_isp = isp
            break
    
    if not target_isp:
        raise HTTPException(status_code=404, detail="ISP tidak ditemukan")
    
    # Jalankan pemeriksaan manual
    from worker import check_one_isp
    background_tasks.add_task(check_one_isp, target_isp)
    
    return {"status": "started", "isp_id": isp_id}


@app.get("/health/all", response_model=dict)
async def check_all_isps(background_tasks: BackgroundTasks):
    """Trigger pemeriksaan semua ISP."""
    isps = await db.get_all_isps()
    if not isps:
        raise HTTPException(status_code=400, detail="Tidak ada ISP dikonfigurasi")
    
    for isp in isps:
        background_tasks.add_task(check_one_isp, isp)
    
    return {"status": "started", "isp_count": len(isps)}


# Endpoint penerima laporan dari probe region (multi-region)
class ReportIn(BaseModel):
    isp_id: int
    check_type: str
    status: int
    latency_ms: Optional[int] = None
    probe: str = "local"


@app.post("/report", status_code=200)
async def report_status(payload: ReportIn, request: Request):
    """Terima hasil cek dari probe region, simpan ke DB pusat.
    Kalau REPORT_TOKEN diset, wajib header: Authorization: Bearer <token>.
    """
    token = os.getenv("REPORT_TOKEN", "")
    if token:
        auth = request.headers.get("Authorization", "")
        if auth != f"Bearer {token}":
            raise HTTPException(status_code=401, detail="Token salah")
    isp = await db.get_isp_by_id(payload.isp_id)
    if not isp:
        raise HTTPException(status_code=404, detail="ISP tidak ditemukan")
    await db.update_isp_status(
        payload.isp_id, payload.check_type, payload.status, payload.latency_ms, payload.probe
    )
    return {"ok": True, "isp_id": payload.isp_id, "probe": payload.probe}


# Riwayat status

@app.get("/history/{isp_id}", response_model=List[ISPStatusHistory])
async def get_isp_history(
    isp_id: int,
    check_type: Optional[str] = None,
    since: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000)
):
    """Riwayat status mentah."""
    async with aiosqlite.connect(db.DB_PATH) as con:
        con.row_factory = aiosqlite.Row
        query = "SELECT * FROM isp_status_history WHERE isp_id = ?"
        params = [isp_id]
        
        if check_type:
            query += " AND check_type = ?"
            params.append(check_type)
        
        if since:
            query += " AND recorded_at >= ?"
            params.append(since)
        
        query += " ORDER BY recorded_at DESC LIMIT ?"
        params.append(limit)
        
        async with con.execute(query, params) as cur:
            rows = await cur.fetchall()
            return [dict(row) for row in rows]


@app.get("/stats")
async def get_stats():
    """Statistik keseluruhan."""
    total_isps = len(await db.get_all_isps())
    today = date.today()
    
    async with aiosqlite.connect(db.DB_PATH) as con:
        con.row_factory = aiosqlite.Row
        async with con.execute(
            """SELECT 
                  COUNT(DISTINCT isp_id) as unique_isps,
                  SUM(total_checks) as total_checks,
                  SUM(successful) as successful_checks,
                  MAX(updated_at) as last_updated
               FROM isp_uptime_cache 
               WHERE check_date = ?""",
            (today.isoformat(),)
        ) as cur:
            row = await cur.fetchone()
            uptime = (row["successful_checks"] / row["total_checks"] * 100) if row["total_checks"] else 0
            
            return {
                "total_isps": total_isps,
                "checks_today": row["total_checks"] if row else 0,
                "successful_checks": row["successful_checks"] if row else 0,
                "overall_uptime_percent": round(uptime, 2) if row and row["total_checks"] else 0,
                "last_updated": row["last_updated"] if row else None
            }


# Worker control

@app.post("/worker/start", status_code=202)
async def start_worker(background_tasks: BackgroundTasks):
    """Mulai worker pemantauan latar belakang."""
    from worker import worker_loop
    background_tasks.add_task(worker_loop)
    return {"status": "worker started"}


@app.post("/worker/stop", status_code=202)
async def stop_worker():
    """Worker harus dihentikan secara eksternal (systemd/docker)."""
    return {"status": "worker harus dihentikan secara eksternal"}


# Health check endpoint untuk load balancer

@app.get("/healthz")
async def health_check():
    """Endpoint health check dasar."""
    return {"status": "ok", "service": "isp-monitor-api"}
