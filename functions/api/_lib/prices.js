// 市价采集与写回
//
// 背景：Box_Id.json 里每个干员的 market_price 是 { ELITE1, ELITE2 } 两个数字，
// 现在全靠人工在千岛上看行情再填。这里把它做成"可插拔数据源 + 聚合"：
//
//   provider=qiandao  抓千岛行情（需要你在配置里填一个抓包得到的接口地址 + 请求头）
//   provider=import   前端粘贴/导入 CSV 的 [{name, elite, price}]，或者别的脚本产出的 JSON
//   provider=manual   直接在配置里写死一个价格表（兜底，永远可用）
//
// 聚合：同一干员+精英化取中位数，用 MAD 剔除离谱报价；样本不足 minSamples 时不覆盖旧价。
// 写回：只改 market_price 字段，走 PR，不直接推 master。

import { getAppConfig } from './appConfig.js';
import { resolveTarget, readFile, commitAndOpenPR } from './repoWrite.js';
import { getSession, qdRequest, pickReplayApis, sessionStatus } from './qiandao.js';

const BOX_FILE = 'Box_Id.json';

export function normElite(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (/^(2|E2|ELITE2|精二|精英2|精英二|精2)$/.test(s)) return 'ELITE2';
  if (/^(1|E1|ELITE1|精一|精英1|精英一|精1)$/.test(s)) return 'ELITE1';
  return eliteFromTitle(s);
}

// 从自由文本里认精英化。
// 早先这里是「含 2 就算精二」的懒判定，会把「阿米娅 精一 出 220」判成精二（2 来自价格），
// 所以改成只认明确的精一/精二标记，不再看裸数字。
export function eliteFromTitle(text) {
  const s = String(text || '');
  if (/精\s*[二贰2]|精英\s*[二贰2]|ELITE\s*[-_ ]?2|E2/i.test(s)) return 'ELITE2';
  if (/精\s*[一壹1]|精英\s*[一壹1]|ELITE\s*[-_ ]?1|E1/i.test(s)) return 'ELITE1';
  return null;
}

function getByPath(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const p of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

// 从任意结构的返回值里挖出报价样本
export function normalizeSamples(payload, mapping) {
  const map = mapping || {};
  let items = getByPath(payload, map.items || '');
  if (!Array.isArray(items)) {
    // 兜底：payload 本身是数组，或某个一级字段是数组
    if (Array.isArray(payload)) items = payload;
    else if (payload && typeof payload === 'object') {
      items = Object.values(payload).find(v => Array.isArray(v)) || [];
    } else items = [];
  }
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const name = String(getByPath(it, map.name || 'name') || '').trim();
    const price = toNumber(getByPath(it, map.price || 'price'));
    const elite = normElite(getByPath(it, map.elite || 'elite'));
    if (!name || !isFinite(price) || price <= 0) continue;
    const time = map.time ? (getByPath(it, map.time) || null) : null;
    out.push({ name, price, elite, raw: name, time });
  }
  return out;
}

// ── SPU 抽取（千岛 posts/by-tag-v4 的主路径）──────────────────────────────────
// 实测返回结构： data.posts[].labels[].spu = {
//   name: '塔露拉(精英二VER.)-通行认证56.0',
//   strikePrice: '39.27',      ← 市价（成交/划价）
//   minOnlinePrice: '41',      ← 目前最低在售
//   keyProfilesText: '通行认证56.0 / 塔露拉 / 明日方舟 / 挂件'
// }
// 这比从帖子正文里猜价格靠谱得多：商品名自带精英化标记，价格是平台算好的。
//
// 命名规则：「XX-通行认证56.0」是精英一版本，「XX(精英二VER.)-通行认证56.0」是精英二版本。
// 注意同一条帖子会带多个 SPU，多条帖子也会引用同一个 SPU，所以要按 SPU 维度去重。

export function parseSpuName(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let name = s;
  let series = '';
  // 最后一个连字符后面是系列名（通行认证56.0 这类）
  const m = s.match(/^(.+)[-－—]([^-－—]+)$/);
  if (m) { name = m[1].trim(); series = m[2].trim(); }
  let elite = 'ELITE1';   // 通行认证：裸名是精英一
  const e = name.match(/[（(]\s*精英\s*([二一2壹])\s*VER\.?\s*[）)]/i);
  if (e) {
    elite = /[二2壹]/.test(e[1]) ? 'ELITE2' : 'ELITE1';
    name = name.replace(e[0], '').trim();
  }
  return name ? { name, elite, series } : null;
}

function isSpuLike(o) {
  return o && typeof o === 'object' && typeof o.name === 'string' &&
    (o.strikePrice != null || o.minOnlinePrice != null);
}

export function extractSpuRecords(payload, opts) {
  const o = opts || {};
  const priceField = o.priceField === 'minOnlinePrice' ? 'minOnlinePrice' : 'strikePrice';
  const altField = priceField === 'strikePrice' ? 'minOnlinePrice' : 'strikePrice';
  const seriesFilter = String(o.seriesFilter || '').trim();
  const byKey = new Map();

  const visit = (node, depth) => {
    if (depth > 9 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const it of node) visit(it, depth + 1); return; }
    if (isSpuLike(node)) addOne(node);
    for (const k of Object.keys(node)) visit(node[k], depth + 1);
  };

  function addOne(spu) {
    const parsed = parseSpuName(spu.name);
    if (!parsed) return;
    if (seriesFilter && !parsed.series.includes(seriesFilter)) return;
    const price = toNumber(spu[priceField]);
    const alt = toNumber(spu[altField]);
    if (!isFinite(price) || price <= 0) return;
    const key = String(spu.id || (parsed.name + '|' + parsed.elite));
    if (byKey.has(key)) { byKey.get(key).count++; return; }
    byKey.set(key, {
      name: parsed.name,
      elite: parsed.elite,
      series: parsed.series,
      price,
      online: isFinite(alt) ? alt : null,
      spuId: spu.id ? String(spu.id) : null,
      title: String(spu.name),
      count: 1,
      source: 'spu',
    });
  }

  visit(payload, 0);
  return Array.from(byKey.values());
}

// ── 通用抽取（兜底：接口换形状 / 帖子正文里写价格时）──────────────────────────
// 千岛的接口字段名不可控（posts 里字段还嵌在 label/spu 里），
// 与其死守一套 mapping，不如把「数组里的对象」全扫一遍，按字段名语义认标题和价格。
// public/qiandao-collector.js 里有一份同样的实现（浏览器里跑，不能 import）。
const TITLE_KEY = /^(title|content|name|goods_?name|item_?name|desc|description|text|subject|rawContent)$/i;
const PRICE_KEY = /(price|amount|money|fee|成交|售价|价格|标价)/i;
const HREF_KEY = /^(url|href|link|jump_?url|share_?url|path)$/i;

function collectArrays(node, out, depth) {
  if (depth > 6 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    if (node.length && node.some(x => x && typeof x === 'object')) out.push(node);
    for (const it of node.slice(0, 200)) collectArrays(it, out, depth + 1);
    return;
  }
  for (const k of Object.keys(node)) collectArrays(node[k], out, depth + 1);
}

function deepFind(obj, matcher, depth) {
  if (!obj || typeof obj !== 'object' || depth > 2) return null;
  // 先看本层字段名，标题字段优先
  const keys = Object.keys(obj);
  const hits = keys.filter(k => matcher.key.test(k));
  hits.sort((a, b) => (matcher.pri ? matcher.pri(a) - matcher.pri(b) : 0));
  for (const k of hits) {
    const v = matcher.pick(obj[k]);
    if (v != null) return v;
  }
  for (const k of keys) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const got = deepFind(v, matcher, depth + 1);
      if (got != null) return got;
    }
  }
  return null;
}

function priceOf(v) {
  if (typeof v === 'number') return isFinite(v) && v > 0 && v < 1e7 ? v : null;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/(\d+(\.\d+)?)/);
    if (!m) return null;
    const n = Number(m[1]);
    return isFinite(n) && n > 0 && n < 1e7 ? n : null;
  }
  if (v && typeof v === 'object') {
    // {value: 120} / {amount: 120} / {cent: 12000}
    for (const k of ['value', 'amount', 'price', 'cent', 'fen']) {
      if (v[k] != null) {
        const n = priceOf(v[k]);
        if (n != null) return /cent|fen/i.test(k) ? Math.round(n / 100) : n;
      }
    }
  }
  return null;
}

export function extractRecords(payload, opts) {
  // 先走 SPU：有 strikePrice/minOnlinePrice 就直接用平台算好的价
  const spu = extractSpuRecords(payload, opts);
  if (spu.length) return spu;

  const arrays = [];
  collectArrays(payload, arrays, 0);
  const out = [];
  const seen = new Set();
  for (const arr of arrays) {
    for (const it of arr) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
      const title = deepFind(it, {
        key: TITLE_KEY,
        pri: k => (/^title$/i.test(k) ? 0 : /^(content|name)$/i.test(k) ? 1 : 2),
        pick: v => (typeof v === 'string' && v.trim().length >= 2 && v.length <= 300 ? v.trim() : null),
      }, 0);
      if (!title) continue;
      const price = deepFind(it, {
        key: PRICE_KEY,
        pick: priceOf,
      }, 0);
      if (price == null) continue;
      const href = deepFind(it, { key: HREF_KEY, pick: v => (typeof v === 'string' && /^https?:|^\//.test(v) ? v : null) }, 0);
      const key = title + '|' + price;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: null, title, price, elite: eliteFromTitle(title), href: href || null, source: 'text' });
      if (out.length >= 5000) return out;
    }
  }
  return out;
}

const PASS_RE = /通行证|通行|pass/i;

// 千岛岛内卡片流里混着大量非通行证内容（徽章、立牌、挂件…），
// 默认只留标题里带「通行证」的，避免「阿米娅 立牌 50」被当成通行证价。
export function filterRecords(records, opts) {
  const o = opts || {};
  const needPass = o.requirePassKeyword !== false;
  const needElite = o.requireElite !== false;
  let list = records;
  if (needPass) list = list.filter(r => PASS_RE.test(r.title));
  if (needElite) list = list.filter(r => !!r.elite);
  return list;
}

// 干员名匹配：行情标题通常是「明日方舟 通行证 阿米娅 精二 出」，按包含关系匹配
export function buildNameIndex(boxes) {
  const index = [];
  for (const b of boxes) {
    for (let i = 1; i <= 10; i++) {
      const c = b['character' + i];
      if (!c || !c.name) continue;
      index.push({ name: String(c.name), boxId: b.Box_id, slot: i });
    }
  }
  // 长名优先，避免「阿米娅」抢先匹配「阿米娅(近卫)」这类
  index.sort((a, b) => b.name.length - a.name.length);
  return index;
}

export function matchName(text, index) {
  const t = String(text || '');
  if (!t) return null;
  for (const rec of index) if (t.includes(rec.name)) return rec;
  return null;
}

export function median(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  if (!n) return null;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

// 千岛的市价是带小数的（strikePrice: "39.27" / "6.05"），整数化会把 6.05 变成 6、
// 1.69 变成 2，低价位商品误差过大，所以保留两位小数。
export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

// 中位数 + MAD 去极值；返回 { price, used, dropped }
export function robustPrice(values, madK) {
  const vals = values.filter(v => isFinite(v) && v > 0);
  if (!vals.length) return { price: null, used: 0, dropped: 0 };
  const med = median(vals);
  const dev = vals.map(v => Math.abs(v - med));
  const mad = median(dev) || 0;
  const k = madK == null ? 3 : madK;
  const limit = mad * 1.4826 * k;
  const kept = limit > 0 ? vals.filter(v => Math.abs(v - med) <= limit) : vals;
  return { price: round2(median(kept)), used: kept.length, dropped: vals.length - kept.length };
}

export async function fetchJson(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { ...(init || {}), signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 200) };
    try { return { ok: true, json: JSON.parse(text) }; }
    catch (e) { return { ok: false, status: res.status, error: '返回不是 JSON: ' + text.slice(0, 160) }; }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '请求超时' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// 千岛采集：
//   ① 有会话（浏览器控制台抓的 bundle）→ 重放里面记录的真实接口，拿最新数据
//   ② 重放被 WAF/限流挡住 → 退回 bundle 里当次抓到的原始记录（至少能用，但会标注 stale）
//   ③ 没有会话 → 用老路子：手填 endpoint + headers（多数情况下会被 WAF 挡，仅作兜底）
export async function fetchQiandao(cfg, index, env) {
  const q = (cfg && cfg.qiandao) || {};
  const session = env ? await getSession(env) : null;

  if (session) {
    const status = sessionStatus(session);
    const apis = pickReplayApis(session, 2);
    const records = [];
    const errors = [];

    for (const a of apis) {
      const r = await qdRequest(session, { url: a.url, method: a.method, body: a.body, headers: a.headers });
      if (!r.ok) { errors.push(a.url.replace(/^https?:\/\/[^/]+/, '') + ': ' + r.error); continue; }
      const got = extractRecords(r.json, { priceField: q.priceField, seriesFilter: q.seriesFilter });
      if (got.length) records.push(...got);
      // 一个接口拿到足够多的样本就不再打第二个，避免触发限流
      if (records.length >= 200) break;
    }

    if (records.length) {
      return { ok: true, records, samples: [], errors, source: 'session-replay', session: status };
    }

    // 重放全都失败：用这次抓取时存下来的记录
    if ((session.samples || []).length) {
      return {
        ok: true,
        records: session.samples.map(s => ({
          name: s.name || null,
          title: s.title,
          price: s.price,
          elite: s.elite || eliteFromTitle(s.title),
          series: s.series || '',
          online: s.online == null ? null : s.online,
          href: s.href || null,
        })),
        errors,
        source: 'session-cache',
        stale: true,
        session: status,
        hint: '服务端重放失败（' + (errors[0] || '原因未知') + '），这次用的是你上次在浏览器里抓到的快照。想要最新价就重新抓一次。',
      };
    }

    return {
      ok: false,
      records: [], samples: [], errors, source: 'session',
      session: status,
      error: errors[0] || '会话里的接口重放失败',
      hint: '回千岛页面重新执行一次采集脚本，把新的 bundle 粘回来。',
    };
  }

  if (!q.endpoint) {
    return {
      ok: false, records: [], samples: [], source: 'none',
      error: '还没接入千岛',
      hint: '在「千岛接入」里复制采集脚本，到 qiandao.com 的明日方舟岛执行，把结果粘回来即可。不需要填接口地址。',
    };
  }

  const mapping = q.mapping || {};
  const headers = Object.assign({ Accept: 'application/json' }, q.headers || {});
  const method = (q.method || 'POST').toUpperCase();
  const mode = q.mode || 'feed';
  const maxPages = Math.min(Number(q.maxPages || 5), 20);
  const samples = [];
  const errors = [];

  if (mode === 'search') {
    // 按干员名搜：只取索引里去重后的名字，最多 maxRequests 个，避免把接口打爆
    const names = Array.from(new Set(index.map(i => i.name))).slice(0, Math.min(Number(q.maxRequests || 60), 200));
    for (const name of names) {
      const kw = String(q.keyword || '{name}').replace('{name}', name);
      let url = q.endpoint;
      let bodyText = q.body || '';
      if (method === 'GET') {
        url = url.replace('{keyword}', encodeURIComponent(kw)) + (url.includes('?') ? '&' : '?') + 'kw=' + encodeURIComponent(kw);
      } else {
        bodyText = bodyText.replace(/\{keyword\}/g, kw);
      }
      const r = await fetchJson(url, { method, headers, body: method === 'GET' ? undefined : bodyText });
      if (!r.ok) { errors.push(name + ': ' + r.error); continue; }
      samples.push(...normalizeSamples(r.json, mapping));
    }
  } else {
    for (let page = 1; page <= maxPages; page++) {
      let url = q.endpoint.replace('{page}', String(page));
      let bodyText = (q.body || '').replace(/\{page\}/g, String(page));
      const r = await fetchJson(url, { method, headers, body: method === 'GET' ? undefined : bodyText });
      if (!r.ok) { errors.push('page' + page + ': ' + r.error); break; }
      const got = normalizeSamples(r.json, mapping);
      if (!got.length) break;
      samples.push(...got);
      if (!(q.body || '').includes('{page}') && !q.endpoint.includes('{page}')) break;
    }
  }

  return { ok: samples.length > 0, samples, records: [], errors, source: 'endpoint' };
}

// 把样本聚合成 { 干员名: { ELITE1, ELITE2 } }，并按需折算缺失的精英化
// 把"商品标题"解析成"干员名 + 精英化"。
// 千岛/二手市场的标题通常是「明日方舟 通行证 阿米娅 精二 出」，这里按干员名做包含匹配，
// 精英化优先取字段，字段缺失时从标题里认 精一/精二。
export function resolveSamples(samples, index) {
  const out = [];
  const unmatched = [];
  // SPU 名已经是干净的干员名，先按精确名查一遍，命中就不用做包含匹配（避免「阿米娅」吃掉「阿米娅(近卫)」）
  const exact = new Map();
  for (const rec of index) if (!exact.has(rec.name)) exact.set(rec.name, rec);

  for (const s of samples) {
    const text = s.title || s.raw || s.name || '';
    const hit = (s.name && exact.get(s.name)) || matchName(text, index);
    if (!hit) { unmatched.push(String(text).slice(0, 80)); continue; }
    const elite = s.elite || eliteFromTitle(text);
    if (!elite) { unmatched.push(String(text).slice(0, 80)); continue; }
    out.push({ name: hit.name, price: s.price, elite, time: s.time || null });
  }
  return { samples: out, unmatched: unmatched.slice(0, 20), unmatchedCount: unmatched.length };
}

export function aggregate(samples, opts) {
  const o = opts || {};
  const minSamples = Number(o.minSamples || 3);
  const madK = Number(o.outlierMad || 3);
  const ratio = Number(o.elite1Ratio || 0.72);
  const byKey = {};
  for (const s of samples) {
    if (!s.elite) continue;
    const k = s.name + '|' + s.elite;
    (byKey[k] = byKey[k] || []).push(s.price);
  }
  const prices = {};
  const stats = [];
  for (const k of Object.keys(byKey)) {
    const [name, elite] = k.split('|');
    const r = robustPrice(byKey[k], madK);
    if (r.price == null) continue;
    if (r.used < minSamples) { stats.push({ name, elite, skipped: true, used: r.used, minSamples }); continue; }
    prices[name] = prices[name] || {};
    prices[name][elite] = r.price;
    stats.push({ name, elite, price: r.price, used: r.used, dropped: r.dropped });
  }
  // 只有精二时补精一（反之亦然）——默认关闭：用比例推算出来的价不是真实行情，
  // 想启用就在配置里打开 deriveMissing。
  for (const name of (o.deriveMissing ? Object.keys(prices) : [])) {
    const p = prices[name];
    if (p.ELITE2 && !p.ELITE1) { p.ELITE1 = round2(p.ELITE2 * ratio); stats.push({ name, elite: 'ELITE1', price: p.ELITE1, derived: true }); }
    if (p.ELITE1 && !p.ELITE2) { p.ELITE2 = round2(p.ELITE1 / ratio); stats.push({ name, elite: 'ELITE2', price: p.ELITE2, derived: true }); }
  }
  return { prices, stats };
}

// ── 市价核对时间 ─────────────────────────────────────────────────────────
// 只记一条总记录：仓库根目录的 Price_Meta.json
//   { "market_priceUpdateTime": "2026-11-18T05:36:00.000Z", "boxes": 95, "records": 1234 }
//
// 为什么不按盒号记：一轮抓取是全量覆盖，95 个盒子写的是同一个时间，
// 只让 Box_Id.json 多出 95 行噪声、每月 PR diff 变得没法看，信息量还是那一个时间点。
//
// 月度节奏由它决定：抓取前先读这个文件，只有超过 refreshDays 才值得采一轮。
// 兼容老数据：文件不存在时，退回读 Box_Id.json 里盒级的 market_priceUpdateTime
// （之前那一版就是这么记的），所以历史 PR 留着也不会失效。
export const PRICE_TIME_FIELD = 'market_priceUpdateTime';
export const PRICE_META_FILE = 'Price_Meta.json';

// 兼容历史/手写变体，读的时候全都认；写的时候统一用 PRICE_TIME_FIELD
const PRICE_TIME_ALIASES = [
  PRICE_TIME_FIELD, 'market_priceUpdatetime', 'market_price_update_time', 'marketPriceUpdateTime',
];

function pickTime(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of PRICE_TIME_ALIASES) {
    const v = obj[k];
    if (v == null || v === '') continue;
    const t = typeof v === 'number' ? v : Date.parse(String(v));
    if (!isFinite(t)) continue;
    return { raw: v, at: t, iso: new Date(t).toISOString() };
  }
  return null;
}

// 兼容旧签名：从单个盒子对象上取时间（文件级 meta 也走同一个函数）
export function readPriceTime(obj) {
  return pickTime(obj);
}

// 组装要写盘的那一条记录
export function buildPriceMeta(opts) {
  const o = opts || {};
  const at = o.at ? new Date(Date.parse(o.at) || Date.now()).toISOString() : new Date().toISOString();
  return {
    _comment: '市价整轮核对记录。只保留这一条总记录，不要按盒号分散写进 Box_Id.json。',
    [PRICE_TIME_FIELD]: at,
    updatedBy: o.by || 'qiandao',
    boxes: o.boxes == null ? null : Number(o.boxes),
    records: o.records == null ? null : Number(o.records),
    characters: o.characters == null ? null : Number(o.characters),
    note: o.note || null,
  };
}

function boxHasPrice(box) {
  for (let i = 1; i <= 10; i++) {
    const c = box['character' + i];
    const mp = c && c.market_price;
    if (!mp) continue;
    if (mp.ELITE1 != null && isFinite(Number(mp.ELITE1))) return true;
    if (mp.ELITE2 != null && isFinite(Number(mp.ELITE2))) return true;
  }
  return false;
}

/**
 * 这份数据新不新鲜。第一个参数可以是两种东西：
 *   - Price_Meta.json 的内容（对象，一条总记录）→ 最准，也是现在的唯一写入口
 *   - Box_Id.json 的盒子数组 → 兼容上一版按盒号记的时间戳（取其中最新的一条）
 *
 * 口径取「最新」而不是「最旧」：一轮抓取是全量覆盖，跑完只会有一个时间点；
 * 用最新值判断既满足「一月一轮」，也不会因为冷门盒永远匹配不到样本而每半小时重开一轮。
 */
export function priceFreshness(source, refreshDays, now) {
  const ts = now || Date.now();
  const days = Number(refreshDays) > 0 ? Number(refreshDays) : 30;
  let newest = 0;
  let oldest = 0;
  let missing = 0;
  let withPrice = 0;
  let mode = 'meta';

  if (Array.isArray(source)) {
    mode = 'legacy-boxes';
    for (const b of source) {
      if (!boxHasPrice(b)) continue;
      withPrice++;
      const t = readPriceTime(b);
      if (!t) { missing++; continue; }
      if (!newest || t.at > newest) newest = t.at;
      if (!oldest || t.at < oldest) oldest = t.at;
    }
  } else {
    const t = pickTime(source);
    if (t) { newest = t.at; oldest = t.at; }
  }

  const ageDays = newest ? (ts - newest) / 86400000 : null;
  const fresh = !!newest && ageDays < days;
  return {
    field: PRICE_TIME_FIELD,
    file: mode === 'meta' ? PRICE_META_FILE : 'Box_Id.json',
    mode,                                        // meta = 一条总记录；legacy-boxes = 旧的按盒号记
    boxes: mode === 'meta' ? (source && source.boxes != null ? Number(source.boxes) : null) : source.length,
    withPrice: mode === 'meta' ? null : withPrice,
    stamped: mode === 'meta' ? (newest ? 1 : 0) : (withPrice - missing),
    missing: mode === 'meta' ? (newest ? 0 : 1) : missing,
    newestAt: newest ? new Date(newest).toISOString() : null,
    oldestAt: oldest ? new Date(oldest).toISOString() : null,
    ageDays: ageDays == null ? null : Math.round(ageDays * 10) / 10,
    refreshDays: days,
    fresh,
    nextRunAt: newest ? new Date(newest + days * 86400000).toISOString() : null,
    reason: fresh
      ? `市价最近一次整轮核对是 ${Math.floor(ageDays)} 天前，未满 ${days} 天`
      : (newest
        ? `市价最近一次整轮核对是 ${Math.floor(ageDays)} 天前，已过 ${days} 天周期`
        : (mode === 'meta'
          ? `${PRICE_META_FILE} 里还没有核对时间，需要采一轮`
          : '还没有市价核对时间，需要采一轮')),
  };
}

// 计算写回差异
export function diffBoxes(boxes, prices) {
  const diffs = [];
  for (const b of boxes) {
    for (let i = 1; i <= 10; i++) {
      const c = b['character' + i];
      if (!c || !c.name) continue;
      const p = prices[c.name];
      if (!p) continue;
      const cur = c.market_price || {};
      const next = {};
      let changed = false;
      for (const elite of ['ELITE1', 'ELITE2']) {
        if (p[elite] == null) { if (cur[elite] != null) next[elite] = cur[elite]; continue; }
        next[elite] = p[elite];
        if (Number(cur[elite]) !== Number(p[elite])) {
          changed = true;
          diffs.push({ boxId: b.Box_id, slot: i, name: c.name, elite, from: cur[elite] == null ? null : Number(cur[elite]), to: p[elite] });
        }
      }
      if (changed) c.market_price = next;
    }
  }
  return diffs;
}

export async function loadBoxes(cfg, token, source, explicitTarget, base) {
  const target = resolveTarget(cfg, source, explicitTarget);
  const ref = base || target.branch || 'main';
  const file = await readFile(target, token, BOX_FILE, ref);
  if (!file) throw new Error(`目标仓库(${target.kind}/${target.owner}/${target.repo}) 里找不到 ${BOX_FILE}`);
  let boxes;
  try { boxes = JSON.parse(file.text); } catch (e) { throw new Error('Box_Id.json 解析失败'); }
  if (!Array.isArray(boxes)) throw new Error('Box_Id.json 不是数组');
  const refreshDays = ((cfg && cfg.prices && cfg.prices.crawl) || {}).refreshDays;

  // 时间只认一条总记录：Price_Meta.json。
  // 读不到（还没建过这个文件）就退回盒级时间戳——上一版是那么记的，历史数据照样能用。
  let meta = null;
  let metaFile = null;
  try {
    metaFile = await readFile(target, token, PRICE_META_FILE, ref);
    if (metaFile && metaFile.text) meta = JSON.parse(metaFile.text);
  } catch (e) { meta = null; }

  const freshness = meta ? priceFreshness(meta, refreshDays) : priceFreshness(boxes, refreshDays);
  return { target, ref, file, boxes, meta, metaFile, freshness };
}

/**
 * 写回 Box_Id.json（可选）+ Price_Meta.json 并开 PR。
 * 时间戳不再进 Box_Id.json：整轮核对只写一条总记录，跟着价格在同一个 PR 里提交。
 * @param {object} [opts] { at?, by?, records?, characters?, metaFile?, touchMeta?: boolean }
 */
export async function writeBoxes(cfg, token, source, explicitTarget, base, boxes, file, diffs, title, opts) {
  const target = resolveTarget(cfg, source, explicitTarget);
  const ref = base || target.branch || 'main';
  const o = opts || {};
  const files = [{ path: BOX_FILE, content: JSON.stringify(boxes, null, 2), sha: file.sha }];
  let meta = null;
  if (o.touchMeta !== false) {
    meta = buildPriceMeta({
      at: o.at, by: o.by, boxes: boxes.length,
      records: o.records, characters: o.characters, note: o.note,
    });
    files.push({
      path: PRICE_META_FILE,
      content: JSON.stringify(meta, null, 2) + '\n',
      sha: (o.metaFile && o.metaFile.sha) || undefined,   // 没有 = 新建文件
    });
  }
  const lines = diffs.slice(0, 80).map(d => `- ${d.boxId} ${d.name} ${d.elite}: ${d.from == null ? '∅' : d.from} → ${d.to}`);
  if (diffs.length > 80) lines.push(`- ...共 ${diffs.length} 条`);
  if (meta) {
    lines.push('', `本轮核对时间：\`${PRICE_META_FILE}\` → ${PRICE_TIME_FIELD} = ${meta[PRICE_TIME_FIELD]}`);
  }
  const pr = await commitAndOpenPR({
    target, token, base: ref,
    files,
    title: title || `chore(prices): 更新市价 (${diffs.length} 处)`,
    body: ['由市价同步自动生成。', '', ...lines].join('\n'),
    branchPrefix: 'prices',
  });
  return Object.assign({}, pr, { meta, metaAt: meta ? meta[PRICE_TIME_FIELD] : null });
}

// 只写那条总记录（回填核对时间用），不动 Box_Id.json —— 一个 diff、一行数字。
export async function writePriceMeta(cfg, token, source, explicitTarget, base, opts) {
  const target = resolveTarget(cfg, source, explicitTarget);
  const ref = base || target.branch || 'main';
  const o = opts || {};
  const meta = buildPriceMeta({ at: o.at, by: o.by || 'manual', boxes: o.boxes, records: o.records, note: o.note });
  const pr = await commitAndOpenPR({
    target, token, base: ref,
    files: [{
      path: PRICE_META_FILE,
      content: JSON.stringify(meta, null, 2) + '\n',
      sha: (o.metaFile && o.metaFile.sha) || undefined,
    }],
    title: o.title || `chore(prices): 记录市价核对时间 ${meta[PRICE_TIME_FIELD].slice(0, 10)}`,
    body: ['市价整轮核对时间只保留一条总记录。', '', `- ${PRICE_TIME_FIELD}: ${meta[PRICE_TIME_FIELD]}`].join('\n'),
    branchPrefix: 'prices-meta',
  });
  return Object.assign({}, pr, { meta, metaAt: meta[PRICE_TIME_FIELD] });
}

export { BOX_FILE };
