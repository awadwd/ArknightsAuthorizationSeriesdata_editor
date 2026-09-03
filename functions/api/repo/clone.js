// Cloudflare Pages Function - Clone/Check Repo
import { getAppConfig } from '../_lib/appConfig.js';
import { verifyRequest } from '../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await verifyRequest(request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // source 优先从请求体取，fallback 到 auth.source
  let body = {};
  try { body = await request.json(); } catch {}
  const source = body.source || auth.source || 'github';

  const cfg = await getAppConfig(env);
  const repoConfigs = (cfg && cfg.repoConfigs) || {};
  const config = repoConfigs[source] || repoConfigs.github;

  try {
    if (source === 'gitcode') {
      const projectId = `${config.owner}%252F${config.repo}`;
      const apiUrl = `https://gitcode.com/api/v4/projects/${projectId}`;

      const res = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Accept': 'application/json',
        },
      });

      if (res.ok) {
        const proj = await res.json();
        return new Response(JSON.stringify({
          success: true,
          message: `GitCode 仓库可访问: ${proj.path_with_namespace || proj.name}`,
          source,
          projectId: proj.id,
          apiUrl,
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        const errText = await res.text().catch(() => '');
        return new Response(JSON.stringify({
          success: false,
          error: `GitCode 仓库不可访问 (${res.status}): ${errText.slice(0, 300)}`,
          apiUrl,
        }), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}`, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'User-Agent': 'Arknights-Tool',
        },
      });

      if (res.ok) {
        return new Response(JSON.stringify({ success: true, message: 'Repository accessible', source }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        const err = await res.json().catch(() => ({}));
        return new Response(JSON.stringify({ success: false, error: err.message || `Status ${res.status}` }), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
