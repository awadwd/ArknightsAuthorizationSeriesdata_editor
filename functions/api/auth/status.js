// Cloudflare Pages Function - Auth Status
import { isOwner } from '../_lib/owner.js';
import { getAuthByRequest } from '../_lib/session.js';

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const auth = await getAuthByRequest(request, env);
    if (!auth) {
      return new Response(JSON.stringify({ authenticated: false, username: null, isOwner: false }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      authenticated: auth.authenticated,
      username: auth.username,
      source: auth.source,
      isOwner: isOwner(auth.username, auth.source),
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ authenticated: false, username: null, isOwner: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
