// 机器触发鉴权：允许定时任务（Cloudflare Cron / GitHub Actions / cron-job.org）
// 在没有用户 PAT 的情况下触发同步。
//
// 两路：
//   1) 用户会话：Authorization: Bearer <PAT> + owner 白名单（原有逻辑）
//   2) 机器：X-Sync-Token: <SYNC_TOKEN>（环境变量），比对成功即视为 owner 的
//      "系统代跑"，推送用的 token 取 env.SYNC_GITHUB_TOKEN || env.GITHUB_TOKEN。
//
// 设计取舍：机器路径只给"同步/市价刷新"这类幂等任务用，不给提 PR 改业务数据的权限，
// 避免 SYNC_TOKEN 泄露后被拿去乱写仓库。

import { verifyRequest } from './auth.js';

function safeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (!x || !y || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// 返回 { username, token, source, isOwner, machine } 或 null
export async function verifySyncRequest(request, env) {
  const headerToken = request.headers.get('X-Sync-Token') || '';
  const envToken = (env && (env.SYNC_TOKEN || env.SYNC_SECRET)) || '';
  if (envToken && safeEqual(headerToken, envToken)) {
    const pushToken = (env && (env.SYNC_GITHUB_TOKEN || env.GITHUB_TOKEN)) || '';
    if (!pushToken) return null; // 没配推送 token 的机器触发无法落盘，直接拒绝
    return { username: 'scheduler', token: String(pushToken).trim(), source: 'github', isOwner: true, machine: true };
  }
  const auth = await verifyRequest(request);
  if (!auth || !auth.isOwner) return auth ? { ...auth, machine: false, isOwner: false } : null;
  return { ...auth, machine: false };
}

export function syncCors(methods) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods || 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sync-Token',
  };
}
