// 自建 API：替代知晓云的数据表读接口
// 路由：/api/kc/{table}?limit=&offset=&order_by=-created_at
// 返回结构与知晓云一致：{ objects: [...] }
// 数据优先取自 CSV 导出的 KC_DATA；缺失时服务端回落知晓云。
import { KC_DATA, KC_TABLES } from "./kcData.js";

// 知晓云回落配置（仅在 KC_DATA 缺表或服务异常时使用）
const KNOW_CLOUD_BASE = "https://21680db9b1362913357c.myminapp.com/hserve/v2.2";
const KNOW_CLOUD_CLIENT_ID = "21680db9b1362913357c";

function sendJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60"
    }
  });
}

// 按查询参数排序/分页
function applyQuery(rows, url) {
  const params = new URL(url).searchParams;
  const orderBy = params.get("order_by");
  let result = rows.slice();
  if (orderBy) {
    const desc = orderBy.startsWith("-");
    const field = desc ? orderBy.slice(1) : orderBy;
    result.sort((a, b) => {
      const av = Number(a[field]);
      const bv = Number(b[field]);
      if (!isNaN(av) && !isNaN(bv)) {
        return desc ? bv - av : av - bv;
      }
      const as = String(a[field] || "");
      const bs = String(b[field] || "");
      return desc ? bs.localeCompare(as) : as.localeCompare(bs);
    });
  }
  const offset = parseInt(params.get("offset") || "0", 10) || 0;
  const limit = parseInt(params.get("limit") || "0", 10) || 0;
  if (offset) result = result.slice(offset);
  if (limit) result = result.slice(0, limit);
  return result;
}

// 服务端回落到知晓云（作为兜底，避免自建数据缺失时小程序取不到数据）
async function fallbackToKnowCloud(table, url) {
  try {
    const target = `${KNOW_CLOUD_BASE}/table/${encodeURIComponent(table)}/record/${new URL(url).search}`;
    const resp = await fetch(target, {
      method: "GET",
      headers: {
        "X-Hydrogen-Client-ID": KNOW_CLOUD_CLIENT_ID,
        "Content-Type": "application/json"
      }
    });
    const text = await resp.text();
    if (resp.status === 200 && text) {
      return new Response(text, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store"
        }
      });
    }
  } catch (e) {
    // 忽略，下面返回空
  }
  return sendJson({ objects: [] }, 200);
}

export async function onRequest(context) {
  const table = context.params.table;
  const url = context.request.url;

  if (!table) {
    return sendJson({ objects: [], error: "missing table" }, 400);
  }

  const rows = KC_DATA[table];
  if (rows && Array.isArray(rows)) {
    const result = applyQuery(rows, url);
    return sendJson({ objects: result });
  }

  // 未知表：服务端回落知晓云
  return await fallbackToKnowCloud(table, url);
}
