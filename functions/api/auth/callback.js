// Cloudflare Pages Function - OAuth Callback
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  
  if (!code) {
    return new Response('<h1>授权失败</h1><p>缺少授权码</p>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  try {
    const redirectUri = `${url.origin}/api/auth/callback`;
    
    // Exchange code for token
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

    const accessToken = tokenData.access_token;

    // Get user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Arknights-Tool' },
    });
    const userData = await userRes.json();

    // 存储到 KV (24小时过期)
    await env.AUTH_STORE.put('current_auth', JSON.stringify({
      username: userData.login,
      token: accessToken,
      authenticated: true,
      expires: Date.now() + 86400000
    }), { expirationTtl: 86400 });

    // 返回页面，检测是否为移动端并自动跳转
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
          .btn { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #0078d4; color: white; text-decoration: none; border-radius: 6px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✓ 授权成功</h1>
          <p>欢迎, <strong>${userData.login}</strong></p>
          <p style="font-size: 14px; color: #999;">正在返回编辑器...</p>
        </div>
        <script>
          // 保存认证信息到 localStorage
          localStorage.setItem('isAuth', 'true');
          localStorage.setItem('user', '${userData.login}');
          localStorage.setItem('gh_token', '${accessToken}');
          localStorage.setItem('gh_user', '${userData.login}');
          
          // 检测是否有 opener（弹窗模式）
          if (window.opener) {
            // PC端弹窗：通知父窗口并关闭
            window.opener.postMessage({
              type: 'github-oauth-success',
              user: '${userData.login}',
              token: '${accessToken}'
            }, '*');
            setTimeout(function() { window.close(); }, 1500);
          } else {
            // 移动端或直接访问：跳转到首页
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
