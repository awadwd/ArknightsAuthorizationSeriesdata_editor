// Cookie-based session helpers.
// Why: KV single-key "current_auth" was shared across all users on the same deployment.
// Now each user gets a random sid, set as httpOnly cookie, and KV key is "auth:${sid}".

export const SESSION_COOKIE_NAME = 'editor_sid';
export const SESSION_TTL_SECONDS = 30 * 24 * 3600; // 30 days (browser-managed via cookie Max-Age)

function bytesToHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function generateSid() {
  // 32 random bytes -> 64 hex chars. crypto.getRandomValues is available in Workers.
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

function parseCookieHeader(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function getSessionId(request) {
  const cookies = parseCookieHeader(request.headers.get('Cookie'));
  return cookies[SESSION_COOKIE_NAME] || null;
}

export function sessionSetCookie(sid) {
  // SameSite=Lax: allow top-level navigation (OAuth callback), block cross-site fetch.
  // HttpOnly: block JS read (XSS protection).
  // Secure: HTTPS only (pages.dev is HTTPS).
  // Path=/: sent to all paths including /api/*.
  return `${SESSION_COOKIE_NAME}=${sid}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function sessionClearCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function authKey(sid) {
  return `auth:${sid}`;
}

export async function getAuthByRequest(request, env) {
  const sid = getSessionId(request);
  if (!sid) return null;
  const raw = await env.AUTH_STORE && env.AUTH_STORE.get(authKey(sid));
  if (!raw) return null;
  try {
    const auth = JSON.parse(raw);
    if (auth.expires && auth.expires < Date.now()) {
      await env.AUTH_STORE && env.AUTH_STORE.delete(authKey(sid));
      return null;
    }
    return auth;
  } catch {
    return null;
  }
}

export async function saveAuthBySid(env, sid, auth) {
  const key = authKey(sid);
  await env.AUTH_STORE && env.AUTH_STORE.put(key, JSON.stringify(auth), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

export async function deleteAuthBySid(env, sid) {
  const key = authKey(sid);
  await env.AUTH_STORE && env.AUTH_STORE.delete(key);
}
