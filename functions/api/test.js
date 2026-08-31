export async function onRequest(context) {
  var pathname = new URL(context.request.url).pathname;
  return new Response(JSON.stringify({
    ok: true,
    method: "flat-kc-v3",
    time: new Date().toISOString(),
    path: pathname
  }), {
    headers: {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
  });
}
