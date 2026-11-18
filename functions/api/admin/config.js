import { getAppConfig, patchAppConfig } from '../_lib/appConfig.js';
import { verifyRequest } from '../_lib/auth.js';

function cors() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // 绝对不能缓存：配置页刷新时要看到「刚写进去的值」。
    // 中间层/浏览器缓存一份旧 config，就会表现为「开关一刷新又回到关」。
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
  };
}

// 公开读要做脱敏：这个接口不需要登录，原样返回会把千岛会话 cookie 和采集令牌
// 送给任何打开页面的人。市价相关配置只在「市价」页经 /api/prices 拿（那里另有鉴权）。
function publicView(cfg) {
  const out = JSON.parse(JSON.stringify(cfg || {}));
  const qd = out.prices && out.prices.qiandao;
  if (qd) {
    qd.headers = {};
    if (qd.collectToken) qd.collectToken = '***';
  }
  return out;
}

// GET /api/admin/config — 公开读（前端初始化需要）
export async function onRequestGet(context) {
  try {
    const cfg = await getAppConfig(context.env);
    return new Response(JSON.stringify({
      success: true,
      config: publicView(cfg),
      // 这份配置最后一次写入的时间。前端拿它跟自己刚写入的时间比对，
      // 就能区分「服务端真的没存下」和「KV 边缘缓存还没刷（最长 60 秒）」。
      savedAt: (cfg && cfg._savedAt) || null,
      readAt: new Date().toISOString(),
    }), { headers: cors() });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e && e.message || 'read failed' }), {
      status: 500, headers: cors(),
    });
  }
}

// POST /api/admin/config — owner-only 写
//   { patch: { autoSync: { enabled: true } } }  局部改（推荐：单个开关走这条）
//   { config: {...} }                           整包改（也按深合并处理，不抹掉没传的块）
export async function onRequestPost(context) {
  const auth = await verifyRequest(context.request);
  if (!auth) {
    return new Response(JSON.stringify({ success: false, error: 'not authenticated（登录状态可能已过期，请重新登录）' }), {
      status: 401, headers: cors(),
    });
  }
  if (!auth.isOwner) {
    return new Response(JSON.stringify({
      success: false,
      error: 'forbidden: only repo owner can change config',
      isOwner: false,
      currentUser: auth.username,
    }), { status: 403, headers: cors() });
  }

  let body;
  try { body = await context.request.json(); }
  catch (e) {
    return new Response(JSON.stringify({ success: false, error: 'invalid JSON body' }), {
      status: 400, headers: cors(),
    });
  }

  const patch = (body && body.patch) || (body && body.config);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return new Response(JSON.stringify({ success: false, error: 'patch/config object required' }), {
      status: 400, headers: cors(),
    });
  }

  try {
    // 关键是走 patchAppConfig 而不是整包覆盖：
    // 配置页只认识 repoConfigs/editorFiles/oauth/pr/feedback/autoSync，
    // 整包写上去会把 prices（含千岛采集令牌、抓取进度）抹掉。
    const saved = await patchAppConfig(context.env, patch);
    return new Response(JSON.stringify({
      success: true,
      savedAt: saved._savedAt || null,
      // 回显服务端此刻认定的值，前端直接显示，不用再 GET 一遍去猜
      autoSync: saved.autoSync || null,
    }), { headers: cors() });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e && e.message || 'save failed' }), {
      status: 500, headers: cors(),
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}
