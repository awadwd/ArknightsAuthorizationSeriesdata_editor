// Cloudflare Pages Functions 动态路由测试
// 访问 /api/kc/Version -> params.path = "kc/Version"
export async function onRequest(context) {
  const path = context.params.path || "";
  // 去掉前缀 "kc/"
  const table = path.startsWith("kc/") ? path.slice(3) : path;
  return new Response(JSON.stringify({
    ok: true,
    path: path,
    table: table,
    url: context.request.url
  }), {
    headers: {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
  });
}
