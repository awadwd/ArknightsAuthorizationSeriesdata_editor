// Vercel Serverless Function Entry
// 将 Express 应用包装为 Vercel 函数

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Octokit } = require('octokit');

const app = express();

// GitHub OAuth Config
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || '';

// 内存存储（Vercel 函数是无状态的，生产环境需要数据库）
let authState = null;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());

const REPO_CONFIG = {
  owner: 'awadwd',
  repo: 'ArknightsAuthorization_Series-mirror',
  branch: 'dev'
};

// === 认证路由 ===

app.get('/api/auth/login', (req, res) => {
  const scope = 'repo read:user';
  const state = Math.random().toString(36).substring(7);
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  res.json({ authUrl, state });
});

app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.send('<h1>授权失败</h1><p>缺少授权码</p>');
  }

  try {
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
      return res.send(`<h1>授权失败</h1><p>${tokenData.error}</p>`);
    }

    const accessToken = tokenData.access_token;

    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Arknights-Tool' },
    });
    const userData = await userRes.json();

    authState = {
      username: userData.login,
      token: accessToken,
      authenticated: true
    };

    res.send(`
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
    `);
  } catch (error) {
    res.send(`<h1>授权失败</h1><p>${error.message}</p>`);
  }
});

app.post('/api/auth/validate', async (req, res) => {
  const { username, token } = req.body;

  try {
    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'Arknights-Tool' },
    });

    if (userRes.ok) {
      const user = await userRes.json();
      authState = { username: user.login, token, authenticated: true };
      res.json({ success: true, user: user.login });
    } else {
      res.status(401).json({ success: false, error: 'Invalid token' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/status', (req, res) => {
  res.json({
    authenticated: authState?.authenticated || false,
    username: authState?.username || null
  });
});

// === 仓库路由 ===

app.post('/api/repo/clone', async (req, res) => {
  if (!authState?.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const repoRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}`, {
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'User-Agent': 'Arknights-Tool',
      },
    });

    if (repoRes.ok) {
      res.json({ success: true, message: 'Repository accessible' });
    } else {
      const err = await repoRes.json();
      res.status(repoRes.status).json({ success: false, error: err.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/repo/file', async (req, res) => {
  if (!authState?.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { filename } = req.query;
  if (!filename) {
    return res.status(400).json({ error: 'Missing filename' });
  }

  try {
    const fileRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/contents/${filename}?ref=${REPO_CONFIG.branch}`, {
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'User-Agent': 'Arknights-Tool',
        'Accept': 'application/vnd.github.v3.raw',
      },
    });

    if (fileRes.ok) {
      const content = await fileRes.text();
      res.json({ content });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/repo/save-and-pr', async (req, res) => {
  if (!authState?.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { filename, content, commitMessage } = req.body;

  try {
    // 1. Get file SHA
    const fileRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/contents/${filename}?ref=${REPO_CONFIG.branch}`, {
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'User-Agent': 'Arknights-Tool',
      },
    });

    if (!fileRes.ok) {
      return res.status(404).json({ error: 'File not found' });
    }

    const fileData = await fileRes.json();
    const sha = fileData.sha;

    // 2. Create branch
    const branchName = `update/${filename.replace('.json', '')}-${Date.now()}`;
    
    const refRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/refs/heads/${REPO_CONFIG.branch}`, {
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'User-Agent': 'Arknights-Tool',
      },
    });
    const refData = await refRes.json();
    const baseSha = refData.object.sha;

    await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/refs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'User-Agent': 'Arknights-Tool',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    });

    // 3. Update file
    const updateRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/contents/${filename}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'User-Agent': 'Arknights-Tool',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(content).toString('base64'),
        sha: sha,
        branch: branchName,
      }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.json();
      return res.status(updateRes.status).json({ error: err.message });
    }

    // 4. Create PR
    const prRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/pulls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'User-Agent': 'Arknights-Tool',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: commitMessage,
        head: branchName,
        base: REPO_CONFIG.branch,
        body: `自动创建的 PR\n\n修改文件: ${filename}`,
      }),
    });

    const prData = await prRes.json();

    if (prRes.ok) {
      res.json({ success: true, prUrl: prData.html_url });
    } else {
      res.status(prRes.status).json({ error: prData.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === 图片代理 ===

app.get('/api/proxy-image', async (req, res) => {
  const { url: imageUrl } = req.query;

  if (!imageUrl) {
    return res.status(400).json({ error: 'Missing url' });
  }

  const allowedHosts = ['i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com', 'media.prts.wiki', 'avatars.githubusercontent.com'];
  
  try {
    const urlObj = new URL(imageUrl);
    if (!allowedHosts.some(h => urlObj.hostname.endsWith(h) || urlObj.hostname === h)) {
      return res.status(403).json({ error: 'Host not allowed' });
    }

    const imgRes = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': urlObj.origin },
    });

    if (!imgRes.ok) {
      return res.status(imgRes.status).json({ error: 'Failed to fetch' });
    }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Vercel 导出
export default app;
