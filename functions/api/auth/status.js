// Cloudflare Pages Function - Auth Status
// NEW: 优先读 Authorization: Bearer <token> (无 KV 依赖)
// 兼容旧 cookie session (只读旧 session, 不写新 session)
import { isOwner } from '../_lib/owner.js';

async function verifyFromHeader(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  // 试 GitHub
  try {
    const ghRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'v' }
    });
    if (ghRes.ok) {
      const ghUser = await ghRes.json();
      const owner = await isOwner(String(ghUser.login), String(ghUser.id), 'github');
      if (owner) return { username: ghUser.login, source: 'github', isOwner: true };
    }
  } catch { /* ignore */ }

  // 试 GitCode
  try {
    const gcRes = await fetch('https://gitcode.com/api/v1/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'v' }
    });
    if (gcRes.ok) {
      const gcUser = await gcRes.json();
      const owner = await isOwner(String(gcUser.name || ''), String(gcUser.id || ''), 'gitcode');
      if (owner) return { username: gcUser.name, source: 'gitcode', isOwner: true };
    }
  } catch { /* ignore */ }

  return null;
}

export async function onRequest(context) {
  const { request, env } = context;

  // 优先: Authorization header 鉴权 (无 KV)
  const headerAuth = await verifyFromHeader(request);
  if (headerAuth) {
    return new Response(JSON.stringify({
      authenticated: true,
      username: headerAuth.username,
      source: headerAuth.source,
      isOwner: headerAuth.isOwner,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // 兼容旧 cookie session (只读, 不写新)
  let sid = null;
  const cookieStr = request.headers.get('Cookie') || '';
  for (const part of cookieStr.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'editor_sid') { sid = v.join('='); break; }
  }

  if (sid) {
    try {
      const raw = await env.AUTH_STORE.get('auth:' + sid, { type: 'json' });
      if (raw && raw.expiresAt > Date.now()) {
        return new Response(JSON.stringify({
          authenticated: true,
          username: raw.username,
          source: raw.source,
          isOwner: raw.isOwner || false,
        }), { headers: { 'Content-Type': 'application/json' } });
      }
    } catch { /* ignore */ }
  }

  return new Response(JSON.stringify({ authenticated: false, username: null, isOwner: false }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
