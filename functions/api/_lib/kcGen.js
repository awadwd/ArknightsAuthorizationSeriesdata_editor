// 共享工具：知晓云拉取、kc-data.js 生成、推送到编辑器仓库
// 供 /api/admin/sync 与 /api/admin/tables 复用
export const KC_TABLES = [
  "Version", "choearth_notice", "more_notice", "questionnaire",
  "SearchWord_Version", "Guess_Version", "AiToolsConfig"
];

const KNOW_CLOUD_BASE = "https://21680db9b1362913357c.myminapp.com/hserve/v2.2";
const KNOW_CLOUD_CLIENT_ID = "21680db9b1362913357c";
const EDITOR_REPO = { owner: 'awadwd', repo: 'ArknightsAuthorizationSeriesdata_editor', branch: 'master' };
const KC_DATA_PATH = 'functions/api/kc-data.js';

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// 拉知晓云某表 record（匿名读，仅 client_id）
export async function fetchKnowCloudTable(table) {
  try {
    const resp = await fetch(
      KNOW_CLOUD_BASE + "/table/" + encodeURIComponent(table) + "/record/",
      { headers: { "X-Hydrogen-Client-ID": KNOW_CLOUD_CLIENT_ID } }
    );
    if (resp.status === 200) {
      const json = await resp.json();
      return json.objects || [];
    }
  } catch (e) {}
  return null;
}

const HANDLERS = `// ===== 自建 API 路由 =====
var KNOW_CLOUD_BASE = "https://21680db9b1362913357c.myminapp.com/hserve/v2.2";
var KNOW_CLOUD_CLIENT_ID = "21680db9b1362913357c";

function sendJson(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60"
    }
  });
}

function applyQuery(rows, url) {
  var params = new URL(url).searchParams;
  var orderBy = params.get("order_by");
  var result = rows.slice();
  if (orderBy) {
    var desc = orderBy.startsWith("-");
    var field = desc ? orderBy.slice(1) : orderBy;
    result.sort(function(a, b) {
      var av = Number(a[field]);
      var bv = Number(b[field]);
      if (!isNaN(av) && !isNaN(bv)) return desc ? bv - av : av - bv;
      var as = String(a[field] || "");
      var bs = String(b[field] || "");
      return desc ? bs.localeCompare(as) : as.localeCompare(bs);
    });
  }
  var offset = parseInt(params.get("offset") || "0", 10) || 0;
  var limit = parseInt(params.get("limit") || "0", 10) || 0;
  if (offset) result = result.slice(offset);
  if (limit) result = result.slice(0, limit);
  return result;
}

async function fallbackToKnowCloud(table) {
  try {
    var resp = await fetch(
      KNOW_CLOUD_BASE + "/table/" + encodeURIComponent(table) + "/record/",
      {
        method: "GET",
        headers: {
          "X-Hydrogen-Client-ID": KNOW_CLOUD_CLIENT_ID,
          "Content-Type": "application/json"
        }
      }
    );
    if (resp.status === 200) {
      var text = await resp.text();
      return new Response(text, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store"
        }
      });
    }
  } catch (e) {}
  return sendJson({ objects: [] }, 200);
}

export async function onRequest(context) {
  var pathname = new URL(context.request.url).pathname;
  var match = pathname.match(/^\\/api\\/kc\\/([^\\/]+)/);
  if (!match) {
    return sendJson({ error: "unknown route: " + pathname }, 404);
  }
  var table = decodeURIComponent(match[1]);
  var rows = KC_DATA[table];
  if (rows && Array.isArray(rows)) {
    var result = applyQuery(rows, context.request.url);
    return sendJson({ objects: result });
  }
  return await fallbackToKnowCloud(table);
}
`;

// 生成完整 kc-data.js 文件内容（KC_DATA 动态，handlers 静态）
export function buildKcDataJs(kcData) {
  const header = `// AUTO-GENERATED from 知晓云 API. Do not edit by hand.
// 数据来源：知晓云数据表 (KNOW_CLOUD_BASE)
// 由 /api/admin/sync 或 /api/admin/tables 自动生成
export const KC_DATA = ${JSON.stringify(kcData, null, 2)};

export const KC_TABLES = ${JSON.stringify(KC_TABLES, null, 2)};

`;
  return header + HANDLERS;
}

// 从编辑器仓库拉当前 KC_DATA
export async function fetchCurrentKcData(token) {
  const res = await fetch(
    `https://api.github.com/repos/${EDITOR_REPO.owner}/${EDITOR_REPO.repo}/contents/${KC_DATA_PATH}?ref=${EDITOR_REPO.branch}`,
    { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Arknights-Tool', Accept: 'application/vnd.github+json' } }
  );
  if (!res.ok) return null;
  const j = await res.json();
  const content = base64ToUtf8(j.content);
  const m = content.match(/export const KC_DATA = ([\s\S]*?);\n\nexport const KC_TABLES/);
  if (!m) return null;
  try {
    return { kcData: JSON.parse(m[1]), sha: j.sha };
  } catch (e) {
    return null;
  }
}

// 推送到编辑器仓库（建 PR + 自动 squash merge）
export async function pushKcData(token, kcData, commitMessage) {
  const content = buildKcDataJs(kcData);
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'Arknights-Tool',
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
  };
  const { owner, repo, branch } = EDITOR_REPO;
  const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, { headers });
  if (!refRes.ok) throw new Error('get base ref failed: ' + refRes.status);
  const baseSha = (await refRes.json()).object.sha;
  const branchName = `sync/${Date.now()}`;
  const refCreate = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: 'POST', headers, body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha })
  });
  if (!refCreate.ok) throw new Error('create branch failed: ' + (await refCreate.json()).message);
  const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${KC_DATA_PATH}`, { headers });
  const oldSha = fileRes.ok ? (await fileRes.json()).sha : null;
  const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${KC_DATA_PATH}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ message: commitMessage, content: utf8ToBase64(content), sha: oldSha, branch: branchName })
  });
  if (!updateRes.ok) throw new Error('update file failed: ' + (await updateRes.json()).message);
  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST', headers,
    body: JSON.stringify({ title: commitMessage, head: branchName, base: branch, body: '自动同步/编辑生成' })
  });
  if (!prRes.ok) throw new Error('create PR failed: ' + (await prRes.json()).message);
  const prData = await prRes.json();
  const mergeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prData.number}/merge`, {
    method: 'PUT', headers, body: JSON.stringify({ merge_method: 'squash' })
  });
  return { url: prData.html_url, merged: mergeRes.ok };
}
