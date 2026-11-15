// 审核通过 -> 直接把修改打进 Box_Id.json -> 开 PR（不再只改状态）
//
// 流程：
//   1) 读 feedback.json 找到这条反馈
//   2) 把 feedback.modifyData 作为补丁打到对应盒号记录上（支持 a.b.c 嵌套路径）
//   3) dryRun=true 时只返回 diff，给审核人确认（前端先预览再提交）
//   4) 正式提交：建分支 -> 改 Box_Id.json -> 开 PR，并把 prUrl 写回 feedback.json
//
// 注意：这里只开 PR 不合并。仓库的合并权限留在仓库管理员手里（和你现在的审核习惯一致）。

import { getAppConfig } from '../_lib/appConfig.js';
import { verifyRequest } from '../_lib/auth.js';
import { getRepoFile, putFile } from '../_lib/gh.js';
import { resolveTarget, readFile, commitAndOpenPR } from '../_lib/repoWrite.js';

const EDITOR_REPO = { owner: 'awadwd', repo: 'ArknightsAuthorizationSeriesdata_editor', branch: 'master' };
const BOX_FILE = 'Box_Id.json';

function cors() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: cors() });
}

// 中文字段名 -> 数据里的英文字段名（用户反馈里两种混着出现）
const FIELD_ALIAS = {
  '盒号': 'Box_id',
  '发售日期': 'release_date',
  '尺寸': 'size',
  '材质': 'material',
  '零售价': 'retail_price',
  '类型': 'type',
  '复刻': 'replicate',
  '官方图': 'Box_ImageUrl',
};

// 布尔型字段在数据里是字符串 "true"/"false"，用户填的是中文
const BOOL_WORDS = {
  '已复刻': 'true', '未复刻': 'false', '是': 'true', '否': 'false',
  '真': 'true', '假': 'false', '有': 'true', '无': 'false',
};

function coerce(oldVal, val) {
  if (val === null || val === undefined) return val;
  if (typeof oldVal === 'boolean') {
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    return s === 'true' || s === '是' || s === '1' || s === '有';
  }
  if (typeof oldVal === 'number') {
    const n = Number(String(val).replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? val : n;
  }
  if (typeof oldVal === 'string' && (oldVal === 'true' || oldVal === 'false')) {
    const s = String(val).trim();
    if (BOOL_WORDS[s]) return BOOL_WORDS[s];
    if (s === 'true' || s === 'false') return s;
    return s;
  }
  if (typeof oldVal === 'string') return String(val);
  return val;
}

function setPath(obj, path, value) {
  const parts = String(path).split('.').map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  const last = parts[parts.length - 1];
  const before = cur[last];
  cur[last] = coerce(before, value);
  return { path: parts.join('.'), before, after: cur[last] };
}

function normBoxId(v) {
  return String(v == null ? '' : v).trim().replace(/^0+/, '') || '0';
}

async function loadFeedback(token, cfg) {
  const fb = (cfg && cfg.feedback) || {};
  const path = fb.storagePath || 'feedback.json';
  const branch = fb.branch || EDITOR_REPO.branch;
  const file = await getRepoFile(token, EDITOR_REPO.owner, EDITOR_REPO.repo, path, branch);
  if (!file) throw new Error('feedback.json 读取失败');
  let list;
  try { list = JSON.parse(file.text); } catch (e) { throw new Error('feedback.json 不是合法 JSON'); }
  return { list, sha: file.sha, path, branch };
}

async function markApproved(token, ctx, feedbackId, reviewInfo) {
  const { list, sha, path, branch } = ctx;
  const idx = list.findIndex(f => String(f.id) === String(feedbackId));
  if (idx < 0) return false;
  list[idx].status = 'approved';
  list[idx].reviewInfo = reviewInfo;
  await putFile(token, EDITOR_REPO.owner, EDITOR_REPO.repo, path, JSON.stringify(list, null, 2), sha, branch,
    `review: 通过反馈 #${feedbackId}`);
  return true;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await verifyRequest(request);
  if (!auth) return json({ success: false, error: 'not authenticated' }, 401);
  if (!auth.isOwner) return json({ success: false, error: 'forbidden: only owner' }, 403);

  let body;
  try { body = await request.json(); } catch (e) { return json({ success: false, error: 'invalid JSON' }, 400); }
  const feedbackId = body && body.feedbackId;
  if (!feedbackId) return json({ success: false, error: 'feedbackId required' }, 400);

  const cfg = await getAppConfig(env);
  const editorToken = auth.source === 'github' ? auth.token : (env.GITHUB_TOKEN || auth.token);

  let fbCtx;
  try { fbCtx = await loadFeedback(editorToken, cfg); }
  catch (e) { return json({ success: false, error: e.message }, 500); }

  const feedback = fbCtx.list.find(f => String(f.id) === String(feedbackId));
  if (!feedback) return json({ success: false, error: '反馈不存在' }, 404);
  if (feedback.status === 'approved' && !body.reapply) {
    return json({ success: false, error: '该反馈已通过，如需重跑请带 reapply:true' }, 400);
  }

  const modify = feedback.modifyData || {};
  const keys = Object.keys(modify);
  if (!keys.length) return json({ success: false, error: '这条反馈没有修改内容，无法自动应用' }, 400);

  const target = resolveTarget(cfg, auth.source, body.target);
  const base = body.base || (cfg && cfg.pr && cfg.pr.defaultBaseBranch) || target.branch || 'main';

  let file;
  try { file = await readFile(target, auth.token, BOX_FILE, base); }
  catch (e) { return json({ success: false, error: e.message }, 500); }
  if (!file) return json({ success: false, error: `目标仓库里找不到 ${BOX_FILE}` }, 404);

  let boxes;
  try { boxes = JSON.parse(file.text); } catch (e) { return json({ success: false, error: 'Box_Id.json 解析失败' }, 500); }
  if (!Array.isArray(boxes)) return json({ success: false, error: 'Box_Id.json 不是数组' }, 500);

  const wanted = normBoxId(feedback.boxId);
  const box = boxes.find(b => normBoxId(b.Box_id) === wanted);
  if (!box) return json({ success: false, error: `Box_Id.json 里没有盒号 ${feedback.boxId}` }, 404);

  const diffs = [];
  for (const rawKey of keys) {
    const key = FIELD_ALIAS[rawKey] || rawKey;
    const d = setPath(box, key, modify[rawKey]);
    if (d) diffs.push(d);
  }

  if (body.dryRun) {
    return json({ success: true, dryRun: true, boxId: box.Box_id, diffs, target: { kind: target.kind, owner: target.owner, repo: target.repo, base } });
  }

  const title = `data(review#${feedback.id}): 盒号 ${feedback.boxId} 更新`;
  const bodyText = [
    '由审核通过自动生成。',
    '',
    '反馈 ID: ' + feedback.id,
    '盒号: ' + feedback.boxId,
    '提交人: ' + (feedback.contact || '匿名'),
    feedback.description ? '说明: ' + feedback.description : '',
    '',
    '改动:',
    ...diffs.map(d => `- ${d.path}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`),
  ].filter(Boolean).join('\n');

  let pr;
  try {
    pr = await commitAndOpenPR({
      target, token: auth.token, base,
      files: [{ path: BOX_FILE, content: JSON.stringify(boxes, null, 2), sha: file.sha }],
      title, body: bodyText, branchPrefix: 'review',
    });
  } catch (e) {
    return json({ success: false, error: e.message, diffs }, 500);
  }

  let marked = false;
  try {
    marked = await markApproved(editorToken, fbCtx, feedback.id, {
      reviewer: auth.username,
      reviewTime: new Date().toISOString(),
      reason: '',
      prUrl: pr.url,
      diffs,
    });
  } catch (e) { /* 标记失败不影响 PR 结果，前端提示手动确认 */ }

  return json({
    success: true,
    prUrl: pr.url,
    prNumber: pr.number,
    branch: pr.branch,
    diffs,
    marked,
    target: { kind: target.kind, owner: target.owner, repo: target.repo, base },
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}
