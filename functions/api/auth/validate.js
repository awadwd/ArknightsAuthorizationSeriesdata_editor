// Cloudflare Pages Function - Validate Token
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

      return new Response(JSON.stringify({
        success: true,
        user: login,
        source,
        isOwner: isOwner(login, source),
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': sessionSetCookie(sid),
        }
      });
    } else {
      return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
