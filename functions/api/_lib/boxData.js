// 盒号数据共享加载层
//
// 被 /api/box-data/manifest 与 /api/box-data/records 共用：
// 拉一次上游 JSON → 建「盒号 → 记录 + 指纹哈希」索引 → 边缘节点内缓存 5 分钟。
//
// 这样客户端可以用极小代价判断差异（manifest），
// 再只取变化的记录（records），避免每次更新都整包重下（约 158KB 且上游未压缩）。

export const UPSTREAM =
  'https://raw.gitcode.com/huangjinzhou1/ArknightsAuthorization_Series/raw/main/Box_Id.json';
export const UPSTREAM_MIRROR =
  'https://cdn.jsdelivr.net/gh/awadwd/ArknightsAuthorization_Series-mirror@main/Box_Id.json';

const TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT = 12000;

// FNV-1a → 8 位十六进制。用于比对，不用于安全用途。
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

// 指纹：只取影响展示与搜索的字段，剔除时间戳类字段，避免无意义的版本抖动
export function fingerprint(box) {
  const skip = { updatedAt: 1, updateTime: 1, lastModified: 1 };
  const keys = Object.keys(box).filter((k) => !skip[k]).sort();
  const parts = [];
  for (const k of keys) {
    const v = box[k];
    if (v === null || v === undefined) {
      parts.push(k + ':');
    } else if (typeof v === 'object') {
      parts.push(k + ':' + JSON.stringify(v));
    } else {
      parts.push(k + ':' + v);
    }
  }
  return parts.join('|');
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'arknights-passport-sync/1.0', Accept: 'application/json' }
    });
    if (!res.ok) return null;
    return JSON.parse(await res.text());
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let _cache = { at: 0, data: null };

/**
 * 加载并索引盒号数据
 * @returns {{version:string,count:number,generatedAt:string,items:Array<[string,string]>,records:Object}|null}
 */
export async function loadBoxData() {
  const now = Date.now();
  if (_cache.data && now - _cache.at < TTL_MS) {
    return _cache.data;
  }

  let raw = await fetchJson(UPSTREAM);
  if (!Array.isArray(raw)) {
    raw = await fetchJson(UPSTREAM_MIRROR);
  }
  if (!Array.isArray(raw)) {
    // 拉了但失败：旧缓存还可用就继续用，避免上游抖动导致接口整体不可用
    return _cache.data || null;
  }

  const records = {};
  const items = [];
  for (const box of raw) {
    if (!box || typeof box !== 'object') continue;
    const id = String(box.Box_id || '').trim();
    if (!id) continue;
    records[id] = box;
    items.push([id, hash(fingerprint(box))]);
  }
  items.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const version = hash(items.map((it) => it[0] + ':' + it[1]).join(','));

  _cache = {
    at: now,
    data: {
      version,
      count: items.length,
      generatedAt: new Date(now).toISOString(),
      items,
      records
    }
  };
  return _cache.data;
}

export function corsHeaders(methods = 'GET, OPTIONS') {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

export function sendJson(data, status = 200, maxAge = 60) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}`,
      ...corsHeaders()
    }
  });
}
