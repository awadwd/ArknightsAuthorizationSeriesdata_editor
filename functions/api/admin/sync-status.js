// 同步状态：公开读（前端展示上次同步时间 / 每表结果 / PR 链接）
// 额外给出 stale 判定 + 自动同步配置，前端据此决定是否需要"自愈"补一次同步。
import { getAppConfig } from '../_lib/appConfig.js';

function cors() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

const DEFAULT_STALE_MINUTES = 90;

export async function onRequestGet(context) {
  try {
    let status = { lastRunAt: null };
    if (context.env.AUTH_STORE) {
      const raw = await context.env.AUTH_STORE.get('sync:status');
      if (raw) status = JSON.parse(raw);
    }

    let cfg = null;
    try { cfg = await getAppConfig(context.env); } catch (e) {}
    const autoSync = (cfg && cfg.autoSync) || {};
    if (!status.lastRunAt && autoSync.lastRunAt) status.lastRunAt = autoSync.lastRunAt;

    const staleMinutes = Number(autoSync.staleMinutes || DEFAULT_STALE_MINUTES);
    let ageMinutes = null;
    if (status.lastRunAt) {
      const t = new Date(status.lastRunAt).getTime();
      if (!isNaN(t)) ageMinutes = Math.round((Date.now() - t) / 60000);
    }
    const stale = ageMinutes === null ? true : ageMinutes > staleMinutes;

    return new Response(JSON.stringify({
      success: true,
      status,
      stale,
      ageMinutes,
      staleMinutes,
      autoSync: {
        enabled: !!autoSync.enabled,
        schedule: autoSync.schedule || '*/30 * * * *',
        lastRunAt: autoSync.lastRunAt || status.lastRunAt || null,
        lastTrigger: autoSync.lastTrigger || null,
        lastChanged: autoSync.lastChanged == null ? null : !!autoSync.lastChanged,
        // 配置最后一次写入时间：前端用它判断自己刚保存的开关是不是还没刷到
        savedAt: (cfg && cfg._savedAt) || null,
      },
      // 是否配置了机器触发（前端据此提示"自动同步已可用 / 还需配置 SYNC_TOKEN"）
      scheduler: {
        syncTokenConfigured: !!(context.env.SYNC_TOKEN || context.env.SYNC_SECRET),
        deployHookConfigured: !!(context.env.PAGES_DEPLOY_HOOK || context.env.DEPLOY_HOOK_URL),
      },
    }), { headers: cors() });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: cors() });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}
