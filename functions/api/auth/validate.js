// Cloudflare Pages Function - Validate Token
import { isOwner } from '../_lib/owner.js';

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

      await env.AUTH_STORE && env.AUTH_STORE.put('current_auth', JSON.stringify({
        username: login,
        token: token,
        source,
        isOwner: isOwner(login, source),
        authenticated: true,
        expires: Date.now() + 86400000
      }), { expirationTtl: 86400 });

      return new Response(JSON.stringify({
        success: true,
        user: login,
        source,
        isOwner: isOwner(login, source),
      }), {
        headers: { 'Content-Type': 'application/json' }
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
