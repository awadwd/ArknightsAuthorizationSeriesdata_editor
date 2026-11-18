// 同步：从知晓云拉全部数据表 -> 重写 kc-data.js -> 推送编辑器仓库 -> 触发 Pages 部署
//
// 两类调用者：
//   1) 登录用户在配置页点「立即同步」（Authorization: Bearer <PAT>）
//   2) 定时任务（Cloudflare Cron / GitHub Actions / 任意 cron）用 X-Sync-Token 触发。
//      这是"自动同步真的会自己跑"的关键：不再依赖某个人打开浏览器点一下。
//
// 相对旧版的改进：
//   - 指纹比对：数据没变直接返回 changed:false，不建分支、不提 PR（旧版每次都产 PR）
//   - 每表记录行数/耗时/指纹，前端能看出到底同步了什么
//   - 单表失败保留旧数据，不会把整表清空
//   - 合并后调用 PAGES_DEPLOY_HOOK，避免"仓库更新了、线上还是旧数据"
import { getAppConfig, saveAppConfig } from '../_lib/appConfig.js';
import { KC_TABLES, fetchKnowCloudTable, kcStats, pushKcData } from '../_lib/kcGen.js';
import { verifySyncRequest, syncCors } from '../_lib/syncAuth.js';

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: syncCors('GET, POST, OPTIONS') });
}

async function readStatus(env) {
  try {
    if (!env.AUTH_STORE) return null;
    const raw = await env.AUTH_STORE.get('sync:status');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function buildMessage(machine, changedTables) {
  const head = machine ? 'sync(cron): update kc-data from 知晓云' : 'sync: update kc-data from 知晓云';
  const tail = changedTables.length ? ' [' + changedTables.join(', ') + ']' : '';
  return head + tail + ' @ ' + new Date().toISOString();
}

async function runSync(context, opts) {
  const { env } = context;
  const o = opts;
  const cfg = await getAppConfig(env);
  const syncCfg = (cfg && cfg.autoSync) || {};
  const enabled = syncCfg.enabled !== false;
  const tables = (Array.isArray(o.tables) && o.tables.length) ? o.tables
    : ((syncCfg.tables && syncCfg.tables.length) ? syncCfg.tables : KC_TABLES);

  // 「启用自动同步」这个开关必须真的有作用，否则它只是个装饰。
  // 只拦定时任务（chron）；人手点的「立即同步」照跑——人已经明确要求了。
  if (o.machine && !enabled) {
    const prev = await readStatus(env);
    const skipped = Object.assign({}, prev || {}, {
      skipped: true,
      skipReason: 'autoSync.enabled=false（配置页里已停用自动同步）',
      checkedAt: new Date().toISOString(),
      enabled: false,
      trigger: 'scheduler',
    });
    try {
      if (env.AUTH_STORE) await env.AUTH_STORE.put('sync:status', JSON.stringify(skipped));
    } catch (e) {}
    return skipped;
  }

  const kcData = {};
  const results = [];
  const startedAll = Date.now();

  for (const t of tables) {
    const t0 = Date.now();
    try {
      const rows = await fetchKnowCloudTable(t);
      if (rows === null) {
        results.push({ table: t, status: 'failed', error: 'knowcloud fetch failed', ms: Date.now() - t0, keepOld: true });
      } else {
        kcData[t] = rows;
        results.push({ table: t, status: 'ok', count: rows.length, ms: Date.now() - t0 });
      }
    } catch (e) {
      results.push({ table: t, status: 'failed', error: e.message, ms: Date.now() - t0, keepOld: true });
    }
  }

  const prev = await readStatus(env);
  const prevHashes = (prev && prev.stats) || {};
  const stats = kcStats(kcData);
  const changedTables = [];
  for (const t of Object.keys(kcData)) {
    const h = stats[t] && stats[t].hash;
    const ph = prevHashes[t] && prevHashes[t].hash;
    if (!ph || ph !== h) changedTables.push(t);
  }

  const failed = results.filter(r => r.status === 'failed');
  let push = { changed: false, merged: false, url: null };
  let pushError = null;

  if (failed.length === tables.length) {
    pushError = '所有表都拉取失败，跳过推送';
  } else if (!changedTables.length && !o.force) {
    // 数据没变：什么都不做（旧版会提一个空 PR，看着像"同步成功"其实没动）
  } else {
    try {
      push = await pushKcData(o.token, kcData, buildMessage(o.machine, changedTables), { force: !!o.force, env });
    } catch (e) {
      pushError = e.message;
    }
  }

  const status = {
    lastRunAt: new Date().toISOString(),
    triggeredBy: o.triggeredBy || 'unknown',
    trigger: o.machine ? 'scheduler' : 'manual',
    source: 'knowcloud',
    enabled,
    skipped: false,
    durationMs: Date.now() - startedAll,
    results,
    stats,
    changedTables,
    changed: !!push.changed,
    prUrl: push.url || null,
    merged: !!push.merged,
    deploy: push.deploy || { ok: false, skipped: true },
    pushError,
    ok: !pushError,
  };

  try {
    if (env.AUTH_STORE) await env.AUTH_STORE.put('sync:status', JSON.stringify(status));
  } catch (e) {}

  try {
    const fresh = await getAppConfig(env);
    const freshSync = (fresh && fresh.autoSync) || {};
    await saveAppConfig(env, Object.assign({}, fresh, {
      autoSync: Object.assign({}, freshSync, {
        lastRunAt: status.lastRunAt,
        lastTrigger: status.trigger,
        lastChanged: status.changed,
        lastResult: status,
      })
    }));
  } catch (e) {}

  return status;
}

async function bodyOf(request) {
  try {
    const text = await request.clone().text();
    if (!text) return {};
    return JSON.parse(text);
  } catch (e) { return {}; }
}

async function handle(context, extra) {
  const { request, env } = context;
  const auth = await verifySyncRequest(request, env);
  if (!auth) return json({ success: false, error: 'not authenticated' }, 401);
  if (!auth.isOwner) return json({ success: false, error: 'forbidden: only owner', isOwner: false }, 403);

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1' || !!extra.force;
  const status = await runSync(context, {
    token: auth.token,
    force,
    tables: extra.tables || null,
    machine: !!auth.machine,
    triggeredBy: auth.machine ? 'scheduler' : auth.username,
  });
  return json({ success: true, status });
}

export async function onRequestPost(context) {
  const body = await bodyOf(context.request);
  return handle(context, {
    force: !!body.force,
    tables: Array.isArray(body.tables) ? body.tables : null,
  });
}

// GET 供 cron / 浏览器直接打（cron 服务多数只能发 GET）
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  return handle(context, { force: url.searchParams.get('force') === '1', tables: null });
}

export async function onRequestOptions() {
  return new Response(null, { headers: syncCors('GET, POST, OPTIONS') });
}
