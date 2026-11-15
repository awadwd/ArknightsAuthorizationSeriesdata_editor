// 市价接口
//
// GET  /api/prices                 读当前 Box_Id.json 里的市价矩阵 + 数据源配置（脱敏）
// POST /api/prices                 { action }
//   action=preview    采集并返回涨跌预览（不写）
//   action=apply      采集 + 写回 Box_Id.json + 开 PR
//   action=samples    { samples:[{name,elite,price}] } 用外部数据（CSV 导入/别的脚本）
//   action=manual     { manual:{ 干员名:{ELITE1,ELITE2} } } 保存手工价并预览
//   action=save-config{ prices:{...} } 保存数据源配置（owner）
//
// 定时刷新：用 X-Sync-Token 打 POST /api/prices?action=apply，跟同步共用一个密码。

import { getAppConfig, saveAppConfig } from './_lib/appConfig.js';
import { verifyRequest } from './_lib/auth.js';
import { verifySyncRequest, syncCors } from './_lib/syncAuth.js';
import {
  loadBoxes, writeBoxes, fetchQiandao, aggregate, diffBoxes, buildNameIndex, normalizeSamples, resolveSamples,
} from './_lib/prices.js';

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: syncCors('GET, POST, OPTIONS') });
}

function maskHeaders(h) {
  const out = {};
  for (const k of Object.keys(h || {})) {
    const v = String(h[k] || '');
    out[k] = v.length > 12 ? v.slice(0, 4) + '***' + v.slice(-3) : '***';
  }
  return out;
}

function matrixOf(boxes) {
  const seen = {};
  const matrix = [];
  for (const b of boxes) {
    for (let i = 1; i <= 10; i++) {
      const c = b['character' + i];
      if (!c || !c.name) continue;
      const key = c.name;
      if (seen[key]) continue;
      seen[key] = true;
      const mp = c.market_price || {};
      matrix.push({ name: c.name, boxId: b.Box_id, ELITE1: mp.ELITE1 == null ? null : Number(mp.ELITE1), ELITE2: mp.ELITE2 == null ? null : Number(mp.ELITE2) });
    }
  }
  return matrix;
}

async function collect(cfg, boxes, body) {
  const pcfg = (cfg && cfg.prices) || {};
  const provider = (body && body.provider) || pcfg.provider || 'manual';
  const index = buildNameIndex(boxes);

  if (Array.isArray(body && body.samples) && body.samples.length) {
    return { provider: 'samples', samples: body.samples.map(s => ({ name: String(s.name || '').trim(), price: Number(s.price), elite: s.elite || null })) };
  }

  if (provider === 'manual') {
    const manual = (body && body.manual) || pcfg.manual || {};
    const samples = [];
    for (const name of Object.keys(manual)) {
      const v = manual[name] || {};
      if (v.ELITE1 != null) samples.push({ name, elite: 'ELITE1', price: Number(v.ELITE1) });
      if (v.ELITE2 != null) samples.push({ name, elite: 'ELITE2', price: Number(v.ELITE2) });
    }
    return { provider: 'manual', samples };
  }

  if (provider === 'import') {
    // 前端传了原始 payload，这里按映射解析（方便直接贴接口返回）
    const payload = body && body.payload;
    const mapping = (body && body.mapping) || (pcfg.qiandao && pcfg.qiandao.mapping) || {};
    const raw = normalizeSamples(payload, mapping);
    const r = resolveSamples(raw, index);
    return { provider: 'import', samples: r.samples, unmatched: r.unmatched, unmatchedCount: r.unmatchedCount };
  }

  if (provider === 'qiandao') {
    const r = await fetchQiandao(pcfg, index);
    if (!r.ok && !r.samples.length) return { provider: 'qiandao', samples: [], error: r.error, hint: r.hint, errors: r.errors };
    const resolved = resolveSamples(r.samples, index);
    return {
      provider: 'qiandao',
      samples: resolved.samples,
      unmatched: resolved.unmatched,
      unmatchedCount: resolved.unmatchedCount,
      errors: r.errors,
    };
  }

  return { provider, samples: [], error: '未知数据源: ' + provider };
}

export async function onRequestGet(context) {
  const auth = await verifyRequest(context.request);
  if (!auth) return json({ success: false, error: 'not authenticated' }, 401);
  if (!auth.isOwner) return json({ success: false, error: 'forbidden: only owner' }, 403);

  const cfg = await getAppConfig(context.env);
  const url = new URL(context.request.url);
  try {
    const { target, ref, boxes } = await loadBoxes(cfg, auth.token, auth.source, url.searchParams.get('target'), url.searchParams.get('base'));
    const pcfg = cfg.prices || {};
    return json({
      success: true,
      target: { kind: target.kind, owner: target.owner, repo: target.repo, base: ref },
      count: boxes.length,
      matrix: matrixOf(boxes),
      prices: {
        enabled: !!pcfg.enabled,
        provider: pcfg.provider || 'manual',
        minSamples: pcfg.minSamples,
        outlierMad: pcfg.outlierMad,
        elite1Ratio: pcfg.elite1Ratio,
        autoRefresh: !!pcfg.autoRefresh,
        refreshHours: pcfg.refreshHours,
        lastRunAt: pcfg.lastRunAt || null,
        endpoint: (pcfg.qiandao && pcfg.qiandao.endpoint) || '',
        method: (pcfg.qiandao && pcfg.qiandao.method) || 'POST',
        mode: (pcfg.qiandao && pcfg.qiandao.mode) || 'feed',
        mapping: (pcfg.qiandao && pcfg.qiandao.mapping) || {},
        headers: maskHeaders((pcfg.qiandao && pcfg.qiandao.headers) || {}),
        manual: pcfg.manual || {},
      },
    });
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'preview';

  const machineAuth = await verifySyncRequest(request, env);
  const ownerAuth = machineAuth && machineAuth.isOwner ? machineAuth : await verifyRequest(request);
  if (!ownerAuth) return json({ success: false, error: 'not authenticated' }, 401);
  if (!ownerAuth.isOwner) return json({ success: false, error: 'forbidden: only owner' }, 403);
  if (machineAuth && !machineAuth.machine) { /* 普通用户会话，继续 */ }

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  const cfg = await getAppConfig(env);

  // 只改配置，不动数据仓库
  if (action === 'save-config') {
    if (machineAuth && machineAuth.machine) return json({ success: false, error: '机器账号不能改配置' }, 403);
    const patch = (body && body.prices) || {};
    const merged = Object.assign({}, cfg.prices || {}, patch);
    // 请求头是敏感信息：留空表示"保持原值"，避免脱敏值被写回去
    if (patch.qiandao && Object.keys(patch.qiandao.headers || {}).length === 0) {
      merged.qiandao = Object.assign({}, (cfg.prices || {}).qiandao || {}, patch.qiandao, {
        headers: ((cfg.prices || {}).qiandao || {}).headers || {},
      });
    }
    try {
      await saveAppConfig(env, Object.assign({}, cfg, { prices: merged }));
      return json({ success: true });
    } catch (e) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  let loaded;
  try {
    loaded = await loadBoxes(cfg, ownerAuth.token, ownerAuth.source, body.target, body.base);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
  const { boxes, file, target, ref } = loaded;

  const got = await collect(cfg, boxes, body);
  if (!got.samples.length) {
    return json({ success: false, error: got.error || '没有采集到任何报价样本', hint: got.hint, errors: got.errors, provider: got.provider }, 200);
  }

  const pcfg = cfg.prices || {};
  const agg = aggregate(got.samples, {
    minSamples: body.minSamples || pcfg.minSamples,
    outlierMad: body.outlierMad || pcfg.outlierMad,
    elite1Ratio: body.elite1Ratio || pcfg.elite1Ratio,
    deriveMissing: body.deriveMissing != null ? !!body.deriveMissing : !!pcfg.deriveMissing,
  });

  // 预览阶段复制一份，避免改动原始对象（apply 时才真正改）
  const working = JSON.parse(JSON.stringify(boxes));
  const diffs = diffBoxes(working, agg.prices);

  const summary = {
    provider: got.provider,
    samples: got.samples.length,
    matchedCharacters: Object.keys(agg.prices).length,
    diffs: diffs.length,
    stats: agg.stats.slice(0, 200),
    errors: got.errors || [],
    unmatchedCount: got.unmatchedCount || 0,
    unmatched: got.unmatched || [],
    target: { kind: target.kind, owner: target.owner, repo: target.repo, base: ref },
  };

  if (action === 'preview' || action === 'samples' || action === 'manual') {
    // samples/manual 只用于预览，写回前需要显式 apply
    return json({ success: true, ...summary, list: diffs.slice(0, 300) });
  }

  if (action !== 'apply') return json({ success: false, error: '未知 action: ' + action }, 400);

  if (!diffs.length) {
    return json({ success: true, ...summary, changed: false, message: '市价没有变化，未创建 PR' });
  }

  try {
    const pr = await writeBoxes(cfg, ownerAuth.token, ownerAuth.source, body.target, body.base, working, file, diffs,
      `chore(prices): 更新市价 (${diffs.length} 处) @ ${new Date().toISOString()}`);
    try {
      await saveAppConfig(env, Object.assign({}, cfg, {
        prices: Object.assign({}, cfg.prices || {}, { lastRunAt: new Date().toISOString(), lastResult: { ...summary, prUrl: pr.url, count: diffs.length } }),
      }));
    } catch (e) {}
    return json({ success: true, ...summary, changed: true, prUrl: pr.url, prNumber: pr.number });
  } catch (e) {
    return json({ success: false, error: e.message, ...summary }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: syncCors('GET, POST, OPTIONS') });
}
