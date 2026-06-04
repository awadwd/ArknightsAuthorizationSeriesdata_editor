// Cloudflare Pages Function - Proxy Image
const ALLOWED_HOSTS = [
  'i0.hdslb.com', 
  'i1.hdslb.com', 
  'i2.hdslb.com', 
  'media.prts.wiki', 
  'avatars.githubusercontent.com',
  'user-images.githubusercontent.com'
];

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const imageUrl = url.searchParams.get('url');

  if (!imageUrl) {
    return new Response(JSON.stringify({ error: 'Missing url' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const urlObj = new URL(imageUrl);
    
    if (!ALLOWED_HOSTS.some(h => urlObj.hostname.endsWith(h) || urlObj.hostname === h)) {
      return new Response(JSON.stringify({ error: 'Host not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);  // 10秒超时

    const res = await fetch(imageUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0', 
        'Referer': urlObj.origin 
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch' }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      }
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'Request timeout' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
