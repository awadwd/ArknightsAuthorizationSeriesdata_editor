// 市价接口
//
// 市价分两条线，永不合并：
//   Box_Id.json      market_price  = 社区参考价（老市价），人工/上游维护，本接口不写
//   Price_Meta.json  prices        = 千岛第三方参考价，本接口写这里
//
// GET  /api/prices                 读 Price_Meta.json 里的千岛价矩阵 + 数据源配置（脱敏）
// POST /api/prices                 { action }
//   action=preview       采集并返回涨跌预览（不写）
//   action=apply         采集 + 写回 Price_Meta.json 的 prices + 开 PR
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
  loadBoxes, writePrices, writePriceMeta, fetchQiandao, aggregate, diffPrices, buildNameIndex, normalizeSamples,
  resolveSamples, filterRecords, extractRecords, eliteFromTitle,
  priceFreshness, buildPriceMeta, PRICE_TIME_FIELD, PRICE_META_FILE,
} from './_lib/prices.js';
import { saveSession, getSession, clearSession, sessionStatus, qdRequest, pickReplayApis } from './_lib/qiandao.js';
import { getJob, saveJob, resetJob, runStep, shouldRun, jobSummary, seedRecords } from './_lib/crawl.js';
import { verifyCollectToken, collectTokenStatus, rotateCollectToken } from './_lib/collectAuth.js';

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

const FRESH_KEY = 'price_freshness';
const FRESH_TTL_MS = 10 * 60 * 1000;

function boxHasAnyPrice(b) {
  for (let i = 1; i <= 10; i++) {
    const mp = b['character' + i] && b['character' + i].market_price;
    if (mp && (mp.ELITE1 != null || mp.ELITE2 != null)) return true;
  }
  return false;
}

// 读 Box_Id.json 判断市价新不新鲜，给 crawl-step / apply 当前置闸门。
// 读失败（token 没权限、文件不见了）就返回 null，表示「不拦」，让抓取照常进行——
// 宁可多抓一次，也不要因为读不到文件而把整个自动更新卡死。
async function readFileFreshness(env, cfg, auth, body) {
  const now = Date.now();
  try {
    const raw = env && env.AUTH_STORE ? await env.AUTH_STORE.get(FRESH_KEY) : null;
    if (raw) {
      const c = JSON.parse(raw);
      if (c && c.at && now - c.at < FRESH_TTL_MS && c.data) return c.data;
    }
  } catch (e) { /* 缓存坏了就当没有 */ }

  let data = null;
  try {
    const loaded = await loadBoxes(cfg, auth.token, auth.source, body && body.target, body && body.base);
    data = loaded.freshness;
  } catch (e) {
    return null;
  }
  try {
    if (env && env.AUTH_STORE) await env.AUTH_STORE.put(FRESH_KEY, JSON.stringify({ at: now, data }));
  } catch (e) {}
  return data;
}

// 面板上的「下一句该干什么」要跟 Box_Id.json 里的核对时间对齐：
// 任务状态机说「该重开一轮」，但如果文件里的市场时间还没到周期，真正生效的是后者。
function withFreshGate(summary, freshness) {
  if (!summary) return summary;
  if (freshness && freshness.fresh) {
    return Object.assign({}, summary, {
      reason: freshness.reason,
      priceTimeGate: true,
    });
  }
  return summary;
}

// 面板上的价格矩阵 = Price_Meta.json 里的千岛价（按盒号分层）。
// 不再从 Box_Id.json 读：那边的 market_price 是社区参考价，语义不同，混在一起看会误判。
function matrixOfPrices(prices) {
  const matrix = [];
  for (const boxId of Object.keys(prices || {})) {
    const chars = prices[boxId] || {};
    for (const name of Object.keys(chars)) {
      const p = chars[name] || {};
      matrix.push({
        name, boxId, from: 'kiandao',
        ELITE1: p.ELITE1 == null ? null : Number(p.ELITE1),
        ELITE2: p.ELITE2 == null ? null : Number(p.ELITE2),
      });
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
    const { target, ref, boxes, freshness, meta, metaFile } = await loadBoxes(cfg, auth.token, auth.source, url.searchParams.get('target'), url.searchParams.get('base'));
    const pcfg = cfg.prices || {};
    const kiandaoPrices = (meta && meta.prices) || {};
    return json({
      success: true,
      target: { kind: target.kind, owner: target.owner, repo: target.repo, base: ref },
      count: boxes.length,
      // 千岛价（第三方参考价）矩阵；Box_Id.json 的 market_price 是另一条线，不在这里
      matrix: matrixOfPrices(kiandaoPrices),
      matrixSource: PRICE_META_FILE,
      priceBoxes: Object.keys(kiandaoPrices).length,
      priceMetaAt: meta ? meta[PRICE_TIME_FIELD] || null : null,
      priceMetaFile: metaFile ? { exists: true, sha: metaFile.sha } : { exists: false },
      freshness,
      session: sessionStatus(session),
      crawl: withFreshGate(jobSummary(job, pcfg), freshness),
      collectToken: collectTokenStatus(cfg),
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

  const cfgPre = await getAppConfig(env);

  // ── 采集令牌通道（油猴脚本 / 第三方页面）────────────────────────────────
  // 只放行 save-session：写一份会话缓存，读不到配置、提不了 PR、改不了仓库。
  if (!request.headers.get('X-Sync-Token') && !request.headers.get('Authorization') && verifyCollectToken(request, cfgPre)) {
    let body = {};
    try { body = await request.json(); } catch (e) { body = {}; }
    if (action !== 'save-session') {
      return json({ success: false, error: '采集令牌只能保存会话（action=save-session）' }, 403);
    }
    try {
      const bundle = await saveSession(env, body.bundle || body);
      // 浏览器已经抓到的记录直接并入抓取任务，省掉服务端重放
      const seed = await seedRecords(env, cfgPre.prices, bundle.samples);
      return json({
        success: true,
        via: 'collect-token',
        session: sessionStatus(bundle),
        seeded: seed.added,
        crawlRecords: seed.records,
        detected: {
          samples: bundle.samples.length,
          withElite: bundle.samples.filter(s => s.elite || eliteFromTitle(s.title)).length,
          withPass: bundle.samples.filter(s => /通行证|通行|pass/i.test(s.title)).length,
          apis: bundle.apis.length,
          preview: bundle.samples.slice(0, 5),
        },
        note: bundle.samples.length === 0
          ? '只存了 cookie 和接口，没抓到行情记录。回千岛页面多滚几屏再传一次。'
          : (seed.added ? `已并入抓取任务 ${seed.added} 条新记录` : '记录都已存在，没有新增'),
      });
    } catch (e) {
      return json({ success: false, error: e.message }, 400);
    }
  }

  const machineAuth = await verifySyncRequest(request, env);
  const ownerAuth = machineAuth && machineAuth.isOwner ? machineAuth : await verifyRequest(request);
  if (!ownerAuth) return json({ success: false, error: 'not authenticated' }, 401);
  if (!ownerAuth.isOwner) return json({ success: false, error: 'forbidden: only owner' }, 403);
  if (machineAuth && !machineAuth.machine) { /* 普通用户会话，继续 */ }

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  const cfg = cfgPre;

  // ── 采集令牌：给油猴脚本用，只能写会话 ──────────────────────────────────
  if (action === 'collect-token') {
    if (machineAuth && machineAuth.machine) return json({ success: false, error: '机器账号不能改采集令牌' }, 403);
    const op = body.op === 'clear' ? 'clear' : 'generate';
    try {
      const r = await rotateCollectToken(env, op);
      return json({
        success: true,
        op,
        token: r.token,          // 只在生成时返回一次完整值
        collectToken: r.status,
        note: op === 'clear'
          ? '已清空，已装好的油猴脚本会立刻失效'
          : '这个令牌只显示这一次，复制进油猴面板；丢了就重新生成',
      });
    } catch (e) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  // ── 千岛会话（浏览器控制台抓到的 cookie + 接口）────────────────────────────
  if (action === 'save-session') {
    if (machineAuth && machineAuth.machine) return json({ success: false, error: '机器账号不能改会话' }, 403);
    try {
      const bundle = await saveSession(env, body.bundle || body);
      const status = sessionStatus(bundle);
      const seed = await seedRecords(env, cfg.prices, bundle.samples);
      // 顺手报一下「这份数据能不能用」，省得用户点进去才发现匹配不到
      const samplePreview = bundle.samples.slice(0, 5);
      const withElite = bundle.samples.filter(s => s.elite || eliteFromTitle(s.title)).length;
      const withPass = bundle.samples.filter(s => /通行证|通行|pass/i.test(s.title)).length;
      return json({
        success: true,
        session: status,
        seeded: seed.added,
        crawlRecords: seed.records,
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
          : (seed.added ? `已并入抓取任务 ${seed.added} 条新记录（共 ${seed.records} 条）` : '记录都已存在，没有新增'),
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
    // 月度节奏以 Price_Meta.json 里的 market_priceUpdateTime 为准（一条总记录）：
    // 先问任务状态机「现在该继续吗」，它说该跑了，再花一次读文件确认——
    // 文件里的时间戳没到周期就直接跳过，一个请求都不发给千岛。
    let freshness = null;
    const force = !!body.force;
    if (!force) {
      const job0 = await getJob(env);
      const gate = shouldRun(job0, cfg.prices);
      if (!gate.run) {
        return json({
          success: true, skipped: true, reason: gate.reason,
          crawl: jobSummary(job0, cfg.prices),
          session: sessionStatus(await getSession(env)),
        });
      }
      freshness = await readFileFreshness(env, cfg, ownerAuth, body);
      if (freshness && freshness.fresh) {
        return json({
          success: true, skipped: true, reason: freshness.reason,
          freshness,
          crawl: jobSummary(job0, cfg.prices),
          session: sessionStatus(await getSession(env)),
        });
      }
    }
    const r = await runStep(env, cfg.prices, {
      force,
      maxPages: body.maxPages,
      alwaysPage: !!body.alwaysPage,
    });
    return json({
      ...r,
      freshness: freshness || null,
      crawl: jobSummary(r.job, cfg.prices),
      session: sessionStatus(await getSession(env)),
    }, r.ok || r.skipped ? 200 : 200);
  }

  // ── 记录「市价这一轮是什么时候核对的」（一个月一条总记录）────────────────
  // 只写 Price_Meta.json 这一个文件，Box_Id.json 一行都不动：
  // 一轮抓取是全量覆盖，95 个盒子写同一个时间只是在制造 diff 噪声。
  if (action === 'stamp') {
    if (machineAuth && machineAuth.machine) return json({ success: false, error: '机器账号不能回填时间戳' }, 403);
    let loaded0;
    try {
      loaded0 = await loadBoxes(cfg, ownerAuth.token, ownerAuth.source, body.target, body.base);
    } catch (e) {
      return json({ success: false, error: e.message }, 500);
    }
    const at = body.at ? new Date(Date.parse(body.at) || Date.now()).toISOString() : new Date().toISOString();
    const dry = !!body.dryRun;
    // 「核对过哪些盒」以 Price_Meta.json 里已有的千岛价为准；
    // 老数据没 prices 时才退回「Box_Id.json 里有参考价的盒数」。
    const curPrices = (loaded0.meta && loaded0.meta.prices) || {};
    const priceBoxCount = Object.keys(curPrices).length;
    const legacyBoxCount = (loaded0.boxes || []).filter(boxHasAnyPrice).length;
    const boxCount = priceBoxCount || legacyBoxCount;
    const refreshDays = ((cfg.prices || {}).crawl || {}).refreshDays;
    const previewMeta = buildPriceMeta({ at, by: 'manual', boxes: boxCount, prices: curPrices });
    const before = loaded0.freshness;
    const after = priceFreshness(previewMeta, refreshDays);
    if (dry) {
      return json({ success: true, dryRun: true, at, file: PRICE_META_FILE, meta: previewMeta, before, after });
    }
    try {
      const pr = await writePriceMeta(cfg, ownerAuth.token, ownerAuth.source, body.target, body.base, {
        at,
        by: 'manual',
        boxes: boxCount,
        existingMeta: loaded0.meta,
        metaFile: loaded0.metaFile,
        title: body.title || `chore(prices): 记录市价核对时间 ${at.slice(0, 10)}`,
      });
      return json({
        success: true, changed: true, at, file: PRICE_META_FILE,
        prUrl: pr.url, prNumber: pr.number,
        before, after,
      });
    } catch (e) {
      return json({ success: false, error: e.message }, 500);
    }
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
  const { boxes, file, target, ref, freshness } = loaded;

  // action=apply 是「重新采一轮再写」——先看 Box_Id.json 里的核对时间，没到周期就别白撞一次 WAF。
  // crawl-apply 用的是已经抓到的记录（用户自己点的），不受这个闸门限制。
  // force=1 可以强制。
  if (action === 'apply' && !body.force && freshness && freshness.fresh) {
    return json({
      success: true, skipped: true, changed: false,
      reason: freshness.reason, freshness,
      target: { kind: target.kind, owner: target.owner, repo: target.repo, base: ref },
    });
  }

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

  // 这轮采到的千岛价 vs Price_Meta.json 里现有的，只用来生成 PR 摘要。
  // Box_Id.json 全程不参与——它是参考价那条线，写进去就把两种价合并了（已经踩过一次）。
  const existingPrices = (loaded.meta && loaded.meta.prices) || {};
  const { diffs, next: nextPrices } = diffPrices(agg.byBox, existingPrices);
  const matchedChars = Object.keys(agg.byBox).reduce((n, b) => n + Object.keys(agg.byBox[b]).length, 0);

  // 本轮核对时间只留一条：写进 Price_Meta.json，不往 95 个盒子上各贴一遍。
  // 预览和写回用同一个值（stampedAt），避免两次调用差几毫秒。
  const stampedAt = new Date().toISOString();
  const isPreviewAction = action === 'preview' || action === 'samples' || action === 'manual' || action === 'crawl-preview';
  const metaPreview = buildPriceMeta({
    at: stampedAt,
    by: got.source === 'crawl' ? 'qiandao-crawl' : 'qiandao',
    boxes: Object.keys(nextPrices).length,
    records: got.recordsCount || got.samples.length,
    characters: matchedChars,
    prices: nextPrices,
  });

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
    matchedCharacters: matchedChars,
    boxesMatched: Object.keys(agg.byBox).length,
    // 有系列名、能锁定盒号的样本（可信）；loose = 只能靠「干员全局唯一」兜底的样本
    seriesMatched: got.samples.filter(s => !s.loose).length,
    looseSamples: got.samples.filter(s => s.loose).length,
    noBoxSamples: agg.noBoxSamples || 0,
    skippedByMinSamples: (agg.skipped || []).length,
    diffs: diffs.length,
    writeTarget: PRICE_META_FILE,
    untouched: 'Box_Id.json',
    priceTime: { file: PRICE_META_FILE, field: PRICE_TIME_FIELD, at: stampedAt },
    freshness,
    stats: agg.stats.slice(0, 200),
    errors: got.errors || [],
    unmatchedCount: got.unmatchedCount || 0,
    unmatched: got.unmatched || [],
    hint: got.hint || null,
    session: got.session || null,
    target: { kind: target.kind, owner: target.owner, repo: target.repo, base: ref },
  };

  if (isPreviewAction) {
    // samples/manual 只用于预览，写回前需要显式 apply
    return json({ success: true, ...summary, list: diffs.slice(0, 300) });
  }

  if (action !== 'apply' && action !== 'crawl-apply') return json({ success: false, error: '未知 action: ' + action }, 400);

  try {
    const pr = await writePrices(cfg, ownerAuth.token, ownerAuth.source, body.target, body.base, {
      prices: nextPrices,
      at: stampedAt,
      by: metaPreview.updatedBy,
      records: metaPreview.records,
      characters: metaPreview.characters,
      diffs,
      metaFile: loaded.metaFile,
      title: diffs.length
        ? `chore(prices): 更新千岛第三方市价 (${diffs.length} 处) @ ${stampedAt}`
        : `chore(prices): 核对千岛市价（无变化，仅记录时间） @ ${stampedAt}`,
    });
    try {
      await saveAppConfig(env, Object.assign({}, cfg, {
        prices: Object.assign({}, cfg.prices || {}, { lastRunAt: stampedAt, lastResult: { ...summary, prUrl: pr.url, count: diffs.length } }),
      }));
    } catch (e) {}
    if (isCrawl) {
      try {
        const job = await getJob(env);
        if (job) { job.appliedAt = stampedAt; await saveJob(env, job); }
      } catch (e) {}
    }
    // 刚刚写回，缓存里的 freshness 立刻作废，免得下一次 crawl-step 又读到旧值以为该抓
    try { if (env.AUTH_STORE) await env.AUTH_STORE.delete(FRESH_KEY); } catch (e) {}
    return json({
      success: true, ...summary, changed: true,
      priceChangeCount: diffs.length,
      priceMetaAt: pr.metaAt || stampedAt,
      prUrl: pr.url, prNumber: pr.number,
    });
  } catch (e) {
    return json({ success: false, error: e.message, ...summary }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: syncCors('GET, POST, OPTIONS') });
}
