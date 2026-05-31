// Cloudflare Pages Function - Save and Create PR (GitHub & GitCode)
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

// GitCode 项目 ID 必须双重编码
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
  const { request, env } = context;

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
    const body = await request.json();
    const { filename, content, commitMessage } = body;

    if (source === 'gitcode') {
      // ============ GitCode (GitLab API) ============
      const projectId = gitcodeProjectId(config.owner, config.repo);
      const branchName = `update/${filename.replace('.json', '')}-${Date.now()}`;
      const apiBase = 'https://gitcode.com/api/v5';

      // 1. 获取文件 SHA（last_commit_id）
      const fileRes = await fetch(
        `${apiBase}/projects/${projectId}/repository/files/${encodeURIComponent(filename)}?ref=${config.branch}`,
        { headers: { 'Authorization': `Bearer ${auth.token}`, 'Accept': 'application/json' } }
      );

      let lastCommitId = null;
      if (fileRes.ok) {
        const fileData = await fileRes.json();
        lastCommitId = fileData.last_commit_id || fileData.commit_id || null;
      }

      // 2. 创建新分支
      const branchRes = await fetch(
        `${apiBase}/projects/${projectId}/repository/branches?branch_name=${encodeURIComponent(branchName)}&ref=${encodeURIComponent(config.branch)}`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${auth.token}`, 'Accept': 'application/json' },
        }
      );

      if (!branchRes.ok) {
        const err = await branchRes.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: `Create branch failed: ${err.message || branchRes.status}` }), {
          status: branchRes.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 3. 更新文件（创建 commit）
      const updateBody = {
        branch: branchName,
        content: content,
        encoding: 'text',
        commit_message: commitMessage,
      };
      if (lastCommitId) updateBody.last_commit_id = lastCommitId;

      const updateRes = await fetch(
        `${apiBase}/projects/${projectId}/repository/files/${encodeURIComponent(filename)}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${auth.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(updateBody),
        }
      );

      if (!updateRes.ok) {
        const err = await updateRes.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: `Update file failed: ${err.message || updateRes.status}` }), {
          status: updateRes.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 4. 创建 Merge Request
      const mrRes = await fetch(
        `${apiBase}/projects/${projectId}/merge_requests`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${auth.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            source_branch: branchName,
            target_branch: config.branch,
            title: commitMessage,
            description: `自动创建的合并请求\n\n修改文件: ${filename}`,
          }),
        }
      );

      if (mrRes.ok) {
        const mrData = await mrRes.json();
        return new Response(JSON.stringify({ success: true, mrUrl: mrData.web_url || mrData.target_url }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        const err = await mrRes.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: `Create MR failed: ${err.message || mrRes.status}` }), {
          status: mrRes.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }

    } else {
      // ============ GitHub ============
      const { owner, repo, branch } = config;

      // 1. Get file SHA
      const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filename}?ref=${branch}`, {
        headers: { 'Authorization': `Bearer ${auth.token}`, 'User-Agent': 'Arknights-Tool' },
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

      const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        headers: { 'Authorization': `Bearer ${auth.token}`, 'User-Agent': 'Arknights-Tool' },
      });
      const refData = await refRes.json();
      const baseSha = refData.object.sha;

      await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'User-Agent': 'Arknights-Tool',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
      });

      // 3. Update file
      const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filename}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'User-Agent': 'Arknights-Tool',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: commitMessage,
          content: btoa(unescape(encodeURIComponent(content))),
          sha,
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
      const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'User-Agent': 'Arknights-Tool',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: commitMessage,
          head: branchName,
          base: branch,
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
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
