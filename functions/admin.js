// /admin -> static admin.html (Pages sudah serve file statis).
export async function onRequest(context) {
  return Response.redirect(new URL("/admin.html", context.request.url).href, 302);
}
