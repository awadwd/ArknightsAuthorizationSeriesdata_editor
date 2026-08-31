// Cloudflare Pages Function - Logout
// Clears the session cookie and the per-sid KV record. Idempotent.
import { getSessionId, sessionClearCookie, deleteAuthBySid } from '../_lib/session.js';

export async function onRequest(context) {
  const { request, env } = context;
  const sid = getSessionId(request);
  if (sid) {
    try { await deleteAuthBySid(env, sid); } catch {}
  }
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionClearCookie(),
    }
  });
}
