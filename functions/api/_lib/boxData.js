// 盒号数据共享加载层
//
// 被 /api/box-data/manifest 与 /api/box-data/records 共用：
// 拉一次上游 JSON → 建「盒号 → 记录 + 指纹哈希」索引 → 边缘节点内缓存 5 分钟。
//
// 这样客户端可以用极小代价判断差异（manifest），
// 再只取变化的记录（records），避免每次更新都整包重下（约 158KB 且上游未压缩）。

// 数据源优先级。踩过的两个坑都记在这里：
//
// 坑① 以前把 gitcode 排第一，结果 mirror 仓合并了市价分层改造，gitcode 还停在旧数据，
//     客户端拿到的「参考价」其实是千岛价，代码改对了也看不到任何效果。
// 坑② jsDelivr 的 cdn.jsdelivr.net 对 @main 有约 12 小时缓存，而且加 ?v= 也绕不过去；
//     但同一个文件走 fastly.jsdelivr.net / gcore.jsdelivr.net 往往已经刷新了。
//
// 所以顺序是：Raw（实时）→ fastly CDN（多数情况比 cdn 新）→ gitcode 源仓 → cdn 兜底。
export const UPSTREAM_MIRROR =
  'https://raw.githubusercontent.com/awadwd/ArknightsAuthorization_Series-mirror/main/Box_Id.json';
export const UPSTREAM_FASTLY =
  'https://fastly.jsdelivr.net/gh/awadwd/ArknightsAuthorization_Series-mirror@main/Box_Id.json';
export const UPSTREAM =
  'https://raw.gitcode.com/huangjinzhou1/ArknightsAuthorization_Series/raw/main/Box_Id.json';
export const UPSTREAM_CDN =
  'https://cdn.jsdelivr.net/gh/awadwd/ArknightsAuthorization_Series-mirror@main/Box_Id.json';

const BOX_UPSTREAMS = [UPSTREAM_MIRROR, UPSTREAM_FASTLY, UPSTREAM, UPSTREAM_CDN];

// 千岛第三方市价：单独一个文件，和 Box_Id.json 的参考价并行
export const PRICE_META_URLS = [
  'https://raw.githubusercontent.com/awadwd/ArknightsAuthorization_Series-mirror/main/Price_Meta.json',
  'https://fastly.jsdelivr.net/gh/awadwd/ArknightsAuthorization_Series-mirror@main/Price_Meta.json',
  'https://raw.gitcode.com/huangjinzhou1/ArknightsAuthorization_Series/raw/main/Price_Meta.json',
  'https://cdn.jsdelivr.net/gh/awadwd/ArknightsAuthorization_Series-mirror@main/Price_Meta.json',
];

// 上次成功的源排到最前面。国内网络对 raw.githubusercontent 经常连不上，
// 不记住的话每次冷启动都要先失败一次（实测能多花 20 秒）。
let _goodBoxUrl = null;
let _goodPmUrl = null;

function orderedUrls(list, good) {
  if (!good || list.indexOf(good) <= 0) return list;
  return [good].concat(list.filter(u => u !== good));
}

async function fetchFirstOk(list, good, validate) {
  for (const url of orderedUrls(list, good)) {
    const data = await fetchJson(url);
    if (validate(data)) return { url, data };
  }
  return { url: null, data: null };
}

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
  // market_priceUpdateTime 是「市价核对时间」，一个月才动一次；把它算进指纹会让
  // 客户端因为「只是记了个时间」就整包重下 158KB。
  const skip = {
    updatedAt: 1, updateTime: 1, lastModified: 1,
    market_priceUpdateTime: 1, market_priceUpdatetime: 1, market_price_update_time: 1, marketPriceUpdateTime: 1,
  };
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

  const picked = await fetchFirstOk(BOX_UPSTREAMS, _goodBoxUrl, Array.isArray);
  let raw = picked.data;
  if (picked.url) _goodBoxUrl = picked.url;
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

// ── 千岛第三方市价（Price_Meta.json）─────────────────────────────────────────
// 这个文件里有两样东西：market_priceUpdateTime（整轮核对时间）和 prices（按盒号分层的价）。
// 客户端以前自己去 CDN 拉，但 jsDelivr 对 @main 有 12 小时缓存，价格改完半天看不到；
// 走服务端就只受这里的 5 分钟缓存控制，而且顺带能算出 prices 的指纹给客户端做差异判断。
let _pmCache = { at: 0, data: null };

export async function loadPriceMeta() {
  const now = Date.now();
  if (_pmCache.data && now - _pmCache.at < TTL_MS) return _pmCache.data;

  const picked = await fetchFirstOk(PRICE_META_URLS, _goodPmUrl,
    (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !!v.market_priceUpdateTime);
  const raw = picked.data;
  if (raw) {
    if (picked.url) _goodPmUrl = picked.url;
    const prices = raw.prices && typeof raw.prices === 'object' && !Array.isArray(raw.prices) ? raw.prices : {};
    const at = raw.market_priceUpdateTime || raw.market_priceUpdatetime ||
      raw.market_price_update_time || raw.marketPriceUpdateTime || null;
    const data = {
      at: at ? String(at) : null,
      prices,
      boxes: Object.keys(prices).length,
      // 价格表指纹：客户端拿到它就知道要不要重拉整表（核对时间变了但价没变时不必重拉）
      version: hash(JSON.stringify(prices)),
    };
    _pmCache = { at: now, data };
    return data;
  }
  return _pmCache.data || null;
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
