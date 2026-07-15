"use strict";
require("dotenv").config();
const db = require("./db");

// [name, country, region, isp_ip, http_url, order, notes, category, asn, real_ip]
// asn     = ASN asli operator/CDN (dari bgp.he.net / PeeringDB) — labelling akurat.
// real_ip = IP infrastruktur asli (resolver/edge anycast) kalau ada & stabil.
//           Kosong -> ping ke domain sendiri (host http_url). Jangan isi IP asing.
// isp_ip  = cadangan (jarang dipakai; real_ip lebih diutamakan utk ping).
const GLOBAL_ISPS = [
  // ── ISP Lokal Indonesia (inti) ──
  ["Telkomsel", "ID", "Java", "", "https://www.telkomsel.com", 1, "Operator selular terbesar ID", "isp", "23693", ""],
  ["XL Axiata", "ID", "Java", "", "https://www.xl.co.id", 2, "Operator selular ID", "isp", "24203", ""],
  ["IndiHome", "ID", "Java", "", "https://www.indihome.co.id", 3, "ISP fixed broadband Telkom", "isp", "7713", "203.130.196.5"],
  ["Biznet", "ID", "Jakarta", "", "https://www.biznetnetworks.com", 4, "ISP broadband ID", "isp", "17451", ""],
  ["MyRepublic", "ID", "Jakarta", "", "https://www.myrepublic.co.id", 5, "ISP fiber ID, routing game", "isp", "64073", ""],
  ["First Media", "ID", "Jakarta", "", "https://www.firstmedia.com", 8, "ISP kabel ID", "isp", "23700", ""],
  ["Smartfren", "ID", "Java", "", "https://www.smartfren.com", 10, "Operator seluler ID", "isp", "4515", ""],
  ["Iconnet", "ID", "Nasional", "", "iconnet.id", 9, "PLN Infrastruktur, jangkauan luas", "isp", "141967", ""],

  // ── ISP Lokal / Regional Indonesia (kategori "local") ──
  ["DBN Menaksopal", "ID", "Jawa Tengah", "", "", 35, "ISP regional Jateng", "local", "", ""],
  ["Chandella Lintas Media", "ID", "Jawa Timur", "", "", 36, "ISP regional Jatim", "local", "", ""],
  ["Buroq Gayatri", "ID", "Jawa Barat", "", "https://buroq.com", 37, "ISP regional Jabar", "local", "", ""],

  // ── Anycast DNS global (reachability probe) ──
  ["Cloudflare DNS", "US", "Global", "1.1.1.1", "https://www.cloudflare.com/cdn-cgi/trace", 10, "Anycast DNS global", "isp", "13335", "1.1.1.1", "https://www.cloudflarestatus.com/api/v2/summary.json"],
  ["Google DNS", "US", "Global", "8.8.8.8", "https://www.google.com/generate_204", 11, "Anycast DNS global", "isp", "15169", "8.8.8.8"],

  // ── CDN / konten global (Akamai, GGC/Google, Cloudflare, sosmed) ──
  ["Akamai", "US", "Global", "", "https://www.akamai.com", 90, "CDN global", "cdn", "20940", "", "https://status.akamai.com/api/v2/summary.json"],
  ["Fastly", "US", "Global", "", "https://www.fastly.com", 91, "CDN global", "cdn", "54113", "", "https://www.fastlystatus.com/api/v2/summary.json"],
  ["Cloudflare CDN", "US", "Global", "1.1.1.1", "https://www.cloudflare.com", 92, "CDN + anycast", "cdn", "13335", "1.1.1.1", "https://www.cloudflarestatus.com/api/v2/summary.json"],
  ["YouTube", "US", "Global", "8.8.8.8", "https://www.youtube.com", 93, "Google video (GGC)", "cdn", "15169", "8.8.8.8"],
  ["Netflix", "US", "Global", "", "https://www.netflix.com", 94, "Streaming", "cdn", "2906", ""],
  ["TikTok", "SG", "Global", "", "https://www.tiktok.com", 95, "Platform video", "cdn", "45090", ""],
  ["Meta/Facebook", "US", "Global", "", "https://www.facebook.com", 96, "Social", "cdn", "32934", ""],
];

function seed() {
  for (const [name, country, region, ip, url, order, note, category, asn, real_ip, status_url] of GLOBAL_ISPS) {
    db.getOrCreateIsp({
      name, country, region, isp_ip: ip, http_url: url, order_index: order, notes: note, category, asn, real_ip, status_url,
    });
    // Update asn/real_ip/status_url bahkan untuk row yg sudah ada (idempoten).
    db.db.prepare("UPDATE isp_list SET asn=?, real_ip=?, status_url=? WHERE name=? AND country=?")
      .run(asn, real_ip, status_url, name, country);
  }
  console.log(`Seed selesai: ${GLOBAL_ISPS.length} target (${GLOBAL_ISPS.filter(i => i[7] === 'isp').length} isp, ${GLOBAL_ISPS.filter(i => i[7] === 'cdn').length} cdn, ${GLOBAL_ISPS.filter(i => i[7] === 'local').length} lokal).`);
}

if (require.main === module) seed();

module.exports = { seed, GLOBAL_ISPS };
