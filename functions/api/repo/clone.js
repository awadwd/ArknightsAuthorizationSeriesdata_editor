// Cloudflare Pages Function - Clone/Check Repo
const REPO_CONFIG = {
  owner: 'awadwd',
  repo: 'ArknightsAuthorization_Series-mirror',
  branch: 'dev'
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

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}`, {
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'User-Agent': 'Arknights-Tool',
      },
    });

    if (res.ok) {
      return new Response(JSON.stringify({ success: true, message: 'Repository accessible' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      const err = await res.json();
      return new Response(JSON.stringify({ success: false, error: err.message }), {
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
