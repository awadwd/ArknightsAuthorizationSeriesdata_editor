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

const BOX_FILE = 'Box_Id.json';

export function normElite(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (/^(2|E2|ELITE2|精二|精英2|精英二|精2)$/.test(s)) return 'ELITE2';
  if (/^(1|E1|ELITE1|精一|精英1|精英一|精1)$/.test(s)) return 'ELITE1';
  if (s.includes('精二') || s.includes('2')) return 'ELITE2';
  if (s.includes('精一') || s.includes('1')) return 'ELITE1';
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
  return { price: Math.round(median(kept)), used: kept.length, dropped: vals.length - kept.length };
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

// 千岛抓取：feed 模式（拉一个分类/搜索列表，翻页）或 search 模式（按干员名逐个搜）
export async function fetchQiandao(cfg, index) {
  const q = (cfg && cfg.qiandao) || {};
  if (!q.endpoint) {
    return { ok: false, error: '未配置千岛接口地址', hint: '在「市价」页填入抓包得到的 endpoint / headers / 字段映射，或改用导入/手工模式' };
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

  return { ok: samples.length > 0, samples, errors };
}

// 把样本聚合成 { 干员名: { ELITE1, ELITE2 } }，并按需折算缺失的精英化
// 把"商品标题"解析成"干员名 + 精英化"。
// 千岛/二手市场的标题通常是「明日方舟 通行证 阿米娅 精二 出」，这里按干员名做包含匹配，
// 精英化优先取字段，字段缺失时从标题里认 精一/精二。
export function resolveSamples(samples, index) {
  const out = [];
  const unmatched = [];
  for (const s of samples) {
    const hit = matchName(s.raw || s.name, index);
    if (!hit) { unmatched.push(s.raw || s.name); continue; }
    const elite = s.elite || normElite(s.raw || s.name);
    if (!elite) { unmatched.push(s.raw || s.name); continue; }
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
    if (p.ELITE2 && !p.ELITE1) { p.ELITE1 = Math.round(p.ELITE2 * ratio); stats.push({ name, elite: 'ELITE1', price: p.ELITE1, derived: true }); }
    if (p.ELITE1 && !p.ELITE2) { p.ELITE2 = Math.round(p.ELITE1 / ratio); stats.push({ name, elite: 'ELITE2', price: p.ELITE2, derived: true }); }
  }
  return { prices, stats };
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
  return { target, ref, file, boxes };
}

export async function writeBoxes(cfg, token, source, explicitTarget, base, boxes, file, diffs, title) {
  const target = resolveTarget(cfg, source, explicitTarget);
  const ref = base || target.branch || 'main';
  const lines = diffs.slice(0, 80).map(d => `- ${d.boxId} ${d.name} ${d.elite}: ${d.from == null ? '∅' : d.from} → ${d.to}`);
  if (diffs.length > 80) lines.push(`- ...共 ${diffs.length} 条`);
  return await commitAndOpenPR({
    target, token, base: ref,
    files: [{ path: BOX_FILE, content: JSON.stringify(boxes, null, 2), sha: file.sha }],
    title: title || `chore(prices): 更新市价 (${diffs.length} 处)`,
    body: ['由市价同步自动生成。', '', ...lines].join('\n'),
    branchPrefix: 'prices',
  });
}

export { BOX_FILE };
