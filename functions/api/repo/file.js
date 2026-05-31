// Cloudflare Pages Function - Get File Content
// Route: /api/repo/file?filename=xxx&source=github|gitcode

const REPO_CONFIG = {
  github: {
    owner: 'awadwd',
    repo: 'ArknightsAuthorization_Series-mirror',
    branch: 'dev'
  },
  gitcode: {
    owner: 'huangjinzhou1',
    repo: 'ArknightsAuthorization_Series',
    branch: 'dev'
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
      // GitCode API
      const config = REPO_CONFIG.gitcode;
      const res = await fetch(`https://gitcode.com/api/v5/repos/${config.owner}/${config.repo}/contents/${filename}?ref=${config.branch}`, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
        },
      });
      
      if (!res.ok) {
        return new Response(JSON.stringify({ error: 'File not found', status: res.status }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      
      const data = await res.json();
      // GitCode API returns base64 encoded content
      if (data.encoding === 'base64' && data.content) {
        content = atob(data.content.replace(/\n/g, ''));
      } else if (data.content) {
        content = data.content;
      } else {
        return new Response(JSON.stringify({ error: 'Empty content' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    } else {
      // GitHub API - 禁用缓存
      const config = REPO_CONFIG.github;
      const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filename}?ref=${config.branch}&_t=${Date.now()}`, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'User-Agent': 'Arknights-Tool',
          'Accept': 'application/vnd.github.v3.raw',
        },
      });

      if (!res.ok) {
        return new Response(JSON.stringify({ error: 'File not found', status: res.status }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      
      content = await res.text();
    }

    // 禁用响应缓存
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
