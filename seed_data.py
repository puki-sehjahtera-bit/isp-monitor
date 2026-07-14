"""
Seed data ISP global nyata.
Jalankan: python3 seed_data.py
Setiap ISP punya endpoint publik (DNS IP / health URL) sebagai proxy kesehatan.
"""
import asyncio
import database as db

# (name, country, region, isp_ip, http_url, order, notes)
GLOBAL_ISPS = [
    # Indonesia
    ("Telkomsel",      "ID", "Java",     "139.255.0.1",     "https://www.google.com/generate_204", 1,  "Operator selular terbesar ID"),
    ("XL Axiata",      "ID", "Java",     "202.152.240.1",   "https://www.google.com/generate_204", 2,  "Operator selular ID"),
    ("IndiHome",       "ID", "Java",     "36.85.0.1",       "https://www.google.com/generate_204", 3,  "ISP fixed broadband Telkom"),
    ("Biznet",         "ID", "Jakarta",  "180.131.144.1",   "https://www.google.com/generate_204", 4,  "ISP broadband ID"),
    # Global DNS (proxy kesehatan jaringan)
    ("Cloudflare DNS", "US", "Global",   "1.1.1.1",         "https://www.cloudflare.com/cdn-cgi/trace", 10, "Anycast DNS global"),
    ("Google DNS",     "US", "Global",   "8.8.8.8",         "https://www.google.com/generate_204", 11, "Anycast DNS global"),
    ("OpenDNS",        "US", "Global",   "208.67.222.222",  "https://www.google.com/generate_204", 12, "Cisco anycast DNS"),
    # US
    ("Comcast",        "US", "California","8.8.8.8",        "https://www.google.com/generate_204", 20, "ISP terbesar AS"),
    ("AT&T",           "US", "Texas",    "12.0.0.1",        "https://www.google.com/generate_204", 21, "ISP AS"),
    # PH
    ("Globe",          "PH", "Luzon",    "1.1.1.1",         "https://www.google.com/generate_204", 30, "Operator selular PH"),
    ("PLDT",           "PH", "Manila",   "202.57.0.1",      "https://www.google.com/generate_204", 31, "ISP PH"),
    # MY
    ("TM Unifi",       "MY", "Kuala Lumpur", "1.9.1.1",     "https://www.google.com/generate_204", 40, "ISP Malaysia"),
    # SG
    ("Singtel",        "SG", "Singapore","203.119.0.1",    "https://www.google.com/generate_204", 50, "ISP Singapura"),
    # JP
    ("NTT DOCOMO",     "JP", "Tokyo",    "1.1.1.1",         "https://www.google.com/generate_204", 60, "Operator selular JP"),
    # EU
    ("Deutsche Telekom","DE","Frankfurt", "193.159.0.1",    "https://www.google.com/generate_204", 70, "ISP Jerman"),
    ("Orange",         "FR", "Paris",    "80.10.0.1",       "https://www.google.com/generate_204", 71, "ISP Prancis"),
    # BR
    ("Vivo",           "BR", "Sao Paulo", "1.1.1.1",        "https://www.google.com/generate_204", 80, "Operator selular BR"),
]


async def seed():
    await db.init_db()
    existing = await db.get_all_isps()
    if existing:
        print(f"DB sudah punya {len(existing)} ISP, lewati seed (hapus data/isp_monitor.db untuk reseed).")
        return
    for name, country, region, ip, url, order, note in GLOBAL_ISPS:
        isp_id = await db.get_or_create_isp(name, country, region, ip, url, order, note)
        print(f"  + {name} ({country}) id={isp_id}")
    print(f"Seed selesai: {len(GLOBAL_ISPS)} ISP global.")


if __name__ == "__main__":
    asyncio.run(seed())
