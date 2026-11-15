// 千岛抓取任务：慢速、可暂停、可续跑、一月一轮
//
// 为什么不是一个请求抓完：
//   千岛的行情接口有频率限制，连续打几次就返回 405「您的手速也太快了」。
//   市价一个月更新一次就够，所以做成「分页慢抓 + 退避等待 + 断点续跑」：
//     - 每次 tick 只抓 maxPagesPerRun 页，页间 sleep delayMs；
//     - 撞上限流就按 backoff 序列往后推 nextRunAt，进度原样存着；
//     - 下个周期（cron 每 30 分钟醒一次）看 nextRunAt 到没到，到了接着抓剩下的；
//     - 一轮抓完 30 天内不再自动重开。
//
// 状态存在 KV 的 qiandao_crawl，字段见 DEFAULT_JOB。

import { getSession, qdRequest, pickReplayApis, sessionStatus } from './qiandao.js';
import { extractRecords } from './prices.js';

const JOB_KEY = 'qiandao_crawl';

export const DEFAULT_CRAWL = {
  enabled: true,
  refreshDays: 30,          // 整轮多久跑一次
  maxPagesPerRun: 3,        // 单次 tick 最多抓几页
  delayMs: 3000,            // 页与页之间的间隔（撞限流会自动翻倍）
  maxDelayMs: 30000,
  backoffMinutes: [15, 25, 40, 120, 720],   // 前几档都在 cookie 寿命内
  maxPages: 60,             // 安全上限，防止翻页参数不被支持时无限翻
};

function blankJob(cfg) {
  const c = Object.assign({}, DEFAULT_CRAWL, (cfg && cfg.crawl) || {});
  return {
    id: 'qd-' + Date.now(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    phase: 'idle',            // idle | running | cooldown | done | blocked
    page: 0,
    pagesTried: 0,
    delayMs: c.delayMs,
    attempts: 0,
    records: [],
    lastError: null,
    note: null,
    lastRunAt: null,
    finishedAt: null,
    nextRunAt: null,          // ISO，cooldown 时表示最早可再执行时间
    config: c,
  };
}

export async function getJob(env) {
  try {
    const raw = await env.AUTH_STORE.get(JOB_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export async function saveJob(env, job) {
  job.updatedAt = new Date().toISOString();
  // records 可能有几千条，KV 单值上限 25MB，这里控制在 2000 条以内
  if (job.records && job.records.length > 2000) job.records = job.records.slice(0, 2000);
  await env.AUTH_STORE.put(JOB_KEY, JSON.stringify(job));
  return job;
}

export async function resetJob(env) {
  await env.AUTH_STORE.delete(JOB_KEY);
}

function cfgOf(job) {
  return Object.assign({}, DEFAULT_CRAWL, (job && job.config) || {});
}

function setPage(url, page) {
  try {
    const u = new URL(url);
    if (u.searchParams.has('page')) u.searchParams.set('page', String(page));
    else if (u.searchParams.has('offset')) u.searchParams.set('offset', String(page));
    else if (u.searchParams.has('cursor')) u.searchParams.set('cursor', String(page));
    else if (u.searchParams.has('pn')) u.searchParams.set('pn', String(page));
    else u.searchParams.set('page', String(page));
    return u.toString();
  } catch (e) {
    return url + (url.includes('?') ? '&' : '?') + 'page=' + page;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, Math.max(0, Math.min(ms, 30000))));
}

function mergeRecords(job, incoming) {
  const map = new Map();
  for (const r of job.records) map.set(r.spuId || (r.name + '|' + r.elite + '|' + r.series), r);
  let added = 0;
  for (const r of incoming) {
    const k = r.spuId || (r.name + '|' + r.elite + '|' + r.series);
    if (!map.has(k)) { map.set(k, r); added++; }
  }
  job.records = Array.from(map.values());
  return added;
}

// 是否该继续跑（被 cron 和手动「继续」共用）
export function shouldRun(job, cfg, now) {
  const c = Object.assign({}, DEFAULT_CRAWL, cfg || {});
  if (!c.enabled) return { run: false, reason: '抓取任务已停用' };
  const ts = now || Date.now();
  if (!job) return { run: true, reason: '还没有任务，需要新建' };
  if (job.phase === 'done') {
    const fin = Date.parse(job.finishedAt || 0) || 0;
    const days = (ts - fin) / 86400000;
    if (days < (c.refreshDays || 30)) {
      return { run: false, reason: `上一轮 ${Math.floor(days)} 天前完成，${Math.ceil((c.refreshDays || 30) - days)} 天后再说` };
    }
    return { run: true, reason: '到了刷新周期，重开一轮' };
  }
  if (job.phase === 'cooldown') {
    const next = Date.parse(job.nextRunAt || 0) || 0;
    if (ts < next) return { run: false, reason: '退避中，' + Math.ceil((next - ts) / 60000) + ' 分钟后再继续' };
    return { run: true, reason: '退避结束，继续' };
  }
  if (job.phase === 'blocked') {
    // blocked 说明上次是会话问题，只有换了新会话才值得再试
    return { run: true, reason: '上次因会话失效中断，重试' };
  }
  return { run: true, reason: '继续' };
}

// 执行一轮（最多 maxPagesPerRun 页）。返回执行摘要，不抛异常。
export async function runStep(env, cfg, opts) {
  const o = opts || {};
  const c = Object.assign({}, DEFAULT_CRAWL, (cfg && cfg.crawl) || {});
  let job = await getJob(env);
  const now = Date.now();

  const gate = shouldRun(job, c, now);
  if (!gate.run && !o.force) return { ok: true, skipped: true, reason: gate.reason, job };

  const session = await getSession(env);
  const sstat = sessionStatus(session);
  if (!session) {
    job = job || blankJob(cfg);
    job.phase = 'blocked';
    job.lastError = '没有千岛会话：先在浏览器里抓一次 cookie 再继续';
    job.attempts = 0;
    await saveJob(env, job);
    return { ok: false, error: job.lastError, job, session: sstat };
  }
  // acw_sc__v2 只有约 1 小时寿命，过期了就别浪费请求，直接叫人重抓
  if (sstat.expired) {
    job = job || blankJob(cfg);
    job.phase = 'blocked';
    job.lastError = '千岛会话已过期（cookie 约 1 小时），回千岛页面重新跑一次采集脚本再粘回来';
    job.attempts = 0;
    await saveJob(env, job);
    return { ok: false, error: job.lastError, job, session: sstat };
  }

  if (!job || job.phase === 'done') job = blankJob(cfg);
  // 之前因为 cookie 过期/被拦中断，现在拿到了一份更新的会话 → 从头抓一轮，别把一个月前的快照混进来
  if (job.phase === 'blocked' && Date.parse(session.savedAt || 0) > Date.parse(job.updatedAt || 0)) {
    job = blankJob(cfg);
  }

  const apis = pickReplayApis(session, 3);
  if (!apis.length) {
    job.phase = 'blocked';
    job.lastError = '会话里没有可重放的接口：重新抓一次（__QD.copy() 会带上 apis）';
    await saveJob(env, job);
    return { ok: false, error: job.lastError, job };
  }
  const api = apis[0];
  const priceField = (cfg && cfg.qiandao && cfg.qiandao.priceField) || 'strikePrice';
  const seriesFilter = (cfg && cfg.qiandao && cfg.qiandao.seriesFilter) || '';

  job.phase = 'running';
  job.lastError = null;
  const perRun = Math.max(1, Math.min(Number(o.maxPages || c.maxPagesPerRun), 10));
  let pages = 0;
  let added = 0;

  for (let i = 0; i < perRun; i++) {
    if (job.page >= (c.maxPages || 60)) { job.phase = 'done'; break; }
    const url = job.page === 0 && !o.alwaysPage ? api.url : setPage(api.url, job.page);
    const r = await qdRequest(session, { url, method: api.method, body: api.body, headers: api.headers });
    job.pagesTried++;

    if (!r.ok) {
      // 频率过高 / 被拦 → 降速 + 退避，进度不动，等下个周期
      job.attempts = (job.attempts || 0) + 1;
      job.delayMs = Math.min(job.delayMs * 2, c.maxDelayMs);
      const backoff = c.backoffMinutes || DEFAULT_CRAWL.backoffMinutes;
      const idx = Math.min(job.attempts - 1, backoff.length - 1);
      const waitMin = backoff[idx] || 120;
      job.phase = 'cooldown';
      job.lastError = r.error || '请求失败';
      job.nextRunAt = new Date(Date.now() + waitMin * 60000).toISOString();
      // 连续失败超过退避阶梯长度，就别再傻等了：服务端很可能一直过不了 WAF
      if (job.attempts > backoff.length) {
        job.phase = 'blocked';
        job.lastError += '（已连续失败 ' + job.attempts + ' 次，服务端多半一直过不了阿里云 WAF。'
          + '改用浏览器采集：在千岛页面跑一遍采集脚本，粘回上面「千岛接入」，再点「用它算价」）';
        job.nextRunAt = null;
      }
      await saveJob(env, job);
      return {
        ok: false,
        error: job.lastError,
        paused: true,
        waitMinutes: waitMin,
        nextRunAt: job.nextRunAt,
        page: job.page,
        records: job.records.length,
        job,
      };
    }

    const got = extractRecords(r.json, { priceField, seriesFilter });
    const n = mergeRecords(job, got);
    added += n;
    pages++;
    job.attempts = 0;

    // 没有新增 → 到此为止。区分两种情况，方便在界面上说人话：
    //   拿到记录但全是重复 → 多半是翻页参数不被支持（每页返回同一批），别无限翻
    //   一条记录都没有   → 真到底了
    if (n === 0) {
      job.phase = 'done';
      if (got.length > 0) {
        job.note = `第 ${job.page} 页返回的商品和第 1 页重复，判断翻页参数不被支持，已停止（不是出错）`;
      }
      break;
    }

    job.page++;
    job.lastRunAt = new Date().toISOString();
    await saveJob(env, job);

    if (i < perRun - 1) await sleep(job.delayMs);
  }

  if (job.phase !== 'done' && job.page >= (c.maxPages || 60)) job.phase = 'done';
  if (job.phase === 'done') {
    job.finishedAt = new Date().toISOString();
    job.nextRunAt = null;
  } else {
    job.phase = 'running';
  }
  await saveJob(env, job);

  return {
    ok: true,
    pages,
    added,
    records: job.records.length,
    page: job.page,
    phase: job.phase,
    job,
  };
}

// 给前端看的进度摘要
export function jobSummary(job, cfg) {
  const c = Object.assign({}, DEFAULT_CRAWL, (cfg && cfg.crawl) || {});
  if (!job) return { present: false, config: c };
  const gate = shouldRun(job, c, Date.now());
  const next = job.nextRunAt ? Date.parse(job.nextRunAt) : 0;
  const names = new Set();
  const series = new Set();
  for (const r of job.records || []) {
    if (r.name) names.add(r.name);
    if (r.series) series.add(r.series);
  }
  return {
    present: true,
    id: job.id,
    phase: job.phase,
    page: job.page,
    pagesTried: job.pagesTried,
    records: (job.records || []).length,
    characters: names.size,
    series: Array.from(series).slice(0, 8),
    seriesCount: series.size,
    delayMs: job.delayMs,
    attempts: job.attempts || 0,
    lastError: job.lastError || null,
    note: job.note || null,
    lastRunAt: job.lastRunAt || null,
    finishedAt: job.finishedAt || null,
    appliedAt: job.appliedAt || null,
    nextRunAt: job.nextRunAt || null,
    nextRunInMinutes: next ? Math.max(0, Math.round((next - Date.now()) / 60000)) : null,
    ready: gate.run,
    reason: gate.reason,
    refreshDays: c.refreshDays,
    config: c,
  };
}
