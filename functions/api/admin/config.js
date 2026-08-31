import { getAppConfig, saveAppConfig } from '../_lib/appConfig.js';
import { isOwner } from '../_lib/owner.js';

function cors() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function getAuth(env) {
  try {
    const raw = await env.AUTH_STORE && env.AUTH_STORE.get('current_auth');
    if (!raw) return null;
    const auth = JSON.parse(raw);
    if (auth.expires && auth.expires < Date.now()) {
      await env.AUTH_STORE.delete('current_auth');
      return null;
    }
    return auth;
  } catch (e) {
    return null;
  }
}

// GET /api/admin/config — 公开读（前端初始化需要）
export async function onRequestGet(context) {
  try {
    const cfg = await getAppConfig(context.env);
    return new Response(JSON.stringify({ success: true, config: cfg }), { headers: cors() });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e && e.message || 'read failed' }), {
      status: 500, headers: cors(),
    });
  }
}

// POST /api/admin/config — owner-only 写
export async function onRequestPost(context) {
  const auth = await getAuth(context.env);
  if (!auth) {
    return new Response(JSON.stringify({ success: false, error: 'not authenticated' }), {
      status: 401, headers: cors(),
    });
  }
  const ownerOk = isOwner(auth.username, auth.source);
  if (!ownerOk) {
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

  const cfg = body && body.config;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return new Response(JSON.stringify({ success: false, error: 'config object required' }), {
      status: 400, headers: cors(),
    });
  }

  try {
    await saveAppConfig(context.env, cfg);
    return new Response(JSON.stringify({ success: true }), { headers: cors() });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e && e.message || 'save failed' }), {
      status: 500, headers: cors(),
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}