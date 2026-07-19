// Proxy /api/* ke Worker API (same-origin, tembus adblock).
// Target diisi via "Variables and secrets" project Pages (key API_WORKER_URL),
// fallback ke workers.dev kalau belum diset.
const FALLBACK = "https://isp-monitor-api.<SUBDOMAIN>.workers.dev";

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // /api/isp-info: geo + ISP pengunjung dihitung di edge Pages
  // (context.request.cf merefleksi pengunjung asli, bukan proxy).
  if (url.pathname === "/api/isp-info") {
    const cf = context.request.cf || {};
    const ip = context.request.headers.get("cf-connecting-ip")
      || (context.request.headers.get("x-forwarded-for") || "").split(",")[0].trim()
      || "";
    const isp = cf.asOrganization || (cf.asn ? "AS" + cf.asn : "Unknown");
    const city = cf.city || "-";
    const region = cf.region || cf.regionCode || "";
    return new Response(
      JSON.stringify({ ip, isp, city, region }),
      { headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" } }
    );
  }

  const base = context.env.API_WORKER_URL || FALLBACK;
  const target = base.replace(/\/+$/, "") + url.pathname + url.search;
  const res = await fetch(target, context.request);
  // Cache response GET di edge Cloudflare (shared) 60dtk -> hemat quota Workers:
  // N visitor dalam 60dtk cuma invoke fungsi 1x, sisanya dilayani dari cache.
  // POST (check/lapor) tetap no-cache.
  if (context.request.method === "GET") {
    const h = new Headers(res.headers);
    h.set("cache-control", "public, max-age=60");
    return new Response(res.body, { status: res.status, headers: h });
  }
  return res;
}
