// Cloudflare Pages Function - Save and Create PR
const REPO_CONFIG = {
  owner: 'awadwd',
  repo: 'ArknightsAuthorization_Series-mirror',
  branch: 'dev'
};

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
  const { request, env } = context;
  
  const auth = await getAuth(env);
  if (!auth || !auth.authenticated) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const { filename, content, commitMessage } = body;

    // 1. Get file SHA
    const fileRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/contents/${filename}?ref=${REPO_CONFIG.branch}`, {
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'User-Agent': 'Arknights-Tool',
      },
    });

    if (!fileRes.ok) {
      return new Response(JSON.stringify({ error: 'File not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const fileData = await fileRes.json();
    const sha = fileData.sha;

    // 2. Create new branch
    const branchName = `update/${filename.replace('.json', '')}-${Date.now()}`;
    
    const refRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/refs/heads/${REPO_CONFIG.branch}`, {
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'User-Agent': 'Arknights-Tool',
      },
    });
    const refData = await refRes.json();
    const baseSha = refData.object.sha;

    await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/refs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'User-Agent': 'Arknights-Tool',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    });

    // 3. Update file
    const updateRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/contents/${filename}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'User-Agent': 'Arknights-Tool',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: commitMessage,
        content: btoa(unescape(encodeURIComponent(content))),
        sha: sha,
        branch: branchName,
      }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.json();
      return new Response(JSON.stringify({ error: err.message }), {
        status: updateRes.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 4. Create PR
    const prRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/pulls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'User-Agent': 'Arknights-Tool',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: commitMessage,
        head: branchName,
        base: REPO_CONFIG.branch,
        body: `自动创建的 PR\n\n修改文件: ${filename}`,
      }),
    });

    const prData = await prRes.json();

    if (prRes.ok) {
      return new Response(JSON.stringify({ success: true, prUrl: prData.html_url }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({ error: prData.message }), {
        status: prRes.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
