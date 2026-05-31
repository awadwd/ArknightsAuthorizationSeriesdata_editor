// Cloudflare Pages Function - Get File Content
// Route: /api/repo/file?filename=xxx

const REPO_CONFIG = {
  // GitHub 镜像仓库
  github: {
    owner: 'awadwd',
    repo: 'ArknightsAuthorization_Series-mirror',
    branch: 'dev'
  },
  // GitCode 主仓库
  gitcode: {
    owner: 'huangjinzhou1',
    repo: 'ArknightsAuthorization_Series',
    branch: 'dev',
    url: 'https://gitcode.com/huangjinzhou1/ArknightsAuthorization_Series'
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
  
  // CORS
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

  if (!filename) {
    return new Response(JSON.stringify({ error: 'Missing filename' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_CONFIG.github.owner}/${REPO_CONFIG.github.repo}/contents/${filename}?ref=${REPO_CONFIG.github.branch}`, {
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'User-Agent': 'Arknights-Tool',
        'Accept': 'application/vnd.github.v3.raw',
      },
    });

    if (res.ok) {
      const content = await res.text();
      return new Response(JSON.stringify({ content }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    } else {
      return new Response(JSON.stringify({ error: 'File not found', status: res.status }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
