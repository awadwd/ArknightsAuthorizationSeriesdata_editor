// Cloudflare Pages Function - GitHub OAuth Login
export async function onRequest(context) {
  const { env } = context;
  
  const clientId = env.GITHUB_CLIENT_ID;
  const redirectUri = `${new URL(context.request.url).origin}/api/auth/callback`;
  const scope = 'repo read:user';
  const state = Math.random().toString(36).substring(7);
  
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  
  return new Response(JSON.stringify({ authUrl, state }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
