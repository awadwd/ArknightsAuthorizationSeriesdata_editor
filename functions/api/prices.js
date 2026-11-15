// 市价接口
//
// GET  /api/prices                 读当前 Box_Id.json 里的市价矩阵 + 数据源配置（脱敏）
// POST /api/prices                 { action }
//   action=preview       采集并返回涨跌预览（不写）
//   action=apply         采集 + 写回 Box_Id.json + 开 PR
//   action=samples       { samples:[{name,elite,price}] } 用外部数据（CSV 导入/别的脚本）
//   action=manual        { manual:{ 干员名:{ELITE1,ELITE2} } } 保存手工价并预览
//   action=save-config   { prices:{...} } 保存数据源配置（owner）
//   action=save-session  { bundle }       保存浏览器控制台抓到的千岛会话（owner）
//   action=session-test  用会话重放一次，看能不能拿到数据
//   action=clear-session 清掉会话
//
// 定时刷新：用 X-Sync-Token 打 POST /api/prices?action=apply，跟同步共用一个密码。

import { getAppConfig, saveAppConfig } from './_lib/appConfig.js';
import { verifyRequest } from './_lib/auth.js';
import { verifySyncRequest, syncCors } from './_lib/syncAuth.js';
import {
  loadBoxes, writeBoxes, fetchQiandao, aggregate, diffBoxes, buildNameIndex, normalizeSamples,
  resolveSamples, filterRecords, extractRecords, eliteFromTitle,
} from './_lib/prices.js';
import { saveSession, getSession, clearSession, sessionStatus, qdRequest, pickReplayApis } from './_lib/qiandao.js';
import { getJob, saveJob, resetJob, runStep, jobSummary } from './_lib/crawl.js';

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

// 用抓取任务攒下来的记录（而不是现抓一次）算样本
async function fromCrawl(env, cfg, boxes, body) {
  const job = await getJob(env);
  if (!job || !(job.records || []).length) {
    return {
      provider: 'crawl', samples: [], source: 'crawl',
      error: '抓取任务还没有数据',
      hint: '在「自动抓取」里点「立即继续」，等它至少抓完一页再回来。',
    };
  }
  const pcfg = cfg.prices || {};
  const index = buildNameIndex(boxes);
  const requirePass = body && body.requirePassKeyword != null
    ? !!body.requirePassKeyword
    : pcfg.requirePassKeyword !== false;
  let picked = filterRecords(job.records, { requirePassKeyword: requirePass, requireElite: true });
  let relaxed = false;
  if (!picked.length) {
    picked = filterRecords(job.records, { requirePassKeyword: false, requireElite: true });
    relaxed = picked.length > 0;
  }
  const resolved = resolveSamples(picked, index);
  return {
    provider: 'qiandao',
    source: 'crawl',
    samples: resolved.samples,
    unmatched: resolved.unmatched,
    unmatchedCount: resolved.unmatchedCount,
    recordsCount: job.records.length,
    filteredCount: picked.length,
    relaxedKeyword: relaxed,
    crawlPhase: job.phase,
    crawlPage: job.page,
  };
}

async function collect(cfg, boxes, body, env) {
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
    const r = await fetchQiandao(pcfg, index, env);
    const meta = {
      source: r.source || null,
      stale: !!r.stale,
      session: r.session || null,
      hint: r.hint || null,
      errors: r.errors || [],
    };

    // 新路径：拿到的是原始卡片记录（标题+价格），交给通用匹配
    if (r.records && r.records.length) {
      const requirePass = body && body.requirePassKeyword != null
        ? !!body.requirePassKeyword
        : pcfg.requirePassKeyword !== false;
      let picked = filterRecords(r.records, { requirePassKeyword: requirePass, requireElite: true });
      // 挂上「通行证」过滤后一条都不剩，说明这岛的分类粒度不到标题，退一步放宽
      let relaxed = false;
      if (!picked.length && r.records.length) {
        picked = filterRecords(r.records, { requirePassKeyword: false, requireElite: true });
        relaxed = picked.length > 0;
      }
      const resolved = resolveSamples(picked, index);
      return {
        provider: 'qiandao', ...meta,
        samples: resolved.samples,
        unmatched: resolved.unmatched,
        unmatchedCount: resolved.unmatchedCount,
        recordsCount: r.records.length,
        filteredCount: picked.length,
        relaxedKeyword: relaxed,
      };
    }

    // 老路径：手填 endpoint 的 mapping 结果
    if (!r.ok && !r.samples.length) {
      return { provider: 'qiandao', samples: [], error: r.error, hint: r.hint, errors: r.errors, ...meta };
    }
    const resolved = resolveSamples(r.samples, index);
    return {
      provider: 'qiandao', ...meta,
      samples: resolved.samples,
      unmatched: resolved.unmatched,
      unmatchedCount: resolved.unmatchedCount,
      recordsCount: r.samples.length,
      filteredCount: r.samples.length,
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
  const session = await getSession(context.env);
  const job = await getJob(context.env);
  try {
    const { target, ref, boxes } = await loadBoxes(cfg, auth.token, auth.source, url.searchParams.get('target'), url.searchParams.get('base'));
    const pcfg = cfg.prices || {};
    return json({
      success: true,
      target: { kind: target.kind, owner: target.owner, repo: target.repo, base: ref },
      count: boxes.length,
      matrix: matrixOf(boxes),
      session: sessionStatus(session),
      crawl: jobSummary(job, pcfg),
      prices: {
        enabled: !!pcfg.enabled,
        provider: pcfg.provider || 'manual',
        minSamples: pcfg.minSamples,
        outlierMad: pcfg.outlierMad,
        elite1Ratio: pcfg.elite1Ratio,
        requirePassKeyword: pcfg.requirePassKeyword !== false,
        autoRefresh: !!pcfg.autoRefresh,
        refreshHours: pcfg.refreshHours,
        lastRunAt: pcfg.lastRunAt || null,
        islandId: (pcfg.qiandao && pcfg.qiandao.islandId) || '300569',
        endpoint: (pcfg.qiandao && pcfg.qiandao.endpoint) || '',
        method: (pcfg.qiandao && pcfg.qiandao.method) || 'POST',
        mode: (pcfg.qiandao && pcfg.qiandao.mode) || 'feed',
        priceField: (pcfg.qiandao && pcfg.qiandao.priceField) || 'strikePrice',
        seriesFilter: (pcfg.qiandao && pcfg.qiandao.seriesFilter) || '',
        mapping: (pcfg.qiandao && pcfg.qiandao.mapping) || {},
        headers: maskHeaders((pcfg.qiandao && pcfg.qiandao.headers) || {}),
        manual: pcfg.manual || {},
      },
    });
  } catch (e) {
    return json({ success: false, error: e.message, session: sessionStatus(session) }, 500);
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

  // ── 千岛会话（浏览器控制台抓到的 cookie + 接口）────────────────────────────
  if (action === 'save-session') {
    if (machineAuth && machineAuth.machine) return json({ success: false, error: '机器账号不能改会话' }, 403);
    try {
      const bundle = await saveSession(env, body.bundle || body);
      const status = sessionStatus(bundle);
      // 顺手报一下「这份数据能不能用」，省得用户点进去才发现匹配不到
      const samplePreview = bundle.samples.slice(0, 5);
      const withElite = bundle.samples.filter(s => s.elite || eliteFromTitle(s.title)).length;
      const withPass = bundle.samples.filter(s => /通行证|通行|pass/i.test(s.title)).length;
      return json({
        success: true,
        session: status,
        detected: {
          samples: bundle.samples.length,
          withElite,
          withPass,
          apis: bundle.apis.length,
          preview: samplePreview,
          apisPreview: bundle.apis.slice(0, 8).map(a => ({ method: a.method, url: a.url.replace(/^https?:\/\/[^/]+/, ''), status: a.status })),
        },
        note: bundle.samples.length === 0
          ? '只存了 cookie 和接口，没有抓到行情记录。服务端会尝试重放接口；如果被拦，回页面多翻几页再抓一次。'
          : null,
      });
    } catch (e) {
      return json({ success: false, error: e.message }, 400);
    }
  }

  if (action === 'clear-session') {
    if (machineAuth && machineAuth.machine) return json({ success: false, error: '机器账号不能改会话' }, 403);
    await clearSession(env);
    return json({ success: true });
  }

  if (action === 'session-test') {
    const s = await getSession(env);
    if (!s) return json({ success: false, error: '还没有会话，先去千岛抓一次' }, 200);
    const apis = pickReplayApis(s, 3);
    if (!apis.length) {
      return json({ success: false, session: sessionStatus(s), error: '会话里没有可用接口（只有样本），无法测试直连', hasSamples: (s.samples || []).length > 0 }, 200);
    }
    const results = [];
    for (const a of apis) {
      const r = await qdRequest(s, { url: a.url, method: a.method, body: a.body, headers: a.headers });
      if (!r.ok) { results.push({ url: a.url.replace(/^https?:\/\/[^/]+/, ''), ok: false, error: r.error }); continue; }
      const recs = extractRecords(r.json);
      results.push({ url: a.url.replace(/^https?:\/\/[^/]+/, ''), ok: true, records: recs.length, preview: recs.slice(0, 3) });
      if (recs.length) break;
    }
    const ok = results.some(x => x.ok && x.records > 0);
    return json({ success: ok, ok, session: sessionStatus(s), results }, 200);
  }

  // ── 抓取任务：慢速分页 + 退避 + 断点续跑（cron 与手动共用）─────────────────
  if (action === 'crawl-step') {
    const r = await runStep(env, cfg.prices, {
      force: !!body.force,
      maxPages: body.maxPages,
      alwaysPage: !!body.alwaysPage,
    });
    return json({
      ...r,
      crawl: jobSummary(r.job, cfg.prices),
      session: sessionStatus(await getSession(env)),
    }, r.ok || r.skipped ? 200 : 200);
  }

  if (action === 'crawl-reset') {
    if (machineAuth && machineAuth.machine) return json({ success: false, error: '机器账号不能重置任务' }, 403);
    await resetJob(env);
    return json({ success: true, crawl: jobSummary(null, cfg.prices) });
  }

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

  const isCrawl = action === 'crawl-apply' || action === 'crawl-preview';
  const got = isCrawl ? await fromCrawl(env, cfg, boxes, body) : await collect(cfg, boxes, body, env);
  if (!got.samples.length) {
    return json({
      success: false,
      error: got.error || '没有采集到任何报价样本',
      hint: got.hint,
      errors: got.errors,
      provider: got.provider,
      session: got.session || sessionStatus(await getSession(env)),
      recordsCount: got.recordsCount || 0,
      filteredCount: got.filteredCount || 0,
      unmatchedCount: got.unmatchedCount || 0,
      unmatched: got.unmatched || [],
      debug: got.debug || null,
    }, 200);
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
    source: got.source || null,
    stale: !!got.stale,
    crawlPhase: got.crawlPhase || null,
    crawlPage: got.crawlPage == null ? null : got.crawlPage,
    samples: got.samples.length,
    recordsCount: got.recordsCount || got.samples.length,
    filteredCount: got.filteredCount || got.samples.length,
    relaxedKeyword: !!got.relaxedKeyword,
    matchedCharacters: Object.keys(agg.prices).length,
    diffs: diffs.length,
    stats: agg.stats.slice(0, 200),
    errors: got.errors || [],
    unmatchedCount: got.unmatchedCount || 0,
    unmatched: got.unmatched || [],
    hint: got.hint || null,
    session: got.session || null,
    target: { kind: target.kind, owner: target.owner, repo: target.repo, base: ref },
  };

  if (action === 'preview' || action === 'samples' || action === 'manual' || action === 'crawl-preview') {
    // samples/manual 只用于预览，写回前需要显式 apply
    return json({ success: true, ...summary, list: diffs.slice(0, 300) });
  }

  if (action !== 'apply' && action !== 'crawl-apply') return json({ success: false, error: '未知 action: ' + action }, 400);

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
    if (isCrawl) {
      try {
        const job = await getJob(env);
        if (job) { job.appliedAt = new Date().toISOString(); await saveJob(env, job); }
      } catch (e) {}
    }
    return json({ success: true, ...summary, changed: true, prUrl: pr.url, prNumber: pr.number });
  } catch (e) {
    return json({ success: false, error: e.message, ...summary }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: syncCors('GET, POST, OPTIONS') });
}
