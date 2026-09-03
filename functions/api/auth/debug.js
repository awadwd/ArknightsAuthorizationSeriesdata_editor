// debug: show server-side view of cookie + KV
export async function onRequest({ request, env }) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookieParts = cookieHeader.split(';').map(s => s.trim()).filter(Boolean);
  const cookies = {};
  for (const p of cookieParts) {
    const eq = p.indexOf('=');
    if (eq > 0) cookies[p.slice(0, eq)] = p.slice(eq + 1);
  }
  const sid = cookies['editor_sid'] || null;

  let kvResult = null;
  let kvError = null;
  let kvList = null;
  try {
    if (sid) {
      const raw = await env.AUTH_STORE.get('auth:' + sid);
      kvResult = raw ? JSON.parse(raw) : null;
      if (kvResult) {
        const msLeft = kvResult.expiresAt - Date.now();
        kvResult._expiresInSec = Math.round(msLeft / 1000);
      }
    }
    const list = await env.AUTH_STORE.list({ prefix: 'auth:' });
    kvList = list.keys.map(k => ({ name: k.name, exp: k.expiration }));
  } catch (e) {
    kvError = String(e);
  }

  return new Response(JSON.stringify({
    cookieHeader,
    cookieKeys: Object.keys(cookies),
    sid,
    sidLength: sid ? sid.length : 0,
    kvResult,
    kvError,
    kvListCount: kvList ? kvList.length : 0,
    kvListSample: kvList ? kvList.slice(0, 5) : null,
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
