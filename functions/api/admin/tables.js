// 数据表编辑：列出 / 修改 kc-data.js 中的业务数据表（owner-only）
import { verifyRequest } from '../_lib/auth.js';
import { KC_TABLES, fetchCurrentKcData, pushKcData } from '../_lib/kcGen.js';

function cors() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function onRequestGet(context) {
  const auth = await verifyRequest(context.request);
  if (!auth) {
    return new Response(JSON.stringify({ success: false, error: 'not authenticated' }), { status: 401, headers: cors() });
  }
  if (!auth.isOwner) {
    return new Response(JSON.stringify({ success: false, error: 'forbidden: only owner' }), { status: 403, headers: cors() });
  }
  const cur = await fetchCurrentKcData(auth.token);
  if (!cur) {
    return new Response(JSON.stringify({ success: false, error: 'cannot read current kc-data.js' }), { status: 500, headers: cors() });
  }
  return new Response(JSON.stringify({ success: true, tables: KC_TABLES, data: cur.kcData }), { headers: cors() });
}

export async function onRequestPost(context) {
  const auth = await verifyRequest(context.request);
  if (!auth) {
    return new Response(JSON.stringify({ success: false, error: 'not authenticated' }), { status: 401, headers: cors() });
  }
  if (!auth.isOwner) {
    return new Response(JSON.stringify({ success: false, error: 'forbidden: only owner' }), { status: 403, headers: cors() });
  }

  let body;
  try { body = await context.request.json(); } catch (e) {
    return new Response(JSON.stringify({ success: false, error: 'invalid JSON' }), { status: 400, headers: cors() });
  }

  const cur = await fetchCurrentKcData(auth.token);
  if (!cur) {
    return new Response(JSON.stringify({ success: false, error: 'cannot read current kc-data.js' }), { status: 500, headers: cors() });
  }

  let kcData = cur.kcData;
  let msg = 'update';

  if (body && body.kcData && typeof body.kcData === 'object') {
    // 全量替换
    kcData = body.kcData;
    msg = 'update full kc-data';
  } else if (body && body.table && Array.isArray(body.rows)) {
    // 单表替换
    kcData[body.table] = body.rows;
    msg = 'update table ' + body.table;
  } else {
    return new Response(JSON.stringify({ success: false, error: 'need {table, rows} or {kcData}' }), { status: 400, headers: cors() });
  }

  try {
    const pr = await pushKcData(auth.token, kcData, 'edit: ' + msg + ' @ ' + new Date().toISOString());
    return new Response(JSON.stringify({ success: true, prUrl: pr.url, merged: pr.merged }), { headers: cors() });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: cors() });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}
