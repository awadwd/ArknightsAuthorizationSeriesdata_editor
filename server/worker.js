// Cloudflare Worker - Arknights Tool API
// 兼容 Express 路由的 Worker 实现

// GitHub OAuth Config (从环境变量读取)
let GITHUB_CLIENT_ID = '';
let GITHUB_CLIENT_SECRET = '';
let GITHUB_REDIRECT_URI = '';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 简单的内存存储（Workers 无状态，需要 KV 或 D1 持久化）
let config = {
  github: { username: '', token: '', authenticated: false },
  repo: {
    gitcode: { owner: 'huangjinzhou1', name: 'ArknightsAuthorization_Series' },
    github: { owner: 'awadwd', name: 'ArknightsAuthorization_Series-mirror' }
  },
  targetBranch: 'dev',
  baseBranch: 'main'
};

export default {
  async fetch(request, env, ctx) {
    // 从环境变量读取配置
    GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID || '';
    GITHUB_CLIENT_SECRET = env.GITHUB_CLIENT_SECRET || '';
    GITHUB_REDIRECT_URI = env.GITHUB_REDIRECT_URI || '';

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 路由
      if (path === '/api/auth/login' && method === 'GET') {
        return handleOAuthLogin(request);
      }
      
      if (path === '/api/auth/callback' && method === 'GET') {
        return handleOAuthCallback(request, env);
      }
      
      if (path === '/api/auth/validate' && method === 'POST') {
        return handleAuthValidate(request, env);
      }
      
      if (path === '/api/auth/status' && method === 'GET') {
        return handleAuthStatus();
      }
      
      if (path === '/api/proxy-image' && method === 'GET') {
        return handleProxyImage(request);
      }

      // 其他路由需要认证
      if (!config.github.authenticated) {
        return jsonError('Not authenticated', 401);
      }

      if (path === '/api/repo/clone' && method === 'POST') {
        return handleRepoClone(request, env);
      }
      
      if (path === '/api/repo/file' && method === 'GET') {
        return handleRepoFile(request, env);
      }
      
      if (path === '/api/repo/save-and-pr' && method === 'POST') {
        return handleSaveAndPR(request, env);
      }

      return jsonError('Not found', 404);
    } catch (error) {
      return jsonError(error.message, 500);
    }
  }
};

// === 路由处理函数 ===

function handleOAuthLogin(request) {
  const scope = 'repo read:user';
  const state = Math.random().toString(36).substring(7);
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  return jsonResponse({ authUrl, state });
}

async function handleOAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('<h1>授权失败</h1><p>缺少授权码</p>', { headers: { 'Content-Type': 'text/html' } });
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      return new Response(`<h1>授权失败</h1><p>${tokenData.error}</p>`, { headers: { 'Content-Type': 'text/html' } });
    }

    const accessToken = tokenData.access_token;

    // Get user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Arknights-Tool' },
    });
    const userData = await userRes.json();

    // 保存到内存（生产环境应该用 KV）
    config.github.username = userData.login;
    config.github.token = accessToken;
    config.github.authenticated = true;

    return new Response(`
      <!DOCTYPE html>
      <html>
      <head><title>授权成功</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 40px;">
        <h1 style="color: #2e7d32;">✓ 授权成功</h1>
        <p>欢迎, <strong>${userData.login}</strong></p>
        <script>
          if (window.opener) {
            window.opener.postMessage({
              type: 'github-oauth-success',
              user: '${userData.login}',
              token: '${accessToken}'
            }, '*');
          }
          setTimeout(() => window.close(), 1500);
        </script>
      </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });
  } catch (error) {
    return new Response(`<h1>授权失败</h1><p>${error.message}</p>`, { headers: { 'Content-Type': 'text/html' } });
  }
}

async function handleAuthValidate(request, env) {
  const body = await request.json();
  const { username, token } = body;

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'Arknights-Tool' },
    });

    if (res.ok) {
      const user = await res.json();
      config.github.username = user.login;
      config.github.token = token;
      config.github.authenticated = true;
      return jsonResponse({ success: true, user: user.login });
    } else {
      return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    }
  } catch (error) {
    return jsonError(error.message, 500);
  }
}

function handleAuthStatus() {
  return jsonResponse({
    authenticated: config.github.authenticated,
    username: config.github.username
  });
}

async function handleProxyImage(request) {
  const url = new URL(request.url);
  const imageUrl = url.searchParams.get('url');

  if (!imageUrl) {
    return jsonError('Missing url', 400);
  }

  const allowedHosts = ['i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com', 'media.prts.wiki', 'avatars.githubusercontent.com'];
  const urlObj = new URL(imageUrl);
  
  if (!allowedHosts.some(h => urlObj.hostname.endsWith(h) || urlObj.hostname === h)) {
    return jsonError('Host not allowed', 403);
  }

  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': urlObj.origin },
  });

  if (!res.ok) {
    return jsonError('Failed to fetch', res.status);
  }

  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = await res.arrayBuffer();

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    }
  });
}

async function handleRepoClone(request, env) {
  // Workers 无法 git clone，改用 GitHub API 直接读取文件
  const owner = config.repo.github.owner;
  const repo = config.repo.github.name;
  const branch = config.targetBranch;

  try {
    // 检查仓库访问权限
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${config.github.token}`,
        'User-Agent': 'Arknights-Tool',
      },
    });

    if (res.ok) {
      return jsonResponse({ success: true, message: 'Repository accessible' });
    } else {
      const err = await res.json();
      return jsonResponse({ success: false, error: err.message }, res.status);
    }
  } catch (error) {
    return jsonError(error.message, 500);
  }
}

async function handleRepoFile(request, env) {
  const url = new URL(request.url);
  const filename = url.searchParams.get('filename');

  if (!filename) {
    return jsonError('Missing filename', 400);
  }

  const owner = config.repo.github.owner;
  const repo = config.repo.github.name;
  const branch = config.targetBranch;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filename}?ref=${branch}`, {
      headers: {
        'Authorization': `Bearer ${config.github.token}`,
        'User-Agent': 'Arknights-Tool',
        'Accept': 'application/vnd.github.v3.raw',
      },
    });

    if (res.ok) {
      const content = await res.text();
      return jsonResponse({ content });
    } else {
      return jsonError('File not found', 404);
    }
  } catch (error) {
    return jsonError(error.message, 500);
  }
}

async function handleSaveAndPR(request, env) {
  const body = await request.json();
  const { filename, content, commitMessage } = body;

  const owner = config.repo.github.owner;
  const repo = config.repo.github.name;
  const baseBranch = config.targetBranch;

  try {
    // 1. Get current file SHA
    const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filename}?ref=${baseBranch}`, {
      headers: {
        'Authorization': `Bearer ${config.github.token}`,
        'User-Agent': 'Arknights-Tool',
      },
    });

    if (!fileRes.ok) {
      return jsonError('File not found', 404);
    }

    const fileData = await fileRes.json();
    const sha = fileData.sha;

    // 2. Create new branch
    const branchName = `update/${filename.replace('.json', '')}-${Date.now()}`;
    
    // Get base branch SHA
    const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`, {
      headers: {
        'Authorization': `Bearer ${config.github.token}`,
        'User-Agent': 'Arknights-Tool',
      },
    });
    const refData = await refRes.json();
    const baseSha = refData.object.sha;

    // Create branch
    await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.github.token}`,
        'User-Agent': 'Arknights-Tool',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    });

    // 3. Update file on new branch
    const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filename}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${config.github.token}`,
        'User-Agent': 'Arknights-Tool',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: commitMessage,
        content: btoa(unescape(encodeURIComponent(content))),
        sha: sha,
        branch: branchName,
      }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.json();
      return jsonError(err.message, updateRes.status);
    }

    // 4. Create PR
    const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.github.token}`,
        'User-Agent': 'Arknights-Tool',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: commitMessage,
        head: branchName,
        base: baseBranch,
        body: `自动创建的 PR\n\n修改文件: ${filename}`,
      }),
    });

    const prData = await prRes.json();

    if (prRes.ok) {
      return jsonResponse({ success: true, prUrl: prData.html_url });
    } else {
      return jsonError(prData.message, prRes.status);
    }
  } catch (error) {
    return jsonError(error.message, 500);
  }
}

// === 辅助函数 ===

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function jsonError(message, status = 500) {
  return jsonResponse({ error: message }, status);
}
