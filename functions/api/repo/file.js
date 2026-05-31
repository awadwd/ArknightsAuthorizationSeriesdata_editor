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

// GitCode 项目 ID 必须双重编码 %252F → fetch 解码后剩 %2F
function gitcodeProjectId(owner, repo) {
  return `${owner}%252F${repo}`;
}

// GitCode 用 Authorization: Bearer (OAuth token), GitHub 同理
function authHeaders(token, source) {
  const bearer = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
  if (source === 'github') bearer['User-Agent'] = 'Arknights-Tool';
  return bearer;
}

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
      // GitCode 是 GitLab 系，raw URL 必须加 /-/
      const config = REPO_CONFIG.gitcode;
      const rawUrl = `https://gitcode.com/${config.owner}/${config.repo}/-/raw/${config.branch}/${filename}`;

      const res = await fetch(rawUrl, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Accept': '*/*',
        },
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return new Response(JSON.stringify({
          error: 'File not found',
          status: res.status,
          detail: errText.slice(0, 500),
          requestUrl: rawUrl,
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
