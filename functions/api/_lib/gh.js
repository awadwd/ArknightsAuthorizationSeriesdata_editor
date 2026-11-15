// GitHub 仓库读写小工具：读文件、建分支、提交、建 PR、合并。
// 只服务 GitHub（GitCode 的编辑走 /api/repo/save-and-pr 的独立分支）。
// 目的：把"改一个 JSON 文件 + 提 PR"这件事收敛成一处，审核通过、市价写回都复用它。

export function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'Arknights-Tool',
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
  };
}

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToUtf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function getRepoFile(token, owner, repo, path, ref) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(path)}` + (ref ? `?ref=${encodeURIComponent(ref)}` : '');
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read ${path} failed: ${res.status}`);
  const j = await res.json();
  return { text: base64ToUtf8(j.content), sha: j.sha };
}

export async function getBranchSha(token, owner, repo, branch) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`get ref ${branch} failed: ${res.status}`);
  return (await res.json()).object.sha;
}

export async function createBranch(token, owner, repo, branch, fromSha) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`create branch failed: ${err.message || res.status}`);
  }
  return true;
}

export async function putFile(token, owner, repo, path, content, sha, branch, message) {
  const body = { message, content: utf8ToBase64(content), branch };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(path)}`, {
    method: 'PUT', headers: ghHeaders(token), body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`put ${path} failed: ${err.message || res.status}`);
  }
  return await res.json();
}

export async function createPR(token, owner, repo, head, base, title, body) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST', headers: ghHeaders(token),
    body: JSON.stringify({ title, head, base, body }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`create PR failed: ${j.message || res.status}`);
  return { url: j.html_url, number: j.number };
}

export async function mergePR(token, owner, repo, number, method) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}/merge`, {
    method: 'PUT', headers: ghHeaders(token),
    body: JSON.stringify({ merge_method: method || 'squash' }),
  });
  return res.ok;
}

// 一次性提交多个文件并开 PR。
// files: [{ path, content, sha? }]；已有 sha 的走更新，没有的新建。
export async function commitFilesAndPR(opts) {
  const { token, owner, repo, base, files, title, body, branchPrefix } = opts;
  const baseSha = await getBranchSha(token, owner, repo, base);
  const branch = `${branchPrefix || 'edit'}/${Date.now()}`;
  await createBranch(token, owner, repo, branch, baseSha);
  for (const f of files) {
    await putFile(token, owner, repo, f.path, f.content, f.sha, branch, title);
  }
  const pr = await createPR(token, owner, repo, branch, base, title, body || '');
  return { ...pr, branch };
}
