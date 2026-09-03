// Shared auth helper — header-token 鉴权（不再依赖 KV/cookie session）
// 读取 Authorization: Bearer <token>，调平台 /user 验证用户名 + owner 白名单
import { isOwner } from './owner.js';

export async function verifyRequest(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  // GitHub
  try {
    const ghRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'v' }
    });
    if (ghRes.ok) {
      const u = await ghRes.json();
      const owner = await isOwner(String(u.login), String(u.id), 'github');
      return { username: u.login, source: 'github', isOwner: owner, token };
    }
  } catch { /* ignore */ }

  // GitCode
  try {
    const gcRes = await fetch('https://gitcode.com/api/v1/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'v' }
    });
    if (gcRes.ok) {
      const u = await gcRes.json();
      const owner = await isOwner(String(u.name || ''), String(u.id || ''), 'gitcode');
      return { username: u.name, source: 'gitcode', isOwner: owner, token };
    }
  } catch { /* ignore */ }

  return null;
}
