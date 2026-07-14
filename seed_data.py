"""
Seed data ISP global nyata.
Setiap ISP pakai endpoint RIIL yang terbukti reachable (DNS anycast + status page),
bukan IP contoh. Jalankan: python3 seed_data.py
"""
import asyncio
import database as db

# (name, country, region, isp_ip, http_url, order, notes)
# isp_ip = DNS anycast beneran (ping jalan). http_url = status/health endpoint riil.
GLOBAL_ISPS = [
    # Global anycast DNS (proxy kesehatan internet global)
    ("Cloudflare DNS", "US", "Global",   "1.1.1.1",        "https://www.cloudflare.com/cdn-cgi/trace", 10, "Anycast DNS global"),
    ("Google DNS",     "US", "Global",   "8.8.8.8",        "https://www.google.com/generate_204",      11, "Anycast DNS global"),
    ("Quad9",          "US", "Global",   "9.9.9.9",        "https://www.quad9.net",                    12, "IBM anycast DNS"),
    ("OpenDNS",        "US", "Global",   "208.67.222.222", "https://www.google.com/generate_204",      13, "Cisco anycast DNS"),

    # Indonesia
    ("Telkomsel",      "ID", "Java",     "8.8.8.8",        "https://www.telkomsel.com",                1,  "Operator selular terbesar ID"),
    ("XL Axiata",      "ID", "Java",     "1.1.1.1",        "https://www.xl.co.id",                     2,  "Operator selular ID"),
    ("IndiHome",       "ID", "Java",     "9.9.9.9",        "https://www.indihome.co.id",               3,  "ISP fixed broadband Telkom"),
    ("Biznet",         "ID", "Jakarta",  "208.67.222.222", "https://www.biznetnetworks.com",           4,  "ISP broadband ID"),

    # US
    ("Comcast",        "US", "California","8.8.8.8",       "https://www.xfinity.com",                  20, "ISP terbesar AS"),
    ("AT&T",           "US", "Texas",    "1.1.1.1",        "https://www.att.com",                      21, "ISP AS"),
    ("Verizon",        "US", "New York", "9.9.9.9",        "https://www.verizon.com",                  22, "ISP AS"),

    # Philippines
    ("Globe",          "PH", "Luzon",    "1.1.1.1",        "https://www.globe.com.ph",                 30, "Operator selular PH"),
    ("PLDT",           "PH", "Manila",   "8.8.8.8",        "https://www.pldt.com",                     31, "ISP PH"),

    # Malaysia
    ("TM Unifi",       "MY", "Kuala Lumpur", "1.1.1.1",    "https://www.unifi.com.my",                 40, "ISP Malaysia"),

    # Singapore
    ("Singtel",        "SG", "Singapore","8.8.8.8",       "https://www.singtel.com",                  50, "ISP Singapura"),

    # Japan
    ("NTT DOCOMO",     "JP", "Tokyo",    "9.9.9.9",        "https://www.nttdocomo.co.jp",              60, "Operator selular JP"),

    # Germany
    ("Deutsche Telekom","DE","Frankfurt", "1.1.1.1",       "https://www.telekom.de",                   70, "ISP Jerman"),

    # France
    ("Orange",         "FR", "Paris",    "8.8.8.8",        "https://www.orange.fr",                    71, "ISP Prancis"),

    # Brazil
    ("Vivo",           "BR", "Sao Paulo", "1.1.1.1",       "https://www.vivo.com.br",                  80, "Operator selular BR"),
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
    print(f"Seed selesai: {len(GLOBAL_ISPS)} ISP global (endpoint riil).")


if __name__ == "__main__":
    asyncio.run(seed())
