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
    `, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    return new Response(`<h1>授权失败</h1><p>${error.message}</p>`, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}
