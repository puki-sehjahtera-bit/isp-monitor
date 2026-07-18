// Proxy /api/* ke Worker API (same-origin, tembus adblock).
// Target diisi via "Variables and secrets" project Pages (key API_WORKER_URL),
// fallback ke workers.dev kalau belum diset.
const FALLBACK = "https://isp-monitor-api.<SUBDOMAIN>.workers.dev";
export async function onRequest(context) {
  const base = context.env.API_WORKER_URL || FALLBACK;
  const url = new URL(context.request.url);
  const target = base.replace(/\/+$/, "") + url.pathname + url.search;
  return fetch(target, context.request);
}
