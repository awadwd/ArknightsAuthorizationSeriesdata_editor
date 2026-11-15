// 千岛会话：把「浏览器控制台抓到的一份东西」存进 KV，供服务端复用
//
// 为什么需要这一层：
//   api.qiandao.com/gactus/* 挂在阿里云 WAF 后面，裸请求会被 acw_sc__v2 挑战挡住，
//   而且有频率限制（实测连发几次就返回 405「您的手速也太快了」）。
//   所以「自己搓一个签名去硬碰」没有意义，正确做法是让已经通过校验的浏览器
//   把 cookie / UA / 真实接口样本交出来，服务端拿这份会话去重放。
//
// 存的东西（bundle，由 public/qiandao-collector.js 生成）：
//   { cookie, ua, referer, islandId, tokens, apis:[{method,url,headers,body}], samples:[{title,price,elite}] }
//
// 注意：cookie 是敏感数据，只写 KV（key=qiandao_session），不进 git、不进 config、
// 接口回显一律打码。

const SESSION_KEY = 'qiandao_session';
// 阿里云 acw_sc__v2 的 max-age 是 3600s，留 10 分钟余量
const COOKIE_TTL_MIN = 50;

export function maskCookie(cookie) {
  const s = String(cookie || '');
  if (!s) return '';
  const parts = s.split(';').map(p => p.trim()).filter(Boolean);
  const keep = parts.slice(0, 3).map(p => {
    const i = p.indexOf('=');
    if (i < 0) return '***';
    const k = p.slice(0, i);
    const v = p.slice(i + 1);
    return k + '=' + (v.length > 8 ? v.slice(0, 4) + '***' + v.slice(-3) : '***');
  });
  return keep.join('; ') + (parts.length > 3 ? ` (+${parts.length - 3})` : '');
}

// 干员名/精英化都不在这里判断，这里只做「形状校验 + 规范化」
export function normalizeBundle(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('bundle 不是对象');
  let bundle = raw;
  // 允许用户直接贴 {bundle:{...}} 包一层
  if (raw.bundle && typeof raw.bundle === 'object') bundle = raw.bundle;
  // 也允许从剪贴板粘成字符串
  if (typeof bundle === 'string') bundle = JSON.parse(bundle);

  const cookie = String(bundle.cookie || '').trim();
  if (!cookie) throw new Error('bundle 里没有 cookie —— 需要在 qiandao.com 页面执行采集脚本（它会读 document.cookie）');

  const apis = Array.isArray(bundle.apis) ? bundle.apis.slice(0, 20).map(a => ({
    method: String(a.method || 'GET').toUpperCase(),
    url: String(a.url || ''),
    headers: a.headers && typeof a.headers === 'object' ? a.headers : {},
    body: a.body == null ? '' : String(a.body).slice(0, 8000),
    count: Number(a.count || 1),
    status: a.status == null ? null : Number(a.status),
  })).filter(a => /^https?:/.test(a.url)) : [];

  const samples = Array.isArray(bundle.samples) ? bundle.samples.slice(0, 5000).map(s => ({
    name: s.name ? String(s.name).slice(0, 60) : null,
    title: String(s.title || s.raw || s.name || '').slice(0, 300),
    price: Number(s.price),
    elite: s.elite || null,
    series: s.series ? String(s.series).slice(0, 60) : '',
    online: s.online == null ? null : Number(s.online),
    href: s.href ? String(s.href).slice(0, 500) : null,
  })).filter(s => s.title && isFinite(s.price) && s.price > 0) : [];

  const islandId = String(bundle.islandId || '').trim();

  return {
    version: 1,
    cookie,
    ua: String(bundle.ua || '').slice(0, 300),
    referer: String(bundle.referer || bundle.url || (islandId ? `https://qiandao.com/island?id=${islandId}` : 'https://qiandao.com/')).slice(0, 500),
    origin: String(bundle.origin || 'https://qiandao.com').slice(0, 200),
    islandId,
    tokens: bundle.tokens && typeof bundle.tokens === 'object' ? truncateObj(bundle.tokens) : {},
    apis,
    samples,
    collectedAt: bundle.collectedAt || new Date().toISOString(),
    savedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + COOKIE_TTL_MIN * 60000).toISOString(),
  };
}

function truncateObj(o) {
  const out = {};
  for (const k of Object.keys(o).slice(0, 30)) {
    const v = o[k];
    out[String(k).slice(0, 60)] = typeof v === 'string' ? v.slice(0, 600) : JSON.stringify(v).slice(0, 600);
  }
  return out;
}

export async function saveSession(env, raw) {
  const bundle = normalizeBundle(raw);
  if (bundle.samples.length === 0 && bundle.apis.length === 0) {
    throw new Error('bundle 里既没有 samples 也没有 apis —— 采集脚本可能没抓到接口，先在页面里滚动/翻页几下再执行 __QD.bundle()');
  }
  await env.AUTH_STORE.put(SESSION_KEY, JSON.stringify(bundle));
  return bundle;
}

export async function getSession(env) {
  try {
    const raw = await env.AUTH_STORE.get(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.cookie) return null;
    return s;
  } catch (e) {
    return null;
  }
}

export async function clearSession(env) {
  await env.AUTH_STORE.delete(SESSION_KEY);
}

// 只给前端看的状态，不含 cookie 原文
export function sessionStatus(s) {
  if (!s) return { present: false };
  const now = Date.now();
  const saved = Date.parse(s.savedAt || 0) || 0;
  const exp = Date.parse(s.expiresAt || 0) || 0;
  return {
    present: true,
    cookieMasked: maskCookie(s.cookie),
    islandId: s.islandId || '',
    ua: (s.ua || '').slice(0, 60),
    cookieCount: String(s.cookie || '').split(';').filter(Boolean).length,
    apiCount: (s.apis || []).length,
    sampleCount: (s.samples || []).length,
    savedAt: s.savedAt || null,
    ageMinutes: saved ? Math.round((now - saved) / 60000) : null,
    expiresInMinutes: exp ? Math.round((exp - now) / 60000) : null,
    expired: exp ? now > exp : true,
  };
}

// 用会话里的 cookie 发一个请求。命中 WAF/限流/登录态失效时给出人能看懂的结论。
export async function qdRequest(session, opts) {
  const o = opts || {};
  const headers = Object.assign({
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'User-Agent': session.ua || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Cookie: session.cookie,
    Origin: session.origin || 'https://qiandao.com',
    Referer: session.referer || 'https://qiandao.com/',
  }, o.headers || {});

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(o.url, {
      method: (o.method || 'GET').toUpperCase(),
      headers,
      body: o.method && o.method.toUpperCase() === 'GET' ? undefined : o.body,
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    const verdict = diagnose(res.status, text);
    if (verdict) return { ok: false, status: res.status, error: verdict, raw: text.slice(0, 300) };
    let json = null;
    try { json = JSON.parse(text); } catch (e) { return { ok: false, status: res.status, error: '返回不是 JSON（可能被 WAF 拦截）', raw: text.slice(0, 300) }; }
    if (json && typeof json.code === 'number' && json.code !== 0 && json.code !== 200) {
      return { ok: false, status: res.status, error: '接口返回 code=' + json.code + ' ' + (json.message || ''), json };
    }
    return { ok: true, status: res.status, json, text };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '请求超时' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

function diagnose(status, text) {
  const t = String(text || '');
  if (status === 405 || /手速太快/.test(t)) return '千岛限流了（手速太快）—— 隔几分钟再试，或把 limit 调小';
  if (status === 401 || status === 403) return 'cookie 已失效或没有权限 —— 回千岛页面重新执行一次采集脚本';
  if (status === 429) return '请求太频繁被限流 —— 等几分钟';
  if (/acw_sc__v2|aliyun_waf|__jsl_clearance/.test(t) && /<html/i.test(t)) return '被阿里云 WAF 挑战拦截 —— 服务端直连不通，请改用「浏览器采集」模式（在面板里粘贴采集结果，不在服务端请求）';
  if (status >= 500) return '千岛服务端错误 ' + status;
  return null;
}

// 从会话捕获的接口里挑最像「行情列表」的几个重放
export function pickReplayApis(session, max) {
  const list = (session.apis || []).filter(a => a.url && a.method);
  const scored = list.map(a => {
    let score = 0;
    // 实测 posts/by-tag-v4 返回的 SPU 里带 strikePrice，是最准的一路
    if (/posts\/by-tag|by-tag|spu|goods/i.test(a.url)) score += 8;
    if (/entry-feeds|feed|list|search|gactus/i.test(a.url)) score += 4;
    if (a.method === 'GET') score += 2;              // GET 重放最稳（不带请求体）
    if (a.method === 'POST' && a.body) score += 2;
    if (/island|market|price|tag/i.test(a.url + ' ' + (a.body || ''))) score += 3;
    if (a.status && a.status >= 400) score -= 8;
    if (/sa\.gif|sensors|collect|\.png|\.jpg|\.css|\.js/i.test(a.url)) score -= 20;
    return { a, score };
  }).sort((x, y) => y.score - x.score);
  return scored.filter(x => x.score > 0).slice(0, max || 3).map(x => x.a);
}
