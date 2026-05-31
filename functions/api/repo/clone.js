// Cloudflare Pages Function - Clone/Check Repo
const REPO_CONFIG = {
  github: {
    owner: 'awadwd',
    repo: 'ArknightsAuthorization_Series-mirror',
    branch: 'dev',
    apiBase: 'https://api.github.com',
  },
  gitcode: {
    owner: 'huangjinzhou1',
    repo: 'ArknightsAuthorization_Series',
    branch: 'dev',
    apiBase: 'https://gitcode.com/api/v5',
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
  const { env } = context;
  
  const auth = await getAuth(env);
  if (!auth || !auth.authenticated) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const source = auth.source || 'github';
  const config = REPO_CONFIG[source] || REPO_CONFIG.github;

  try {
    let res;
    if (source === 'gitcode') {
      // GitCode: GET /api/v5/projects/{owner}%2F{repo}
      const projectId = `${config.owner}%2F${config.repo}`;
      res = await fetch(`${config.apiBase}/projects/${projectId}`, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Accept': 'application/json',
        },
      });
    } else {
      // GitHub
      res = await fetch(`${config.apiBase}/repos/${config.owner}/${config.repo}`, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'User-Agent': 'Arknights-Tool',
        },
      });
    }

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
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
