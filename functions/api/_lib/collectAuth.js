// 采集令牌：给「油猴脚本 / 别处的自动化」一条只能写千岛会话的窄通道
//
// 为什么不用 X-Sync-Token：那是机器跑同步 / 刷新市价用的，权限大到能改仓库。
// 油猴脚本跑在第三方页面（qiandao.com）里，用一个「泄露了也只会覆盖一份缓存会话」的
// 独立令牌更合适——它不能读配置、不能提 PR、不能写 Box_Id.json。
//
// 令牌明文存在 appConfig.prices.qiandao.collectToken（KV 里，不进 git），
// 接口回显只给前 4 位，生成时一次性返回完整值。

import { getAppConfig, saveAppConfig } from './appConfig.js';

export const COLLECT_TOKEN_HEADER = 'X-Collect-Token';

function safeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (!x || !y || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export function generateToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return 'qd_' + hex;
}

export function maskToken(t) {
  const s = String(t || '');
  if (!s) return '';
  return s.length <= 8 ? '***' : s.slice(0, 4) + '***' + s.slice(-3);
}

export function tokenOf(cfg) {
  const q = (cfg && cfg.prices && cfg.prices.qiandao) || {};
  return String(q.collectToken || '');
}

// 请求头带的令牌是否有效
export function verifyCollectToken(request, cfg) {
  const got = request.headers.get(COLLECT_TOKEN_HEADER) || '';
  const want = tokenOf(cfg);
  return !!want && safeEqual(got, want);
}

export function collectTokenStatus(cfg) {
  const t = tokenOf(cfg);
  return { set: !!t, hint: maskToken(t), updatedAt: ((cfg && cfg.prices && cfg.prices.qiandao) || {}).collectTokenAt || null };
}

// op = 'generate' | 'clear'；返回完整令牌（仅 generate 时）
export async function rotateCollectToken(env, op) {
  const cfg = await getAppConfig(env);
  const prices = Object.assign({}, cfg.prices || {});
  const qiandao = Object.assign({}, prices.qiandao || {});
  if (op === 'clear') {
    qiandao.collectToken = '';
    qiandao.collectTokenAt = null;
  } else {
    qiandao.collectToken = generateToken();
    qiandao.collectTokenAt = new Date().toISOString();
  }
  prices.qiandao = qiandao;
  await saveAppConfig(env, Object.assign({}, cfg, { prices }));
  return { token: op === 'clear' ? '' : qiandao.collectToken, status: { set: !!qiandao.collectToken, hint: maskToken(qiandao.collectToken), updatedAt: qiandao.collectTokenAt } };
}
