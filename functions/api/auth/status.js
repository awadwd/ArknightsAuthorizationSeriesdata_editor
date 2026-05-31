// Cloudflare Pages Function - Auth Status
export async function onRequest(context) {
  const { env } = context;
  
  try {
    const authData = await env.AUTH_STORE?.get('current_auth');
    
    if (!authData) {
      return new Response(JSON.stringify({ authenticated: false, username: null }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const auth = JSON.parse(authData);
    
    if (auth.expires && auth.expires < Date.now()) {
      await env.AUTH_STORE?.delete('current_auth');
      return new Response(JSON.stringify({ authenticated: false, username: null }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({
      authenticated: auth.authenticated,
      username: auth.username
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ authenticated: false, username: null }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
