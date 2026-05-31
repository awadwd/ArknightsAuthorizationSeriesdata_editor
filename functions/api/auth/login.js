// Cloudflare Pages Function - OAuth Login (GitHub or GitCode)
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const source = url.searchParams.get('source') || 'github';

  // state 格式: <random>_<source>，callback 时解析
  const stateRand = Math.random().toString(36).substring(2, 15);
  const state = `${stateRand}_${source}`;

  let authUrl;
  let clientId;
  let redirectUri;

  if (source === 'gitcode') {
    // GitCode OAuth
    clientId = '94ab054141264207b31c98c85e52d3b8';
    // redirect_uri 必须跟应用设置完全一致，不能带额外 query 参数
    redirectUri = `${url.origin}/api/auth/callback`;
    authUrl = `https://gitcode.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user%20project&state=${state}`;
  } else {
    // GitHub OAuth
    clientId = env.GITHUB_CLIENT_ID;
    redirectUri = `${url.origin}/api/auth/callback`;
    authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo%20read:user&state=${state}`;
  }

  // 存储 state 用于验证（10分钟过期）
  await env.AUTH_STORE.put('oauth_state', JSON.stringify({
    state,
    source,
    expires: Date.now() + 600000
  }), { expirationTtl: 600 });

  return new Response(JSON.stringify({ authUrl, source }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
