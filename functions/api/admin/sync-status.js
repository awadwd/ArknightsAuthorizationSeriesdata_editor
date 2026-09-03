// 同步状态：公开读（前端展示上次同步时间 / PR 链接）
function cors() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function onRequestGet(context) {
  try {
    if (!context.env.AUTH_STORE) {
      return new Response(JSON.stringify({ success: true, status: { lastRunAt: null } }), { headers: cors() });
    }
    const raw = await context.env.AUTH_STORE.get('sync:status');
    const status = raw ? JSON.parse(raw) : { lastRunAt: null };
    return new Response(JSON.stringify({ success: true, status }), { headers: cors() });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: cors() });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}
