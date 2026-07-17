// Proxy /admin ke backend — same-origin (pakai token seperti biasa).
export async function onRequest(context) {
  const target = "https://api.isp-monitor.my.id/admin";
  return fetch(target, context.request);
}
