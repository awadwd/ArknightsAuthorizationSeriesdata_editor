// GET /api/box-data/records?ids=1.0,2.0,3.0
//
// 按盒号批量取完整记录 —— 客户端比对 manifest 差异后，只来拉「新增 / 修改」的那几条，
// 而不是整包重下。典型更新只涉及个位数盒号，传输量从约 158KB 降到几 KB。
//
// 查询参数：
//   ids  逗号分隔的盒号列表（Box_id 字段值），单次上限 500 个
//   all=1  不传 ids 时整包下发（客户端首次安装用）
//
// 返回：
//   { ok, version, count, records: { [盒号]: 记录 }, missing: [未找到的盒号] }

import { loadBoxData, sendJson, corsHeaders } from '../_lib/boxData.js';

const MAX_IDS = 500;

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const data = await loadBoxData();
  if (!data) {
    return sendJson(
      { ok: false, error: 'upstream_unavailable', message: '上游数据源暂时不可用' },
      503,
      0
    );
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get('ids') || '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!ids.length) {
    // all=1：整包下发。客户端首次安装 / 本地缓存缺失时用，避免它去撞 gitcode
    // 那些还没同步新数据的第三方源。
    if (url.searchParams.get('all') === '1') {
      return sendJson(
        { ok: true, version: data.version, count: data.count, records: data.records },
        200,
        60
      );
    }
    return sendJson({ ok: false, error: 'missing_ids', message: '缺少 ids 参数' }, 400, 0);
  }
  if (ids.length > MAX_IDS) {
    return sendJson(
      { ok: false, error: 'too_many_ids', message: `单次最多 ${MAX_IDS} 个盒号，请分批请求`, max: MAX_IDS },
      400,
      0
    );
  }

  const records = {};
  const missing = [];
  for (const id of ids) {
    if (data.records[id]) {
      records[id] = data.records[id];
    } else {
      missing.push(id);
    }
  }

  return sendJson(
    { ok: true, version: data.version, count: Object.keys(records).length, records, missing },
    200,
    60
  );
}
