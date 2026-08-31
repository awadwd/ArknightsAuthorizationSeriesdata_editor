// CF Pages Functions: 顶层 [...slug] 捕获测试
export async function onRequest(context) {
  const slug = context.params.slug;
  return new Response(JSON.stringify({
    ok: true,
    method: "top-level-catchall",
    slug: slug,
    url: context.request.url
  }), {
    headers: {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
  });
}
