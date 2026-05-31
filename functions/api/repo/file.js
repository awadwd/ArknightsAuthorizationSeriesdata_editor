// Cloudflare Pages Function - Get File Content
// Route: /api/repo/file?filename=xxx&source=github|gitcode

const REPO_CONFIG = {
  github: {
    owner: 'awadwd',
    repo: 'ArknightsAuthorization_Series-mirror',
    branch: 'dev',
  },
  gitcode: {
    owner: 'huangjinzhou1',
    repo: 'ArknightsAuthorization_Series',
    branch: 'dev',
    // GitCode = GitLab API，项目 ID 需要编码为 owner%2Frepo
    apiBase: 'https://gitcode.com/api/v5',
    projectId: (owner, repo) => encodeURIComponent(`${owner}/${repo}`),
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

  try {
    let content;

    if (source === 'gitcode') {
      // GitCode: 用 API 获取文件原始内容（需要认证）
      const config = REPO_CONFIG.gitcode;
      const projectId = config.projectId(config.owner, config.repo);
      const fileApiUrl = `${config.apiBase}/projects/${projectId}/repository/files/${encodeURIComponent(filename)}/raw?ref=${config.branch}`;

      const res = await fetch(fileApiUrl, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Accept': '*/*',
        },
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return new Response(JSON.stringify({ error: 'File not found', status: res.status, detail: errText.slice(0, 200) }), {
          status: res.status === 404 ? 404 : 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      content = await res.text();

    } else {
      // GitHub: 用 raw.githubusercontent.com（公开仓库无需 Token，避免 rate limit）
      const config = REPO_CONFIG.github;
      const rawUrl = `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/${filename}`;

      const fetchOptions = {
        headers: {
          'User-Agent': 'Arknights-Tool',
          'Cache-Control': 'no-cache',
        },
      };

      // 带 Token 以避免匿名 rate limit
      if (auth.token) {
        fetchOptions.headers['Authorization'] = `Bearer ${auth.token}`;
      }

      const res = await fetch(rawUrl + `?t=${Date.now()}`, fetchOptions);

      if (!res.ok) {
        return new Response(JSON.stringify({ error: 'File not found', status: res.status }), {
          status: res.status === 404 ? 404 : 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      content = await res.text();
    }

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
