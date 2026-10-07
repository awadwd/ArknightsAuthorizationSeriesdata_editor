// GET /api/box-data/manifest
//
// 作用：让小程序端用极小代价判断「有没有更新、哪些盒号变了」。
// 只返回每个盒号的短指纹哈希（不返回完整数据），客户端与本地索引比对后，
// 再去 /api/box-data/records 拉变化的记录。
//
// 体积参考：93 个盒号 ≈ 3KB；即使增长到 1000 个盒号也只有约 30KB，
// 相比整包 Box_Id.json（约 158KB 且上游未压缩）是数量级的下降。
//
// 查询参数：
//   ?light=1  只返回版本号与条数，用于「有没有更新」的极速判断

import { loadBoxData, sendJson, corsHeaders } from '../_lib/boxData.js';

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const data = await loadBoxData();
  if (!data) {
    return sendJson(
      {
        ok: false,
        error: 'upstream_unavailable',
        message: '上游数据源暂时不可用，请改用完整包下载'
      },
      503,
      0
    );
  }

  const url = new URL(request.url);
  if (url.searchParams.get('light') === '1') {
    return sendJson(
      { ok: true, version: data.version, count: data.count, generatedAt: data.generatedAt },
      200,
      60
    );
  }

  return sendJson(
    {
      ok: true,
      version: data.version,
      count: data.count,
      generatedAt: data.generatedAt,
      items: data.items
    },
    200,
    60
  );
}
