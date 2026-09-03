// 自动同步：从知晓云拉全部数据表 -> 重写 kc-data.js -> 推送编辑器仓库
import { getAppConfig, saveAppConfig } from '../_lib/appConfig.js';
import { verifyRequest } from '../_lib/auth.js';
import { KC_TABLES, fetchKnowCloudTable, pushKcData } from '../_lib/kcGen.js';

function cors() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function onRequestPost(context) {
  const auth = await verifyRequest(context.request);
  if (!auth) {
    return new Response(JSON.stringify({ success: false, error: 'not authenticated' }), { status: 401, headers: cors() });
  }
  if (!auth.isOwner) {
    return new Response(JSON.stringify({ success: false, error: 'forbidden: only owner', isOwner: false }), { status: 403, headers: cors() });
  }

  const cfg = await getAppConfig(context.env);
  const syncCfg = (cfg && cfg.autoSync) || {};
  const tables = (syncCfg.tables && syncCfg.tables.length) ? syncCfg.tables : KC_TABLES;

  const kcData = {};
  const results = [];
  for (const t of tables) {
    try {
      const rows = await fetchKnowCloudTable(t);
      if (rows === null) {
        results.push({ table: t, status: 'skipped', error: 'knowcloud fetch failed' });
      } else {
        kcData[t] = rows;
        results.push({ table: t, status: 'ok', count: rows.length });
      }
    } catch (e) {
      results.push({ table: t, status: 'failed', error: e.message });
    }
  }

  let pr = null;
  let pushError = null;
  try {
    pr = await pushKcData(auth.token, kcData, 'sync: update kc-data from 知晓云 @ ' + new Date().toISOString());
  } catch (e) {
    pushError = e.message;
  }

  const status = {
    lastRunAt: new Date().toISOString(),
    triggeredBy: auth.username,
    source: 'knowcloud',
    results,
    prUrl: pr ? pr.url : null,
    merged: pr ? pr.merged : false,
    pushError,
  };

  try {
    if (context.env.AUTH_STORE) {
      await context.env.AUTH_STORE.put('sync:status', JSON.stringify(status));
    }
  } catch (e) {}

  try {
    await saveAppConfig(context.env, Object.assign({}, cfg, {
      autoSync: Object.assign({}, syncCfg, { lastRunAt: status.lastRunAt, lastResult: status })
    }));
  } catch (e) {}

  return new Response(JSON.stringify({ success: true, status }), { headers: cors() });
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}
