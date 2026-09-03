// Cloudflare Pages Function - Get File Content (GitCode bypass WAF)
// Route: /api/repo/file?filename=xxx&source=github|gitcode
import { getAppConfig } from '../_lib/appConfig.js';
import { verifyRequest } from '../_lib/auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  const auth = await verifyRequest(request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const url = new URL(request.url);
  const filename = url.searchParams.get('filename');
  const source = url.searchParams.get('source') || auth.source || 'github';

  if (!filename) {
    return new Response(JSON.stringify({ error: 'Missing filename' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const cfg = await getAppConfig(env);
  const repoConfigs = (cfg && cfg.repoConfigs) || {};
  const gh = repoConfigs.github || { owner: 'awadwd', repo: 'ArknightsAuthorization_Series-mirror', branch: 'dev' };
  const gc = repoConfigs.gitcode || { owner: 'huangjinzhou1', repo: 'ArknightsAuthorization_Series', branch: 'dev' };

  try {
    let content;

    if (source === 'gitcode') {
      const rawUrl = `https://gitcode.com/${gc.owner}/${gc.repo}/raw/${gc.branch}/${encodeURIComponent(filename)}`;

      const res = await fetch(rawUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        redirect: 'follow',
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return new Response(JSON.stringify({
          error: 'GitCode raw file not found',
          status: res.status,
          detail: errText.slice(0, 500),
          rawUrl,
        }), {
          status: res.status === 404 ? 404 : 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      content = await res.text();

    } else {
      const rawUrl = `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${gh.branch}/${filename}`;

      const fetchOptions = {
        headers: {
          'User-Agent': 'Arknights-Tool',
          'Cache-Control': 'no-cache',
          'Authorization': `Bearer ${auth.token}`,
        },
      };

      const res = await fetch(rawUrl + `?t=${Date.now()}`, fetchOptions);

      if (!res.ok) {
        return new Response(JSON.stringify({ error: 'File not found', status: res.status }), {
          status: res.status === 404 ? 404 : 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      content = await res.text();
    }

    return new Response(JSON.stringify({ content }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
