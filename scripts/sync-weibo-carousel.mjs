// 轮播图数据源链：微博 API -> 知晓云 -> 报错
// 1) 默认：微博 getFocusPic（需 GitHub Secret WEIBO_COOKIE，约 30 天过期需人工更新）
// 2) 失败：回退知晓云 choearth_notice 表（原有人工维护数据）
// 3) 都失败：抛错（GitHub Action 显示失败，kc-data.js 保留上一次内容，不commit）
// 被 scripts/sync-knowcloud.mjs 在生成 kc-data.js 时对 choearth_notice 表调用。
import { fetchKnowCloudTable } from '../functions/api/_lib/kcGen.js';

const WEIBO_UID = '6441489862'; // 明日方舟官方微博
const WEIBO_PROFILE_URL = `https://weibo.com/u/${WEIBO_UID}`;
const WEIBO_API = `https://weibo.com/ajax/profile/getFocusPic?uid=${WEIBO_UID}`;
const MAX_ITEMS = 10; // 小程序端 limit=10

function xsrfFromCookie(cookie) {
  const m = (cookie || '').match(/XSRF-TOKEN=([^;]+)/);
  return m ? m[1] : '';
}

// 微博缩略图 -> 大图：/orj480/、/thumb180/、/mw2000/ 等段替换为 /large/
function toLargeUrl(pic) {
  const raw = (pic && (pic.url || (pic.large && pic.large.url))) || '';
  if (raw) {
    return raw.replace(/\/(thumb\d+|orj\d+|mw\d+|small|bmiddle)\//, '/large/');
  }
  if (pic && pic.pid) return `https://wx1.sinaimg.cn/large/${pic.pid}.jpg`;
  return '';
}

function toRow(pic, index) {
  const imageurl = toLargeUrl(pic);
  const pid = pic.pid || pic.mid || `idx${index}`;
  // created_at 尽量取微博图片自带时间，取不到用 0（保证同一张图每次生成的 _id/时间戳稳定，避免 commit 抖动）
  let createdAt = 0;
  if (pic.created_at) {
    const t = Date.parse(pic.created_at);
    if (!Number.isNaN(t)) createdAt = Math.floor(t / 1000);
  }
  return {
    _id: 'wb-' + pid,
    id: 'wb-' + pid,
    created_at: createdAt,
    updated_at: createdAt,
    imageurl,
    linkUrl: WEIBO_PROFILE_URL,
    title: '',
    read_perm: ['user:anonymous'],
    write_perm: ['user:anonymous']
  };
}

async function fetchFromWeibo() {
  const cookie = process.env.WEIBO_COOKIE;
  if (!cookie) throw new Error('WEIBO_COOKIE 未配置（GitHub Secrets）');
  const headers = {
    'Cookie': cookie,
    'Referer': WEIBO_PROFILE_URL,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest'
  };
  const xsrf = xsrfFromCookie(cookie);
  if (xsrf) headers['x-xsrf-token'] = xsrf;

  const res = await fetch(WEIBO_API, { headers });
  if (!res.ok) throw new Error(`weibo api http ${res.status}`);
  const json = await res.json();
  // 接口为非官方，字段结构可能变化，做多形状兼容
  const pics = (json && json.data && (json.data.pics || json.data.list)) || [];
  if (!Array.isArray(pics) || pics.length === 0) {
    throw new Error('weibo pics 为空（可能 Cookie 过期或接口改版）');
  }
  const rows = pics
    .slice(0, MAX_ITEMS)
    .map(toRow)
    .filter((r) => r.imageurl);
  if (rows.length === 0) throw new Error('weibo pics 解析不到图片 URL');
  return rows;
}

// 对外入口：微博 -> 知晓云 -> 抛错
export async function fetchCarouselRows() {
  try {
    const rows = await fetchFromWeibo();
    return { source: 'weibo', rows };
  } catch (weiboErr) {
    console.warn('[carousel] 微博源失败，回退知晓云:', weiboErr.message);
    const rows = await fetchKnowCloudTable('choearth_notice');
    if (Array.isArray(rows) && rows.length > 0) {
      return { source: 'knowcloud', rows };
    }
    throw new Error(`轮播图两个数据源均失败（weibo: ${weiboErr.message}; knowcloud: 无数据）`);
  }
}
