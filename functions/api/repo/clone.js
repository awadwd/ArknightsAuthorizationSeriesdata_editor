// Cloudflare Pages Function - Clone/Check Repo
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
  const authData = await env.AUTH_STORE?.get('current_auth');
  if (!authData) return null;
  const auth = JSON.parse(authData);
  if (auth.expires && auth.expires < Date.now()) {
    await env.AUTH_STORE?.delete('current_auth');
    return null;
  }
  return auth;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await getAuth(env);
  if (!auth || !auth.authenticated) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // source 优先从请求体取，fallback 到 auth.source
  let body = {};
  try { body = await request.json(); } catch {}
  const source = body.source || auth.source || 'github';
  const config = REPO_CONFIG[source] || REPO_CONFIG.github;

  try {
    if (source === 'gitcode') {
      const config = REPO_CONFIG.gitcode;
      // 双重编码 project ID，fetch() 解码一次后剩 %2F
      const projectId = `${config.owner}%252F${config.repo}`;
      const apiUrl = `https://gitcode.com/api/v5/projects/${projectId}`;

      const res = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Accept': 'application/json',
        },
      });

      if (res.ok) {
        const proj = await res.json();
        return new Response(JSON.stringify({
          success: true,
          message: `GitCode 仓库可访问: ${proj.path_with_namespace || proj.name}`,
          source,
          projectId: proj.id,
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        const errText = await res.text().catch(() => '');
        return new Response(JSON.stringify({
          success: false,
          error: `GitCode 仓库不可访问 (${res.status}): ${errText.slice(0, 300)}`,
          apiUrl,
        }), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      // GitHub
      const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}`, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'User-Agent': 'Arknights-Tool',
        },
      });

      if (res.ok) {
        return new Response(JSON.stringify({ success: true, message: 'Repository accessible', source }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        const err = await res.json().catch(() => ({}));
        return new Response(JSON.stringify({ success: false, error: err.message || `Status ${res.status}` }), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
