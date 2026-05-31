# 部署指南 — GitHub + Cloudflare Pages

## 第一步：推送到 GitHub

### 1. 在 GitHub 创建新仓库

1. 打开 https://github.com/new
2. Repository name: `arknights-tool-editor`
3. 选择 **Public**
4. **不要**勾选 "Add a README file"
5. 点击 **Create repository**

### 2. 推送代码

在本地执行：

```powershell
cd "D:\Users\huang\文档\HBuilderProjects\arknightstoolWorkspace"

# 添加远程仓库（替换 YOUR_USERNAME 为你的 GitHub 用户名）
git remote add origin https://github.com/YOUR_USERNAME/arknights-tool-editor.git

# 推送
git push -u origin master
```

---

## 第二步：创建生产环境 OAuth App

1. 打开 https://github.com/settings/developers
2. 点击 **"New OAuth App"**
3. 填写：
   - **Application name**: `Arknights Tool Editor (Production)`
   - **Homepage URL**: `https://arknights-tool-editor.pages.dev`
   - **Authorization callback URL**: `https://arknights-api.workers.dev/api/auth/callback`
4. 创建后记下 **Client ID** 和 **Client Secret**

---

## 第三步：部署后端到 Cloudflare Workers

### 方案 A：Cloudflare Workers（推荐）

1. 安装 Wrangler：
```powershell
npm install -g wrangler
```

2. 登录 Cloudflare：
```powershell
wrangler login
```

3. 创建 Worker 项目（在 server 目录）：
```powershell
cd server
wrangler init arknights-api
```

4. 配置 `wrangler.toml`：
```toml
name = "arknights-api"
main = "server.js"
compatibility_date = "2024-01-01"

[vars]
GITHUB_CLIENT_ID = "你的生产ClientID"
GITHUB_REDIRECT_URI = "https://arknights-api.workers.dev/api/auth/callback"

[[secrets]]
# 运行 wrangler secret put GITHUB_CLIENT_SECRET 设置
```

5. 设置密钥：
```powershell
wrangler secret put GITHUB_CLIENT_SECRET
# 输入你的 Client Secret
```

6. 部署：
```powershell
wrangler deploy
```

### 方案 B：Railway / Render / Fly.io（更简单）

这些平台原生支持 Node.js，直接部署 server 目录即可。

**Railway 示例**：
1. 打开 https://railway.app
2. New Project → Deploy from GitHub repo
3. 选择 `arknights-tool-editor` 仓库
4. Root Directory: `server`
5. 添加环境变量：
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `GITHUB_REDIRECT_URI`

---

## 第四步：部署前端到 Cloudflare Pages

1. 打开 https://dash.cloudflare.com
2. 左侧菜单 → **Workers & Pages** → **Create application**
3. 选择 **Pages** → **Connect to Git**
4. 选择你的 GitHub 仓库 `arknights-tool-editor`
5. 配置构建：
   - **Production branch**: `master`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
6. 添加环境变量：
   - `VITE_API_BASE_URL` = `https://arknights-api.workers.dev`（或你的后端地址）
   - `NODE_VERSION` = `22`
7. 点击 **Save and Deploy**

---

## 第五步：更新 OAuth App 回调地址

部署完成后，如果你的域名不是 `arknights-tool-editor.pages.dev`：

1. 回到 GitHub OAuth App 设置
2. 更新 **Homepage URL** 和 **Authorization callback URL**

---

## 最终架构

```
用户浏览器
    ↓
Cloudflare Pages (前端静态)
https://arknights-tool-editor.pages.dev
    ↓ API 调用
Cloudflare Workers (后端)
https://arknights-api.workers.dev
    ↓
GitHub API (OAuth + 仓库操作)
```

---

## 本地开发

创建 `.env` 文件：
```
VITE_API_BASE_URL=http://localhost:3000
```

启动：
```powershell
# 后端
cd server
node server.js

# 前端
npm run dev
```

---

## 注意事项

1. **Client Secret 绝对不能暴露在前端代码中**
2. **OAuth callback URL 必须和后端地址匹配**
3. **Cloudflare Workers 免费版有 10万请求/天限制**
4. **Git clone 操作可能需要优化**（Workers 有 CPU 时间限制）

---

## 快速部署（推荐）

如果觉得 Cloudflare Workers 配置复杂，可以用 **Railway**：

1. 后端：https://railway.app → 部署 server 目录
2. 前端：Cloudflare Pages → 部署根目录
3. 设置 `VITE_API_BASE_URL` 指向 Railway 后端

Railway 免费版：500小时/月，足够个人使用。
