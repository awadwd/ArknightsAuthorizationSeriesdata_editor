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
      // GitCode (GitLab): OAuth access_token 用 Authorization: Bearer
      // PRIVATE-TOKEN 只接受 PAT，不接受 OAuth token
      const res = await fetch('https://gitcode.com/api/v5/user', {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Accept': 'application/json',
        },
      });

      if (res.ok) {
        const userData = await res.json();
        return new Response(JSON.stringify({
          success: true,
          message: `GitCode 认证成功: ${userData.username || userData.login || userData.name}`,
          source
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        const errText = await res.text().catch(() => '');
        return new Response(JSON.stringify({
          success: false,
          error: `GitCode 认证失败 (${res.status}): ${errText.slice(0, 200)}`
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
