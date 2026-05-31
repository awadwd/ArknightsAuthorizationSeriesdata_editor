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
      // GitCode = GitLab 系：用 API v4 获取 raw 文件
      // fetch() 不会解码路径中的 %2F，所以只用单次编码
      const config = REPO_CONFIG.gitcode;
      const projectId = `${config.owner}%2F${config.repo}`;
      const encodedFile = encodeURIComponent(filename);
      const apiUrl = `https://gitcode.com/api/v4/projects/${projectId}/repository/files/${encodedFile}/raw?ref=${config.branch}`;

      const res = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Accept': '*/*',
        },
        redirect: 'manual',  // 不自动跟随重定向，方便调试
      });

      // 如果是 302 重定向，返回重定向地址方便调试
      if (res.status === 302 || res.status === 301) {
        const location = res.headers.get('Location');
        return new Response(JSON.stringify({
          error: 'Redirect (likely auth failure)',
          status: res.status,
          redirectTo: location,
          apiUrl,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return new Response(JSON.stringify({
          error: 'File not found',
          status: res.status,
          detail: errText.slice(0, 500),
          apiUrl,
          authSource: auth.source,
        }), {
          status: res.status === 404 ? 404 : 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      content = await res.text();

    } else {
      // GitHub: raw.githubusercontent.com
      const config = REPO_CONFIG.github;
      const rawUrl = `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/${filename}`;

      const fetchOptions = {
        headers: {
          'User-Agent': 'Arknights-Tool',
          'Cache-Control': 'no-cache',
        },
      };

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
