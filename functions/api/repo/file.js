// Cloudflare Pages Function - Get File Content
// Route: /api/repo/file?filename=xxx&source=github|gitcode

const REPO_CONFIG = {
  github: {
    owner: 'awadwd',
    repo: 'ArknightsAuthorization_Series-mirror',
    branch: 'dev',
    rawUrl: (owner, repo, branch, filename) =>
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filename}`
  },
  gitcode: {
    owner: 'huangjinzhou1',
    repo: 'ArknightsAuthorization_Series',
    branch: 'dev',
    // GitCode raw 文件 URL（公开仓库无需认证）
    rawUrl: (owner, repo, branch, filename) =>
      `https://gitcode.com/${owner}/${repo}/raw/branch/${branch}/${filename}`
  }
};

async function getAuth(env) {
  try {
    const authData = await env.AUTH_STORE?.get('current_auth');
    if (!authData) return null;
    const auth = JSON.parse(authData);
    if (auth.expires && auth.expires < Date.now()) {
      await env.AUTH_STORE?.delete('current_auth');
      return null;
    }
    return auth;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  const auth = await getAuth(env);
  if (!auth || !auth.authenticated) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const url = new URL(request.url);
  const filename = url.searchParams.get('filename');
  const source = url.searchParams.get('source') || auth.source || 'github';

  if (!filename) {
    return new Response(JSON.stringify({ error: 'Missing filename' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const config = REPO_CONFIG[source] || REPO_CONFIG.github;
  const rawUrl = config.rawUrl(config.owner, config.repo, config.branch, filename);

  try {
    // 公开仓库直接拉 raw 文件，无需 API Token
    // 私有仓库才需要 Bearer token
    const fetchOptions = {
      headers: {
        'User-Agent': 'Arknights-Tool',
        'Cache-Control': 'no-cache',
      },
    };

    // 如果是 GitHub 且 Token 有效，带上以绕过 rate limit
    if (source === 'github' && auth.token) {
      fetchOptions.headers['Authorization'] = `Bearer ${auth.token}`;
    }

    const res = await fetch(rawUrl + `?t=${Date.now()}`, fetchOptions);

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'File not found', status: res.status }), {
        status: res.status === 404 ? 404 : 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const content = await res.text();

    return new Response(JSON.stringify({ content }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
