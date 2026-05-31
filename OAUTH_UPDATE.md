# OAuth 配置更新指南

## GitHub OAuth App 设置

1. 打开 https://github.com/settings/developers
2. 找到你的 OAuth App（Arknights Tool Editor）
3. 更新：

| 字段 | 值 |
|------|-----|
| Homepage URL | `https://arknightsauthorizationseriesdataeditor.pages.dev` |
| Authorization callback URL | `https://arknights-api.2726269007.workers.dev/api/auth/callback` |

## 部署信息

- **前端**: https://arknightsauthorizationseriesdataeditor.pages.dev
- **后端**: https://arknights-api.2726269007.workers.dev

## 环境变量

### Cloudflare Worker (已设置)
- `GITHUB_CLIENT_ID`: ✓
- `GITHUB_CLIENT_SECRET`: ✓
- `GITHUB_REDIRECT_URI`: `https://arknights-api.2726269007.workers.dev/api/auth/callback`

### Cloudflare Pages (需要设置)
在 Pages 项目设置中添加：
- `VITE_API_BASE_URL`: `https://arknights-api.2726269007.workers.dev`
