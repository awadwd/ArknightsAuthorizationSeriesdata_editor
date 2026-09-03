// Cloudflare Pages Function - Validate Token
// NEW: 彻底去掉 KV session, 直接返回 token 凭证
// 前端存 localStorage, 后续请求带 Authorization: Bearer <token>
import { isOwner } from '../_lib/owner.js';

export async function onRequestPost(context) {
  const { request } = context;

  try {
    const body = await request.json();
    const { username, token } = body;

    if (!username || !token) {
      return new Response(JSON.stringify({ success: false, error: 'username and token required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // 验证 GitHub token
    let userData = null;
    let source = null;

    try {
      const ghRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'v' }
      });
      if (ghRes.ok) {
        const ghUser = await ghRes.json();
        if (String(ghUser.login).toLowerCase() === String(username).toLowerCase()) {
          userData = { login: ghUser.login, id: ghUser.id };
          source = 'github';
        }
      }
    } catch { /* ignore */ }

    // 验证 GitCode token
    if (!userData) {
      try {
        const gcRes = await fetch('https://gitcode.com/api/v1/user/' + encodeURIComponent(username), {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'v' }
        });
        if (gcRes.ok) {
          const gcUser = await gcRes.json();
          if (String(gcUser.name || '').toLowerCase() === String(username).toLowerCase()) {
            userData = { login: gcUser.name, id: String(gcUser.id || '') };
            source = 'gitcode';
          }
        }
      } catch { /* ignore */ }
    }

    if (!userData) {
      return new Response(JSON.stringify({ success: false, error: 'invalid token or username mismatch' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }

    const owner = await isOwner(userData.login, userData.id, source);
    if (!owner) {
      return new Response(JSON.stringify({ success: false, error: 'not authorized as owner' }), {
        status: 403, headers: { 'Content-Type': 'application/json' }
      });
    }

    // 不再写 KV! 直接返回凭证，前端存 localStorage
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    return new Response(JSON.stringify({
      success: true,
      user: userData.login,
      source,
      isOwner: true,
      token,
      expiresAt,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
