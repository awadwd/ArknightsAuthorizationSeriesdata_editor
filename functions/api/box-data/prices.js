// GET /api/box-data/prices
// GET /api/box-data/prices?ids=1.0,2.0
//
// 千岛第三方市价（Price_Meta.json 的 prices），按盒号分层：
//   { "1.0": { "阿米娅": { "ELITE1": 432.5, "ELITE2": 384.33 } }, ... }
//
// 为什么要这个接口：Price_Meta.json 放在 GitHub 上，客户端直连 jsDelivr 会吃到
// 分支名 12 小时缓存，价格改了要等半天。走这里只有 5 分钟边缘缓存。
//
// 查询参数：
//   ids  可选，逗号分隔的盒号；不传就返回整表（约 15KB / gzip 5KB）

import { loadPriceMeta, sendJson, corsHeaders } from '../_lib/boxData.js';

const MAX_IDS = 500;

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const meta = await loadPriceMeta();
  if (!meta) {
    return sendJson(
      { ok: false, error: 'price_meta_unavailable', message: '千岛价暂时取不到，请用参考价兜底' },
      503,
      0
    );
  }

  const url = new URL(request.url);
  const raw = (url.searchParams.get('ids') || '').trim();
  const head = {
    ok: true,
    version: meta.version,
    priceUpdatedAt: meta.at,
    count: meta.boxes,
    priceKind: 'third-party-reference',
    refField: 'market_price'   // Box_Id.json 里那一份是社区参考价，两条线并行
  };

  if (!raw) {
    return sendJson({ ...head, prices: meta.prices }, 200, 60);
  }

  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length > MAX_IDS) {
    return sendJson(
      { ok: false, error: 'too_many_ids', message: `单次最多 ${MAX_IDS} 个盒号`, max: MAX_IDS },
      400,
      0
    );
  }

  const prices = {};
  const missing = [];
  for (const id of ids) {
    if (meta.prices[id]) prices[id] = meta.prices[id];
    else missing.push(id);
  }

  return sendJson({ ...head, count: Object.keys(prices).length, prices, missing }, 200, 60);
}
