"""
CLI untuk ISP Monitor (dashboard terminal bersih).
"""
import argparse
import asyncio
import logging
import database as db
import worker

logging.basicConfig(
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    level=logging.WARNING,
)
logger = logging.getLogger(__name__)


def _fmt_latency(ms):
    return f"{ms}ms" if ms is not None else "-"


def _fmt_bool(b):
    return "OK" if b else "FAIL"


def _fmt_cache(cache):
    if not cache:
        return "-"
    u = cache["uptime_percent"]
    total = cache["total_checks"]
    succ = cache["successful"]
    return f"{u:.1f}% ({succ}/{total})"


async def run():
    parser = argparse.ArgumentParser(description="ISP Monitor CLI")
    parser.add_argument("--add-isps", nargs=2, metavar=("NAME", "SPEC"),
                        action="append", help="Tambah ISP: nama 'negara|region|ip|url'")
    parser.add_argument("--dashboard", action="store_true", help="Tampilkan dashboard terminal")
    parser.add_argument("--check-all", action="store_true", help="Jalankan satu putaran pemeriksaan")
    parser.add_argument("--list", action="store_true", help="List semua ISP")
    args = parser.parse_args()

    await db.init_db()

    if args.add_isps:
        for name, spec in args.add_isps:
            parts = [p.strip() for p in spec.split("|")]
            country = parts[0] if len(parts) > 0 else "XX"
            region = parts[1] if len(parts) > 1 else None
            ip = parts[2] if len(parts) > 2 else None
            url = parts[3] if len(parts) > 3 else None
            isp_id = await db.get_or_create_isp(name, country, region, ip, url)
            print(f"Added ISP: {name} ({country}) id={isp_id}")
        return

    if args.list:
        isps = await db.get_all_isps()
        for isp in isps:
            print(f"[{isp['id']}] {isp['name']} ({isp['country']}) ip={isp.get('isp_ip')} url={isp.get('http_url')}")
        return

    if args.check_all:
        isps = await db.get_all_isps()
        if not isps:
            print("Tidak ada ISP dikonfigurasi. Jalankan --add-isps terlebih dahulu.")
            return
        for idx, isp in enumerate(isps):
            if isp.get("is_active"):
                await worker.check_one_isp(isp)
                if idx < len(isps) - 1:
                    await asyncio.sleep(1)
        print("Pemeriksaan selesai.")
        return

    if args.dashboard:
        dashboard = await db.get_isp_dashboard()
        print("\n=== ISP Monitor Dashboard ===")
        header = f"{'ISP':<20} {'Negara':<6} {'Kawasan':<8} {'Uptime':<12} {'Status':<6}"
        print(header)
        print("-" * len(header))
        for isp in dashboard:
            cache = isp.get("cache")
            cache_text = _fmt_cache(cache)
            recent = isp.get("recent_status", [])
            ok = any(r.get("status") for r in recent)
            line = (
                f"{isp['name'][:20]:<20} "
                f"{isp['country']:<6} "
                f"{ (isp.get('region') or '-')[:8]:<8} "
                f"{cache_text:<12} "
                f"{_fmt_bool(ok):<6}"
            )
            print(line)
        print("=" * len(header))
        print(f"Total ISP aktif: {len(dashboard)}")
        return

    parser.print_help()


if __name__ == "__main__":
    asyncio.run(run())
