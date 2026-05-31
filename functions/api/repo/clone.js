// Cloudflare Pages Function - Clone/Check Repo
const REPO_CONFIG = {
  github: {
    owner: 'awadwd',
    repo: 'ArknightsAuthorization_Series-mirror',
    branch: 'dev',
  },
  gitcode: {
    owner: 'huangjinzhou1',
    repo: 'ArknightsAuthorization_Series',
    branch: 'dev',
  }
};

// GitCode 项目 ID 必须用 %252F 双重编码
// fetch() 会把 %2F 解码成 /，所以传 %252F 让 fetch 解码一次后剩 %2F
function gitcodeProjectId(owner, repo) {
  return `${owner}%252F${repo}`;
}

async function getAuth(env) {
  const authData = await env.AUTH_STORE?.get('current_auth');
  if (!authData) return null;
  const auth = JSON.parse(authData);
  if (auth.expires && auth.expires < Date.now()) {
    await env.AUTH_STORE?.delete('current_auth');
    return null;
  }
  return auth;
}

export async function onRequestPost(context) {
  const { env } = context;

  const auth = await getAuth(env);
  if (!auth || !auth.authenticated) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const source = auth.source || 'github';
  const config = REPO_CONFIG[source] || REPO_CONFIG.github;

  try {
    if (source === 'gitcode') {
      // GitCode: 用用户 API 验证 Token 有效性（避免项目 API 的编码问题）
      // 真正的仓库访问验证在 file.js 里做
      const userRes = await fetch('https://gitcode.com/api/v5/user', {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Accept': 'application/json',
        },
      });

      if (userRes.ok) {
        const userData = await userRes.json();
        return new Response(JSON.stringify({
          success: true,
          message: `GitCode 认证成功: ${userData.username || userData.login}`,
          source
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        const err = await userRes.json().catch(() => ({}));
        return new Response(JSON.stringify({
          success: false,
          error: err.message || `GitCode API 认证失败 (${userRes.status})`
        }), {
          status: userRes.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      // GitHub
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
