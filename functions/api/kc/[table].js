// 自建 API：替代知晓云的数据表读接口
import { KC_DATA } from "./kcData.js";

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

async function fallbackToKnowCloud(table) {
  try {
    const resp = await fetch(`${KNOW_CLOUD_BASE}/table/${encodeURIComponent(table)}/record/`, {
      method: "GET",
      headers: {
        "X-Hydrogen-Client-ID": KNOW_CLOUD_CLIENT_ID,
        "Content-Type": "application/json"
      }
    });
    if (resp.status === 200) {
      const text = await resp.text();
      return new Response(text, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store"
        }
      });
    }
  } catch (e) {}
  return sendJson({ objects: [] }, 200);
}

export async function onRequest(context) {
  const slug = context.params.slug;
  if (!slug || !Array.isArray(slug) || slug.length === 0) {
    return sendJson({ objects: [], error: "missing slug" }, 400);
  }
  // slug = ["api", "kc", "Version"] -> table = "Version"
  // /api/kc/Version -> slug=["api","kc","Version"]
  // /api/test -> slug=["api","test"]
  // /kc/Version -> slug=["kc","Version"]
  const pathStr = slug.join("/");

  // 路由: /api/kc/{table}
  if (slug[0] === "api" && slug[1] === "kc" && slug.length >= 3) {
    const table = slug[2];
    const rows = KC_DATA[table];
    if (rows && Array.isArray(rows)) {
      const result = applyQuery(rows, context.request.url);
      return sendJson({ objects: result });
    }
    return await fallbackToKnowCloud(table);
  }

  // 未匹配: 返回测试信息
  return new Response(JSON.stringify({
    ok: true,
    method: "top-level-catchall",
    slug: slug,
    pathStr: pathStr,
    url: context.request.url
  }), {
    headers: {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
  });
}
