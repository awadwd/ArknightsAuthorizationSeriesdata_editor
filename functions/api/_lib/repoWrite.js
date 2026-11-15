// 统一"写入数据仓库"的适配层：GitHub / GitCode 两种后端，同样的接口。
// 审核通过改 Box_Id.json、市价写回都走这里，避免每处各写一遍 API 细节。
//
// 目标仓库由配置决定：
//   repoConfigs.github  = 镜像仓库
//   repoConfigs.gitcode = 主仓库（raw.gitcode.com 供端上读取）
// 具体打哪个由 auth.source 或显式 target 决定；默认跟登录源一致。

import { getRepoFile, getBranchSha, createBranch, putFile, createPR, utf8ToBase64, base64ToUtf8 } from './gh.js';

const GC_API = 'https://gitcode.com/api/v5';

function gcProjectId(owner, repo) {
  return `${owner}%252F${repo}`;
}

function gcHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

function pickTarget(cfg, authSource, explicit) {
  const t = explicit || (cfg && cfg.pr && cfg.pr.defaultTarget) || 'auto';
  const repos = (cfg && cfg.repoConfigs) || {};
  if (t === 'gitcode') return { kind: 'gitcode', ...(repos.gitcode || {}) };
  if (t === 'github') return { kind: 'github', ...(repos.github || {}) };
  // auto：优先跟登录源，缺配置就退回另一个
  if (authSource === 'gitcode' && repos.gitcode && repos.gitcode.owner) return { kind: 'gitcode', ...repos.gitcode };
  if (repos.github && repos.github.owner) return { kind: 'github', ...repos.github };
  return { kind: 'gitcode', ...(repos.gitcode || {}) };
}

export function resolveTarget(cfg, authSource, explicit) {
  return pickTarget(cfg, authSource, explicit);
}

// 读文件 -> { text, sha } | null
export async function readFile(target, token, path, ref) {
  if (target.kind === 'gitcode') {
    const res = await fetch(
      `${GC_API}/projects/${gcProjectId(target.owner, target.repo)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref || target.branch || 'main')}`,
      { headers: gcHeaders(token) }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`读取 ${path} 失败: ${res.status}`);
    const j = await res.json();
    let text = '';
    if (j.content) {
      try { text = j.encoding === 'base64' ? base64ToUtf8(j.content) : String(j.content); } catch (e) { text = String(j.content); }
    }
    if (!text && j.download_url) {
      const raw = await fetch(j.download_url);
      if (raw.ok) text = await raw.text();
    }
    return { text, sha: j.last_commit_id || j.commit_id || null };
  }
  return await getRepoFile(token, target.owner, target.repo, path, ref);
}

// 建分支 -> 写文件 -> 开 PR/MR
export async function commitAndOpenPR(opts) {
  const { target, token, base, files, title, body, branchPrefix } = opts;
  const stamp = Date.now();
  const branch = `${branchPrefix || 'edit'}/${stamp}`;

  if (target.kind === 'gitcode') {
    const pid = gcProjectId(target.owner, target.repo);
    const mk = await fetch(
      `${GC_API}/projects/${pid}/repository/branches?branch_name=${encodeURIComponent(branch)}&ref=${encodeURIComponent(base)}`,
      { method: 'POST', headers: gcHeaders(token) }
    );
    if (!mk.ok) {
      const err = await mk.json().catch(() => ({}));
      throw new Error(`创建分支失败: ${err.message || mk.status}`);
    }
    for (const f of files) {
      const payload = { branch, content: f.content, encoding: 'text', commit_message: title };
      if (f.sha) payload.last_commit_id = f.sha;
      const res = await fetch(
        `${GC_API}/projects/${pid}/repository/files/${encodeURIComponent(f.path)}`,
        { method: 'PUT', headers: gcHeaders(token), body: JSON.stringify(payload) }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`写入 ${f.path} 失败: ${err.message || res.status}`);
      }
    }
    const mr = await fetch(`${GC_API}/projects/${pid}/merge_requests`, {
      method: 'POST', headers: gcHeaders(token),
      body: JSON.stringify({ source_branch: branch, target_branch: base, title, description: body || '' }),
    });
    if (!mr.ok) {
      const err = await mr.json().catch(() => ({}));
      throw new Error(`创建 MR 失败: ${err.message || mr.status}`);
    }
    const j = await mr.json();
    return { url: j.web_url || j.target_url || null, number: j.iid || null, branch };
  }

  const baseSha = await getBranchSha(token, target.owner, target.repo, base);
  await createBranch(token, target.owner, target.repo, branch, baseSha);
  for (const f of files) {
    await putFile(token, target.owner, target.repo, f.path, f.content, f.sha, branch, title);
  }
  const pr = await createPR(token, target.owner, target.repo, branch, base, title, body || '');
  return { url: pr.url, number: pr.number, branch };
}

export { utf8ToBase64, base64ToUtf8 };
