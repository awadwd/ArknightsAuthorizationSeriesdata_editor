// Cloudflare Pages Function - GitHub 仓库开源贡献数据
// GET /api/github-stats?repo=owner/name
// 服务端聚合 GitHub API（仓库信息/提交数/贡献者），边缘缓存 30 分钟；
// 贡献者头像改写为自身 proxy-image 代理，国内小程序加载更稳。
// 可选：在 Pages 环境变量配置 GITHUB_TOKEN 以提升 API 限额（60/h -> 5000/h）。

const CACHE_TTL = 1800; // 30 分钟
const CONTRIB_LIMIT = 8; // 返回的贡献者头像数量

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders
    }
  });
}

// per_page=1 时，Link 响应头里 rel="last" 的页码即总条数
function parseLastPage(linkHeader) {
  if (!linkHeader) return 1;
  const m = linkHeader.match(/page=(\d+)>;\s*rel="last"/);
  return m ? Number(m[1]) : 1;
}

async function ghFetch(url, token) {
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'arknights-tool-cf' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRepoStats(fullName, origin, token) {
  const base = `https://api.github.com/repos/${fullName}`;
  const [infoRes, commitsRes, contribCountRes, contribListRes] = await Promise.all([
    ghFetch(base, token),
    ghFetch(base + '/commits?per_page=1', token),
    ghFetch(base + '/contributors?per_page=1&anon=1', token),
    ghFetch(base + `/contributors?per_page=${CONTRIB_LIMIT}`, token)
  ]);

  if (!infoRes.ok) {
    throw new Error(`github repo api ${infoRes.status}`);
  }
  const info = await infoRes.json();

  // 贡献者头像列表（真实账号）
  let contribList = [];
  if (contribListRes.ok) {
    const list = await contribListRes.json();
    if (Array.isArray(list)) {
      contribList = list
        .filter((c) => c && c.login)
        .map((c) => ({
          login: c.login,
          // 头像走自身代理（proxy-image 已允许 avatars.githubusercontent.com，并带 24h 边缘缓存）
          avatar: `${origin}/api/proxy-image?url=${encodeURIComponent(c.avatar_url || '')}`,
          count: c.contributions || 0
        }));
    }
  }

  return {
    repo: fullName,
    stars: info.stargazers_count || 0,
    forks: info.forks_count || 0,
    commits: parseLastPage(commitsRes.headers.get('link')),
    contributors: parseLastPage(contribCountRes.headers.get('link')),
    contribList,
    updatedAt: Date.now()
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = url.origin;
  const repo = url.searchParams.get('repo');

  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return json({ error: 'Missing or invalid repo param, expected owner/name' }, 400);
  }

  // 边缘缓存：以完整 URL 为 key，命中直接返回
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  try {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  } catch (e) { /* 缓存不可用时直连 */ }

  try {
    const data = await fetchRepoStats(repo, origin, env.GITHUB_TOKEN);
    const res = json(data, 200, { 'Cache-Control': `public, max-age=${CACHE_TTL}` });
    try {
      context.waitUntil(cache.put(cacheKey, res.clone()));
    } catch (e) { /* 写缓存失败不影响返回 */ }
    return res;
  } catch (err) {
    return json({ error: 'upstream failed', detail: String(err && err.message || err) }, 502);
  }
}
