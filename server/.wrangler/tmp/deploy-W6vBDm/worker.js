var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var REPO_CONFIG = {
  owner: "awadwd",
  repo: "ArknightsAuthorization_Series-mirror",
  branch: "dev"
};
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    try {
      if (path === "/api/auth/login" && method === "GET") {
        return handleOAuthLogin(request, env);
      }
      if (path === "/api/auth/callback" && method === "GET") {
        return handleOAuthCallback(request, env);
      }
      if (path === "/api/auth/validate" && method === "POST") {
        return handleAuthValidate(request, env);
      }
      if (path === "/api/auth/status" && method === "GET") {
        return handleAuthStatus(request, env);
      }
      if (path === "/api/proxy-image" && method === "GET") {
        return handleProxyImage(request);
      }
      if (path === "/api/repo/clone" && method === "POST") {
        return handleRepoClone(request, env);
      }
      if (path === "/api/repo/file" && method === "GET") {
        return handleRepoFile(request, env);
      }
      if (path === "/api/repo/save-and-pr" && method === "POST") {
        return handleSaveAndPR(request, env);
      }
      return jsonError("Not found", 404);
    } catch (error) {
      return jsonError(error.message, 500);
    }
  }
};
function handleOAuthLogin(request, env) {
  const scope = "repo read:user";
  const state = Math.random().toString(36).substring(7);
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(env.GITHUB_REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  return jsonResponse({ authUrl, state });
}
__name(handleOAuthLogin, "handleOAuthLogin");
async function handleOAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return htmlResponse("<h1>\u6388\u6743\u5931\u8D25</h1><p>\u7F3A\u5C11\u6388\u6743\u7801</p>");
  }
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: env.GITHUB_REDIRECT_URI
      })
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      return htmlResponse(`<h1>\u6388\u6743\u5931\u8D25</h1><p>${tokenData.error}</p>`);
    }
    const accessToken = tokenData.access_token;
    const userRes = await fetch("https://api.github.com/user", {
      headers: { "Authorization": `Bearer ${accessToken}`, "User-Agent": "Arknights-Tool" }
    });
    const userData = await userRes.json();
    await env.AUTH_STORE.put("current_auth", JSON.stringify({
      username: userData.login,
      token: accessToken,
      authenticated: true,
      expires: Date.now() + 864e5
    }), { expirationTtl: 86400 });
    return htmlResponse(`
      <!DOCTYPE html>
      <html>
      <head><title>\u6388\u6743\u6210\u529F</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 40px;">
        <h1 style="color: #2e7d32;">\u2713 \u6388\u6743\u6210\u529F</h1>
        <p>\u6B22\u8FCE, <strong>${userData.login}</strong></p>
        <script>
          if (window.opener) {
            window.opener.postMessage({
              type: 'github-oauth-success',
              user: '${userData.login}',
              token: '${accessToken}'
            }, '*');
          }
          setTimeout(() => window.close(), 1500);
        <\/script>
      </body>
      </html>
    `);
  } catch (error) {
    return htmlResponse(`<h1>\u6388\u6743\u5931\u8D25</h1><p>${error.message}</p>`);
  }
}
__name(handleOAuthCallback, "handleOAuthCallback");
async function handleAuthValidate(request, env) {
  const body = await request.json();
  const { username, token } = body;
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { "Authorization": `Bearer ${token}`, "User-Agent": "Arknights-Tool" }
    });
    if (res.ok) {
      const user = await res.json();
      await env.AUTH_STORE.put("current_auth", JSON.stringify({
        username: user.login,
        token,
        authenticated: true,
        expires: Date.now() + 864e5
      }), { expirationTtl: 86400 });
      return jsonResponse({ success: true, user: user.login });
    } else {
      return jsonResponse({ success: false, error: "Invalid token" }, 401);
    }
  } catch (error) {
    return jsonError(error.message, 500);
  }
}
__name(handleAuthValidate, "handleAuthValidate");
async function handleAuthStatus(request, env) {
  try {
    const authData = await env.AUTH_STORE.get("current_auth");
    if (!authData) {
      return jsonResponse({ authenticated: false, username: null });
    }
    const auth = JSON.parse(authData);
    if (auth.expires && auth.expires < Date.now()) {
      await env.AUTH_STORE.delete("current_auth");
      return jsonResponse({ authenticated: false, username: null });
    }
    return jsonResponse({
      authenticated: auth.authenticated,
      username: auth.username
    });
  } catch (error) {
    return jsonResponse({ authenticated: false, username: null });
  }
}
__name(handleAuthStatus, "handleAuthStatus");
async function getAuth(env) {
  const authData = await env.AUTH_STORE.get("current_auth");
  if (!authData) return null;
  const auth = JSON.parse(authData);
  if (auth.expires && auth.expires < Date.now()) {
    await env.AUTH_STORE.delete("current_auth");
    return null;
  }
  return auth;
}
__name(getAuth, "getAuth");
async function handleRepoClone(request, env) {
  const auth = await getAuth(env);
  if (!auth || !auth.authenticated) {
    return jsonError("Not authenticated", 401);
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}`, {
      headers: {
        "Authorization": `Bearer ${auth.token}`,
        "User-Agent": "Arknights-Tool"
      }
    });
    if (res.ok) {
      return jsonResponse({ success: true, message: "Repository accessible" });
    } else {
      const err = await res.json();
      return jsonResponse({ success: false, error: err.message }, res.status);
    }
  } catch (error) {
    return jsonError(error.message, 500);
  }
}
__name(handleRepoClone, "handleRepoClone");
async function handleRepoFile(request, env) {
  const auth = await getAuth(env);
  if (!auth || !auth.authenticated) {
    return jsonError("Not authenticated", 401);
  }
  const url = new URL(request.url);
  const filename = url.searchParams.get("filename");
  if (!filename) {
    return jsonError("Missing filename", 400);
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/contents/${filename}?ref=${REPO_CONFIG.branch}`, {
      headers: {
        "Authorization": `Bearer ${auth.token}`,
        "User-Agent": "Arknights-Tool",
        "Accept": "application/vnd.github.v3.raw"
      }
    });
    if (res.ok) {
      const content = await res.text();
      return jsonResponse({ content });
    } else {
      return jsonError("File not found", 404);
    }
  } catch (error) {
    return jsonError(error.message, 500);
  }
}
__name(handleRepoFile, "handleRepoFile");
async function handleSaveAndPR(request, env) {
  const auth = await getAuth(env);
  if (!auth || !auth.authenticated) {
    return jsonError("Not authenticated", 401);
  }
  const body = await request.json();
  const { filename, content, commitMessage } = body;
  try {
    const fileRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/contents/${filename}?ref=${REPO_CONFIG.branch}`, {
      headers: {
        "Authorization": `Bearer ${auth.token}`,
        "User-Agent": "Arknights-Tool"
      }
    });
    if (!fileRes.ok) {
      return jsonError("File not found", 404);
    }
    const fileData = await fileRes.json();
    const sha = fileData.sha;
    const branchName = `update/${filename.replace(".json", "")}-${Date.now()}`;
    const refRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/refs/heads/${REPO_CONFIG.branch}`, {
      headers: {
        "Authorization": `Bearer ${auth.token}`,
        "User-Agent": "Arknights-Tool"
      }
    });
    const refData = await refRes.json();
    const baseSha = refData.object.sha;
    await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/refs`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${auth.token}`,
        "User-Agent": "Arknights-Tool",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha
      })
    });
    const updateRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/contents/${filename}`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${auth.token}`,
        "User-Agent": "Arknights-Tool",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: commitMessage,
        content: btoa(unescape(encodeURIComponent(content))),
        sha,
        branch: branchName
      })
    });
    if (!updateRes.ok) {
      const err = await updateRes.json();
      return jsonError(err.message, updateRes.status);
    }
    const prRes = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/pulls`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${auth.token}`,
        "User-Agent": "Arknights-Tool",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: commitMessage,
        head: branchName,
        base: REPO_CONFIG.branch,
        body: `\u81EA\u52A8\u521B\u5EFA\u7684 PR

\u4FEE\u6539\u6587\u4EF6: ${filename}`
      })
    });
    const prData = await prRes.json();
    if (prRes.ok) {
      return jsonResponse({ success: true, prUrl: prData.html_url });
    } else {
      return jsonError(prData.message, prRes.status);
    }
  } catch (error) {
    return jsonError(error.message, 500);
  }
}
__name(handleSaveAndPR, "handleSaveAndPR");
async function handleProxyImage(request) {
  const url = new URL(request.url);
  const imageUrl = url.searchParams.get("url");
  if (!imageUrl) {
    return jsonError("Missing url", 400);
  }
  const allowedHosts = ["i0.hdslb.com", "i1.hdslb.com", "i2.hdslb.com", "media.prts.wiki", "avatars.githubusercontent.com"];
  const urlObj = new URL(imageUrl);
  if (!allowedHosts.some((h) => urlObj.hostname.endsWith(h) || urlObj.hostname === h)) {
    return jsonError("Host not allowed", 403);
  }
  const res = await fetch(imageUrl, {
    headers: { "User-Agent": "Mozilla/5.0", "Referer": urlObj.origin }
  });
  if (!res.ok) {
    return jsonError("Failed to fetch", res.status);
  }
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buffer = await res.arrayBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400"
    }
  });
}
__name(handleProxyImage, "handleProxyImage");
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}
__name(jsonResponse, "jsonResponse");
function jsonError(message, status = 500) {
  return jsonResponse({ error: message }, status);
}
__name(jsonError, "jsonError");
function htmlResponse(html) {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
__name(htmlResponse, "htmlResponse");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
