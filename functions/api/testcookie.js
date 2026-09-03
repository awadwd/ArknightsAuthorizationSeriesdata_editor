// Cloudflare Pages Function - minimal Set-Cookie test
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const m = url.searchParams.get('m') || '1';

  if (m === '1') {
    return new Response('mode=1', { headers: { 'Set-Cookie': 'test1=1; Path=/' } });
  }
  if (m === '2') {
    return new Response('mode=2', { headers: [['Set-Cookie', 'test2=2; Path=/']] });
  }
  if (m === '3') {
    const h = new Headers();
    h.append('Set-Cookie', 'test3=3; Path=/');
    return new Response('mode=3', { headers: h });
  }
  if (m === '4') {
    const h = new Headers();
    h.set('Set-Cookie', 'test4=4; Path=/');
    return new Response('mode=4', { headers: h });
  }
  return new Response('specify ?m=1..4', { status: 400 });
}
