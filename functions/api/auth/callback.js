// Cloudflare Pages Function - OAuth Callback (GitHub or GitCode)
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state') || '';

  if (!code) {
    return new Response('<h1>授权失败</h1><p>缺少授权码</p>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  // 从 state 解析 source: <random>_<source>
  let source = 'github';
  if (stateParam.includes('_')) {
    const parts = stateParam.split('_');
    const s = parts[parts.length - 1];
    if (s === 'gitcode' || s === 'github') source = s;
  }

  try {
    let accessToken;
    let userData;

    if (source === 'gitcode') {
      // GitCode (GitLab OAuth): token 交换用 x-www-form-urlencoded
      const redirectUri = `${url.origin}/api/auth/callback`;

      const tokenRes = await fetch('https://gitcode.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
          client_id: '94ab054141264207b31c98c85e52d3b8',
          client_secret: 'e3034cd9fa164589a0f35a3c06b0168f',
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });

      const tokenData = await tokenRes.json();

      if (tokenData.error) {
        return new Response(`<h1>授权失败</h1><p>${tokenData.error}: ${tokenData.error_description || ''}</p>`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      accessToken = tokenData.access_token;

      // 验证 token：获取用户信息
      const userRes = await fetch('https://gitcode.com/api/v5/user', {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
      });

      if (!userRes.ok) {
        const errText = await userRes.text().catch(() => '');
        return new Response(`<h1>获取用户信息失败</h1><p>${userRes.status}: ${errText.slice(0, 200)}</p>`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      userData = await userRes.json();

    } else {
      // GitHub OAuth
      const redirectUri = `${url.origin}/api/auth/callback`;

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
        }),
      });
      const tokenData = await tokenRes.json();

      if (tokenData.error) {
        return new Response(`<h1>授权失败</h1><p>${tokenData.error}</p>`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      accessToken = tokenData.access_token;

      const userRes = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Arknights-Tool' },
      });
      userData = await userRes.json();
    }

    const username = userData.login || userData.username || 'unknown';
    const sourceLabel = source === 'gitcode' ? 'GitCode' : 'GitHub';

    // 存储到 KV (24小时过期)
    await env.AUTH_STORE.put('current_auth', JSON.stringify({
      username,
      token: accessToken,
      source,
      authenticated: true,
      expires: Date.now() + 86400000
    }), { expirationTtl: 86400 });

    // 返回成功页面
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>授权成功</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 40px 20px; background: #f5f5f5; }
          .container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          h1 { color: #2e7d32; margin-bottom: 10px; }
          p { color: #666; }
          .source { font-size: 12px; color: #999; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✓ 授权成功</h1>
          <p>欢迎, <strong>${username}</strong></p>
          <p class="source">登录方式: ${sourceLabel}</p>
          <p style="font-size: 14px; color: #999;">正在返回编辑器...</p>
        </div>
        <script>
          localStorage.setItem('isAuth', 'true');
          localStorage.setItem('user', '${username}');
          localStorage.setItem('gh_token', '${accessToken}');
          localStorage.setItem('gh_user', '${username}');
          localStorage.setItem('auth_source', '${source}');

          if (window.opener) {
            window.opener.postMessage({
              type: 'github-oauth-success',
              user: '${username}',
              token: '${accessToken}',
              source: '${source}'
            }, '*');
            setTimeout(function() { window.close(); }, 1500);
          } else {
            setTimeout(function() { window.location.href = '/'; }, 1000);
          }
        </script>
      </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    return new Response(`<h1>授权失败</h1><p>${error.message}</p>`, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}
