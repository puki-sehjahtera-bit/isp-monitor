"use strict";
const dns = require("dns").promises;

const DNS_TIMEOUT = 5000;
function withTimeout(p, ms = DNS_TIMEOUT) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

// Balik IP jadi bentuk query Cymru: 8.8.8.8 -> 8.8.8.8.origin.asn.cymru.com
function cymruName(ip) {
  return ip.split(".").reverse().join(".") + ".origin.asn.cymru.com";
}

// Kembalikan ASN pemilik IP (via DNS TXT Cymru, tanpa API key).
// Hasil: "15169 | 8.8.8.0/24 | US | ..."
async function asnOf(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;
  try {
    const rows = await withTimeout(dns.resolveTxt(cymruName(ip)));
    const txt = rows.map((r) => r.join("")).join(" | ");
    const asn = parseInt(txt.split("|")[0].trim(), 10);
    return Number.isNaN(asn) ? null : asn;
  } catch {
    return null;
  }
}

// Resolve target ISP ke IP, lalu cek ASN-nya vs ASN yang dideklarasikan ISP.
async function verifyIsp(isp) {
  const raw = isp.real_ip || isp.isp_ip || (isp.http_url ? hostOf(isp.http_url) : null);
  if (!raw) return { ip: null, asn: null, expected: isp.asn || null, match: null, note: "tidak ada target" };
  let ip = raw;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    try { ip = (await withTimeout(dns.lookup(ip))).address; }
    catch { return { ip: null, asn: null, expected: isp.asn || null, match: null, note: "gagal resolve " + raw }; }
  }
  const asn = await asnOf(ip);
  const expected = isp.asn ? parseInt(isp.asn, 10) : null;
  let match = null;
  if (expected && asn) match = expected === asn;
  else if (!expected) match = null;
  return { ip, asn, expected, match, note: match === false ? "ASN beda — bukan server ISP ini" : match === true ? "ASN cocok" : "" };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

module.exports = { asnOf, verifyIsp };
