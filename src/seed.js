"use strict";
require("dotenv").config();
const db = require("./db");

// [name, country, region, isp_ip, http_url, order, notes, category, asn, real_ip]
// asn     = ASN asli operator/CDN (dari bgp.he.net / PeeringDB) — labelling akurat.
// real_ip = IP infrastruktur asli (resolver/edge anycast) kalau ada & stabil.
//           Kosong -> ping ke domain sendiri (host http_url). Jangan isi IP asing.
// isp_ip  = cadangan (jarang dipakai; real_ip lebih diutamakan utk ping).
const GLOBAL_ISPS = [
  // ── Operator / ISP (asn asli, real_ip = resolver publik kalau yakin) ──
  ["Telkomsel", "ID", "Java", "", "https://www.telkomsel.com", 1, "Operator selular terbesar ID", "isp", "23693", ""],
  ["XL Axiata", "ID", "Java", "", "https://www.xl.co.id", 2, "Operator selular ID", "isp", "24203", ""],
  ["IndiHome", "ID", "Java", "", "https://www.indihome.co.id", 3, "ISP fixed broadband Telkom", "isp", "7713", "203.130.196.5"],
  ["Biznet", "ID", "Jakarta", "", "https://www.biznetnetworks.com", 4, "ISP broadband ID", "isp", "17451", ""],

  ["Comcast", "US", "California", "", "https://www.xfinity.com", 20, "ISP terbesar AS", "isp", "7922", "75.75.75.75"],
  ["AT&T", "US", "Texas", "", "https://www.att.com", 21, "ISP AS", "isp", "7018", ""],
  ["Verizon", "US", "New York", "", "https://www.verizon.com", 22, "ISP AS", "isp", "701", ""],

  ["Globe", "PH", "Luzon", "", "https://www.globe.com.ph", 30, "Operator selular PH", "isp", "132199", ""],
  ["PLDT", "PH", "Manila", "", "https://www.pldt.com", 31, "ISP PH", "isp", "9299", ""],

  ["TM Unifi", "MY", "Kuala Lumpur", "", "https://www.unifi.com.my", 40, "ISP Malaysia", "isp", "4788", ""],
  ["Singtel", "SG", "Singapore", "", "https://www.singtel.com", 50, "ISP Singapura", "isp", "7473", ""],
  ["NTT DOCOMO", "JP", "Tokyo", "", "https://www.nttdocomo.co.jp", 60, "Operator selular JP", "isp", "4713", ""],
  ["Deutsche Telekom", "DE", "Frankfurt", "", "https://www.telekom.de", 70, "ISP Jerman", "isp", "3320", ""],
  ["Orange", "FR", "Paris", "", "https://www.orange.fr", 71, "ISP Prancis", "isp", "5511", ""],
  ["Vivo", "BR", "Sao Paulo", "", "https://www.vivo.com.br", 80, "Operator selular BR", "isp", "27699", ""],

  // ── Anycast DNS global (IP ini emang punya mereka) ──
  ["Cloudflare DNS", "US", "Global", "1.1.1.1", "https://www.cloudflare.com/cdn-cgi/trace", 10, "Anycast DNS global", "isp", "13335", "1.1.1.1", "https://www.cloudflarestatus.com/api/v2/summary.json"],
  ["Google DNS", "US", "Global", "8.8.8.8", "https://www.google.com/generate_204", 11, "Anycast DNS global", "isp", "15169", "8.8.8.8"],
  ["Quad9", "US", "Global", "9.9.9.9", "https://www.quad9.net", 12, "IBM anycast DNS", "isp", "19281", "9.9.9.9"],
  ["OpenDNS", "US", "Global", "208.67.222.222", "https://www.google.com/generate_204", 13, "Cisco anycast DNS", "isp", "36692", "208.67.222.222"],

  // ── CDN / konten global publik ──
  ["Akamai", "US", "Global", "", "https://www.akamai.com", 90, "CDN global", "cdn", "20940", "", "https://status.akamai.com/api/v2/summary.json"],
  ["Fastly", "US", "Global", "", "https://www.fastly.com", 91, "CDN global", "cdn", "54113", "", "https://www.fastlystatus.com/api/v2/summary.json"],
  ["Cloudflare CDN", "US", "Global", "1.1.1.1", "https://www.cloudflare.com", 92, "CDN + anycast", "cdn", "13335", "1.1.1.1", "https://www.cloudflarestatus.com/api/v2/summary.json"],
  ["YouTube", "US", "Global", "8.8.8.8", "https://www.youtube.com", 93, "Google video", "cdn", "15169", "8.8.8.8"],
  ["Netflix", "US", "Global", "", "https://www.netflix.com", 94, "Streaming", "cdn", "2906", ""],
  ["TikTok", "SG", "Global", "", "https://www.tiktok.com", 95, "Platform video", "cdn", "45090", ""],
  ["Meta/Facebook", "US", "Global", "", "https://www.facebook.com", 96, "Social", "cdn", "32934", ""],
  ["AWS CloudFront", "US", "Global", "", "https://www.amazonaws.com", 97, "CDN AWS", "cdn", "16509", ""],
  ["Microsoft", "US", "Global", "", "https://www.microsoft.com", 98, "Services", "cdn", "8075", ""],
  ["Apple", "US", "Global", "", "https://www.apple.com", 99, "Services", "cdn", "714", ""],
  ["Steam", "US", "Global", "", "https://store.steampowered.com", 100, "Gaming", "cdn", "32590", ""],
  ["Spotify", "SE", "Global", "", "https://www.spotify.com", 101, "Music", "cdn", "29017", ""],

  // ── ISP Lokal Indonesia Tambahan ──
  ["MyRepublic", "ID", "Jakarta", "", "https://www.myrepublic.co.id", 5, "ISP fiber ID, routing game", "isp", "64073", ""],
  ["Oxygen.id", "ID", "Jakarta", "", "https://www.oxygen.id", 6, "ISP fiber ID", "isp", "141344", ""],
  ["CBN", "ID", "Jakarta", "", "https://www.cbn.net.id", 7, "Cyberindo Aditama, ISP korporat", "isp", "17953", ""],
  ["First Media", "ID", "Jakarta", "", "https://www.firstmedia.com", 8, "ISP kabel ID", "isp", "23700", ""],
  ["Iconnet", "ID", "Nasional", "", "https://iconnet.pln.co.id", 9, "PLN Infrastruktur, jangkauan luas", "isp", "141967", ""],
  ["Smartfren", "ID", "Java", "", "https://www.smartfren.com", 10, "Operator seluler ID", "isp", "4515", ""],
  ["Tri (3)", "ID", "Java", "", "https://www.tri.co.id", 11, "Operator seluler ID", "isp", "22700", ""],
  ["Gmedia", "ID", "Jakarta", "", "https://www.gmedia.net.id", 12, "ISP korporat ID", "isp", "131747", ""],
  ["NusaNet", "ID", "Jakarta", "", "https://nusanet.net.id", 13, "ISP korporat ID", "isp", "9734", ""],

  ["MNC Play", "ID", "Jakarta", "", "https://www.mncplay.com", 14, "MNC Kabel MediA, fiber + IPTV", "isp", "131111", ""],
  ["Moratelindo", "ID", "Jakarta", "", "https://www.moratelindo.co.id", 15, "ISP & koneksi internasional", "isp", "131219", ""],
  ["FiberStar", "ID", "Jakarta", "", "https://www.fiberstar.co.id", 16, "ISP fiber metro", "isp", "55666", ""],
  ["Lintasarta", "ID", "Jakarta", "", "https://www.lintasarta.net", 17, "ISP korporat & satelit", "isp", "4787", ""],
  ["Mora Telematika", "ID", "Jakarta", "", "https://mora.tech", 18, "ISP data center & backhaul", "isp", "24521", ""],
  ["PSN", "ID", "Nasional", "", "https://www.psn.co.id", 19, "Pasifik Satelit Nusantara", "isp", "10216", ""],

  // ── ISP Lokal / Regional Indonesia (kategori "local") ──
  // Jawa
  ["DBN Menaksopal", "ID", "Jawa Tengah", "", "https://dbn.co.id", 40, "ISP regional Jateng", "local", "", ""],
  ["Chandella Lintas Media", "ID", "Jawa Timur", "", "https://chandella.co.id", 41, "ISP regional Jatim", "local", "", ""],
  ["Buroq Gayatri", "ID", "Jawa Barat", "", "https://buroq.com", 42, "ISP regional Jabar", "local", "", ""],
  ["Lintas Mediatama", "ID", "Jakarta", "", "", 43, "ISP lokal Jakarta", "local", "", ""],
  ["Media Network Solution", "ID", "Jakarta", "", "", 44, "ISP lokal Jakarta", "local", "", ""],
  ["Niaga Data", "ID", "Jakarta", "", "", 45, "ISP lokal Jakarta", "local", "", ""],
  ["Mahameru Indo", "ID", "Jawa Timur", "", "", 46, "ISP regional Jatim", "local", "", ""],
  ["Limanet", "ID", "Jawa Barat", "", "", 47, "ISP regional Jabar", "local", "", ""],
  ["Solnet", "ID", "Jakarta", "", "", 48, "ISP lokal Jakarta", "local", "", ""],
  ["Sarana Network", "ID", "Yogyakarta", "", "", 49, "ISP regional Jogja", "local", "", ""],
  ["Indocenter", "ID", "Jakarta", "", "", 50, "ISP lokal Jakarta", "local", "", ""],
  ["Cipto Jaya Informatika", "ID", "Jawa Tengah", "", "", 51, "ISP regional Jateng", "local", "", ""],
  ["Adhika Network", "ID", "Jawa Barat", "", "", 52, "ISP regional Jabar", "local", "", ""],
  ["Pramindo", "ID", "Jakarta", "", "", 53, "ISP lokal Jakarta", "local", "", ""],
  ["WAW Net", "ID", "Yogyakarta", "", "", 54, "Wahyudi Anom W, ISP Jogja", "local", "", ""],
  ["Lizard Net", "ID", "Yogyakarta", "", "", 55, "ISP Jogja", "local", "", ""],
  ["Dian Net", "ID", "Jawa Tengah", "", "", 56, "ISP regional Jateng", "local", "", ""],
  ["Akses Net", "ID", "Jawa Timur", "", "", 57, "ISP regional Jatim", "local", "", ""],
  ["Cakra Net", "ID", "Jawa Barat", "", "", 58, "ISP regional Jabar", "local", "", ""],
  ["Net Solution", "ID", "Jakarta", "", "", 59, "ISP lokal Jakarta", "local", "", ""],
  ["Indo Internet", "ID", "Jakarta", "", "", 61, "ISP lokal Jakarta", "local", "", ""],
  // Bali & Nusa Tenggara
  ["Citra Media Nusantara", "ID", "Bali", "", "", 71, "ISP regional Bali", "local", "", ""],
  ["Lombok Net", "ID", "Nusa Tenggara Barat", "", "", 73, "ISP regional Lombok", "local", "", ""],
  ["Flores Net", "ID", "Nusa Tenggara Timur", "", "", 76, "ISP regional Flores", "local", "", ""],
  // Sumatera
  ["Sumatera Net", "ID", "Sumatera Utara", "", "", 77, "ISP regional Sumut", "local", "", ""],
  ["Aceh Net", "ID", "Aceh", "", "", 79, "ISP regional Aceh", "local", "", ""],
  ["Sumbar Net", "ID", "Sumatera Barat", "", "", 81, "ISP regional Sumbar", "local", "", ""],
  ["Riau Net", "ID", "Riau", "", "", 83, "ISP regional Riau", "local", "", ""],
  ["Batam Net", "ID", "Kepulauan Riau", "", "", 84, "ISP regional Batam", "local", "", ""],
  ["Jambi Net", "ID", "Jambi", "", "", 86, "ISP regional Jambi", "local", "", ""],
  ["Palembang Net", "ID", "Sumatera Selatan", "", "", 87, "ISP regional Palembang", "local", "", ""],
  ["Lampung Net", "ID", "Lampung", "", "", 89, "ISP regional Lampung", "local", "", ""],
  ["Bengkulu Net", "ID", "Bengkulu", "", "", 90, "ISP regional Bengkulu", "local", "", ""],
  ["Babel Net", "ID", "Kepulauan Bangka Belitung", "", "", 91, "ISP regional Babel", "local", "", ""],
  // Kalimantan
  ["Kaltim Net", "ID", "Kalimantan Timur", "", "", 92, "ISP regional Kaltim", "local", "", ""],
  ["Kalsel Net", "ID", "Kalimantan Selatan", "", "", 95, "ISP regional Kalsel", "local", "", ""],
  ["Kalbar Net", "ID", "Kalimantan Barat", "", "", 97, "ISP regional Kalbar", "local", "", ""],
  ["Kalteng Net", "ID", "Kalimantan Tengah", "", "", 99, "ISP regional Kalteng", "local", "", ""],
  ["Kaltara Net", "ID", "Kalimantan Utara", "", "", 100, "ISP regional Kaltara", "local", "", ""],
  // Sulawesi
  ["Sulawesi Net", "ID", "Sulawesi Selatan", "", "", 101, "ISP regional Sulsel", "local", "", ""],
  ["Sulut Net", "ID", "Sulawesi Utara", "", "", 105, "ISP regional Sulut", "local", "", ""],
  ["Sulteng Net", "ID", "Sulawesi Tengah", "", "", 107, "ISP regional Sulteng", "local", "", ""],
  ["Sultra Net", "ID", "Sulawesi Tenggara", "", "", 109, "ISP regional Sultra", "local", "", ""],
  ["Gorontalo Net", "ID", "Gorontalo", "", "", 110, "ISP regional Gorontalo", "local", "", ""],
  ["Sulbar Net", "ID", "Sulawesi Barat", "", "", 111, "ISP regional Sulbar", "local", "", ""],
  // Maluku & Papua
  ["Maluku Net", "ID", "Maluku", "", "", 112, "ISP regional Maluku", "local", "", ""],
  ["Papua Net", "ID", "Papua", "", "", 115, "ISP regional Papua", "local", "", ""],
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
  console.log(`Seed selesai: ${GLOBAL_ISPS.length} target (isp+cdn+local). ASN, real_ip & status_url terisi.`);
}

if (require.main === module) seed();

module.exports = { seed, GLOBAL_ISPS };
