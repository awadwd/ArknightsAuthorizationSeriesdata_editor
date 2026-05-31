# 2026-05-31：多语言 + CSS 重构

## 完成内容

### 1. i18n 多语言系统（参考 ACGTI 项目）
- `src/i18n/types.ts` — 定义 SUPPORTED_LOCALES / DEFAULT_LOCALE / AppLocale
- `src/i18n/messages.ts` — 4种语言完整翻译（zh-CN/zh-TW/en/ja）
- `src/i18n/index.ts` — i18n composable：initI18n / setLocale / t / tm / useI18n

### 2. CSS 设计系统（参考 ACGTI 16Personalities 风格）
- `src/index.css` — 完整重写，约 900 行
- 明日方舟风格配色（蓝青 #0078d4 为主色）
- 完整设计系统：CSS 变量、Header、导航、Hero、Auth、Editor、Footer
- 响应式布局、移动端适配

### 3. App.vue 重写
- `src/App.vue` — 完整重写，约 500 行
- 干净 Vue 3 Composition API + Options API 混用
- 完整 i18n 集成：Header 标题、导航、认证、编辑器、Footer
- 语言切换下拉菜单（右上角）
- 功能：Auth / Clone / JSON Editor / Save+PR / Manual Commands

### 4. main.js 更新
- `src/main.js` — 初始化 i18n 再挂载 App

### 5. 后端 server.js 更新
- 修复 `/api/repo/clone`：URL 嵌入 Token + GIT_SSL_NO_VERIFY=true
- 新增 `GET /api/repo/file?filename=...`
- 新增 `POST /api/repo/save-and-pr`
- PR 强制指向 dev 分支（禁止 main）

## 待测试
- [ ] 前端启动后 `npm run dev`
- [ ] 后端启动 `cd server && node server.js`
- [ ] 浏览器打开 http://localhost:5173
- [ ] 测试认证 → 克隆 → 编辑 → 创建 PR 完整流程
