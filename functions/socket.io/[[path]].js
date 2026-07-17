// Proxy /socket.io/* (termasuk upgrade WebSocket) ke backend — same-origin.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const target = "https://api.isp-monitor.my.id" + url.pathname + url.search;
  return fetch(target, context.request);
}
