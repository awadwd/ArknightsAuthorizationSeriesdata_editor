// Cloudflare Pages Function - Get File
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

export async function onRequest(context) {
  const { request, env } = context;
  
  const auth = await getAuth(env);
  if (!auth || !auth.authenticated) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const filename = url.searchParams.get('filename');

  if (!filename) {
    return new Response(JSON.stringify({ error: 'Missing filename' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/contents/${filename}?ref=${REPO_CONFIG.branch}`, {
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'User-Agent': 'Arknights-Tool',
        'Accept': 'application/vnd.github.v3.raw',
      },
    });

    if (res.ok) {
      const content = await res.text();
      return new Response(JSON.stringify({ content }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({ error: 'File not found' }), {
        status: 404,
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
