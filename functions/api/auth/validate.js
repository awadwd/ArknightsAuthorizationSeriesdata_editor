// Cloudflare Pages Function - Validate Token
// fix v2: Set-Cookie via new Headers() + append() (CF Workers canonical form)
import { isOwner } from '../_lib/owner.js';
import { generateSid, sessionSetCookie, saveAuthBySid } from '../_lib/session.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { username, token } = body;

    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'Arknights-Tool' },
    });

    if (userRes.ok) {
      const user = await userRes.json();
      const login = user.login || username;
      const source = 'github';

      const sid = generateSid();
      await saveAuthBySid(env, sid, {
        username: login,
        token: token,
        source,
        isOwner: isOwner(login, source),
        authenticated: true,
        expires: Date.now() + 30 * 24 * 3600 * 1000,
      });

      let kvOk = false;
      if (env.AUTH_STORE) {
        const verify = await env.AUTH_STORE.get(`auth:${sid}`);
        kvOk = !!verify;
      }

      // Canonical CF Workers Set-Cookie form
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.append('Set-Cookie', sessionSetCookie(sid));

      return new Response(JSON.stringify({
        success: true,
        user: login,
        source,
        isOwner: isOwner(login, source),
        kvOk,
      }), { headers });
    } else {
      return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
