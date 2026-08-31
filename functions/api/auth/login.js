// Cloudflare Pages Function - OAuth Login (GitHub or GitCode)
import { getAppConfig } from '../_lib/appConfig.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const source = url.searchParams.get('source') || 'github';

  const stateRand = Math.random().toString(36).substring(2, 15);
  const state = `${stateRand}_${source}`;

  const cfg = await getAppConfig(env);
  const oauth = (cfg && cfg.oauth) || {};

  let authUrl;
  let clientId;
  let redirectUri;

  if (source === 'gitcode') {
    clientId = oauth.gitcodeClientId || '94ab054141264207b31c98c85e52d3b8';
    redirectUri = `${url.origin}/api/auth/callback`;
    const scope = encodeURIComponent(oauth.gitcodeScope || 'user project');
    authUrl = `https://gitcode.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;
  } else {
    clientId = oauth.githubClientId || env.GITHUB_CLIENT_ID || 'Ov23liE3h9mVLCbbzdHA';
    redirectUri = `${url.origin}/api/auth/callback`;
    const scope = encodeURIComponent(oauth.githubScope || 'repo read:user');
    authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;
  }

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
