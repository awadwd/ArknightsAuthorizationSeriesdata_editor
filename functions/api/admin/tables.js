// 数据表编辑：列出 / 增删改 kc-data.js 中的业务数据表（owner-only）
//
// 对齐知晓云后台的操作模型：一次"提交"= 一批操作（insert/update/delete），
// 合并成一个 PR 落地，而不是每改一个格子提一次 PR。
//
// GET  /api/admin/tables              读仓库里的 kc-data（编辑器默认数据源）
// GET  /api/admin/tables?live=1       额外拉一份知晓云线上数据（对比"线上 vs 仓库"）
// POST /api/admin/tables              { table, ops:[...], dryRun?, force? }
//                                     也兼容旧格式 { table, rows } / { kcData }
import { verifyRequest } from '../_lib/auth.js';
import {
  KC_TABLES, fetchCurrentKcData, fetchKnowCloudTable, pushKcData, kcStats, stableStringify,
} from '../_lib/kcGen.js';

function cors() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: cors() });
}

function rowId(row) {
  if (!row || typeof row !== 'object') return null;
  return row._id != null ? String(row._id) : (row.id != null ? String(row.id) : null);
}

function newId() {
  // 知晓云 documentId 是 24 位小写 hex，这里生成同形态的 id，避免端上正则校验失败
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

// 知晓云记录普遍带 created_at/updated_at（秒级时间戳）与 read_perm/write_perm
function isKnowCloudShape(rows) {
  const r = (rows || []).find(x => x && typeof x === 'object');
  if (!r) return false;
  return 'created_at' in r || 'read_perm' in r || '_id' in r;
}

function decorate(row, seq, cloudShape) {
  const out = Object.assign({}, row);
  const id = rowId(out) || newId();
  out._id = id;
  out.id = id;
  if (cloudShape) {
    const now = Math.floor(Date.now() / 1000);
    if (!out.created_at) out.created_at = now;
    out.updated_at = now;
    if (!Array.isArray(out.read_perm)) out.read_perm = ['user:anonymous'];
    if (!Array.isArray(out.write_perm)) out.write_perm = [];
  }
  return out;
}

export function applyOps(table, rows, ops) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const cloudShape = isKnowCloudShape(list);
  const log = [];

  for (const raw of ops) {
    const op = raw && raw.op;
    if (!op) continue;
    if (op === 'insert') {
      const row = decorate(raw.row || {}, list.length, cloudShape);
      list.push(row);
      log.push({ op, id: rowId(row), row });
      continue;
    }
    const id = raw.id != null ? String(raw.id) : null;
    const idx = id ? list.findIndex(r => rowId(r) === id) : -1;
    if (op === 'update') {
      if (idx < 0) { log.push({ op, id, error: 'row not found' }); continue; }
      const before = Object.assign({}, list[idx]);
      const after = Object.assign({}, list[idx], raw.fields || {});
      if (cloudShape) after.updated_at = Math.floor(Date.now() / 1000);
      list[idx] = after;
      log.push({ op, id, before, after });
      continue;
    }
    if (op === 'delete') {
      if (idx < 0) { log.push({ op, id, error: 'row not found' }); continue; }
      const [removed] = list.splice(idx, 1);
      log.push({ op, id, row: removed });
      continue;
    }
    if (op === 'replace') {
      if (idx < 0) { log.push({ op, id, error: 'row not found' }); continue; }
      const before = list[idx];
      list[idx] = Object.assign({}, raw.row || {});
      log.push({ op, id, before, after: list[idx] });
      continue;
    }
    log.push({ op, error: 'unknown op' });
  }
  return { rows: list, log };
}

export async function onRequestGet(context) {
  const auth = await verifyRequest(context.request);
  if (!auth) return json({ success: false, error: 'not authenticated' }, 401);
  if (!auth.isOwner) return json({ success: false, error: 'forbidden: only owner' }, 403);

  const cur = await fetchCurrentKcData(auth.token);
  if (!cur) return json({ success: false, error: 'cannot read current kc-data.js' }, 500);

  const url = new URL(context.request.url);
  const out = {
    success: true,
    tables: KC_TABLES,
    data: cur.kcData,
    stats: kcStats(cur.kcData),
    sha: cur.sha,
  };

  if (url.searchParams.get('live') === '1') {
    const live = {};
    const diff = [];
    for (const t of KC_TABLES) {
      const rows = await fetchKnowCloudTable(t);
      if (rows === null) { diff.push({ table: t, status: 'failed' }); continue; }
      live[t] = rows;
      const same = stableStringify(rows) === stableStringify(cur.kcData[t] || []);
      diff.push({ table: t, status: same ? 'same' : 'differs', live: rows.length, repo: (cur.kcData[t] || []).length });
    }
    out.live = live;
    out.diff = diff;
  }

  return json(out);
}

export async function onRequestPost(context) {
  const auth = await verifyRequest(context.request);
  if (!auth) return json({ success: false, error: 'not authenticated' }, 401);
  if (!auth.isOwner) return json({ success: false, error: 'forbidden: only owner' }, 403);

  let body;
  try { body = await context.request.json(); } catch (e) { return json({ success: false, error: 'invalid JSON' }, 400); }

  const cur = await fetchCurrentKcData(auth.token);
  if (!cur) return json({ success: false, error: 'cannot read current kc-data.js' }, 500);

  let kcData = cur.kcData;
  let msg = 'update';
  let log = [];

  if (body && Array.isArray(body.ops) && body.table) {
    // 操作式提交（推荐）：一个 PR 里带上全部增删改
    const applied = applyOps(body.table, kcData[body.table] || [], body.ops);
    kcData[body.table] = applied.rows;
    log = applied.log;
    const bad = log.filter(l => l.error);
    if (bad.length) {
      return json({ success: false, error: 'some ops failed', log }, 400);
    }
    msg = 'edit table ' + body.table + ' (' + log.length + ' ops)';
  } else if (body && body.kcData && typeof body.kcData === 'object') {
    kcData = body.kcData;
    msg = 'update full kc-data';
  } else if (body && body.table && Array.isArray(body.rows)) {
    kcData[body.table] = body.rows;
    msg = 'update table ' + body.table;
  } else {
    return json({ success: false, error: 'need {table, ops} / {table, rows} / {kcData}' }, 400);
  }

  const commitMessage = (body && body.commitMessage) || ('edit: ' + msg + ' @ ' + new Date().toISOString());

  if (body && body.dryRun) {
    return json({ success: true, dryRun: true, log, stats: kcStats(kcData), changed: stableStringify(kcData) !== stableStringify(cur.kcData) });
  }

  try {
    const pr = await pushKcData(auth.token, kcData, commitMessage, { force: !!(body && body.force), env: context.env });
    return json({ success: true, log, prUrl: pr.url, merged: pr.merged, changed: pr.changed, deploy: pr.deploy || null });
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}
