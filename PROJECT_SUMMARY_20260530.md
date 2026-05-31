# Arknights Tool Editor - 项目完成总结

## 项目概述
为《明日方舟》授权工具系列项目开发的协作式Web编辑器，用于编辑三个核心JSON配置文件，并直接通过网站发起GitHub Pull Request。

## 已完成功能

### ✅ 核心功能
1. **Web界面JSON编辑器** - 基于Vue3 + Vite构建，支持编辑三个目标文件：
   - `Box_id.json` - 箱子ID配置
   - `Version.json` - 版本信息
   - `searchWord.json` - 搜索关键词

2. **GitHub OAuth集成** - 使用Personal Access Token进行身份验证
   -  securely存储凭据在本地`.env`文件中
   - 凭据不上传至任何服务器，仅用于本地验证

3. **Git操作后端** - Node.js + Express后端服务器：
   - 自动克隆/更新GitHub仓库
   - 创建新分支进行编辑（保护main分支）
   - 提交并推送更改
   - 自动创建Pull Request至`dev`分支

4. **分支保护机制** - 严禁直接提交到main分支：
   - 所有PR自动指向`dev`分支
   - 尝试提交到main分支将被拒绝
   - 在UI中明确警告用户

5. **手动Git命令生成** - 为无法运行Web应用的用户提供备用方案：
   - 一键生成完整的Git命令序列
   - 支持复制到剪贴板
   - 包含所有必要步骤和警告

6. **实时JSON验证** - 编辑时即时检查JSON格式正确性

## 技术架构

### 前端 (Vue 3 + Vite)
- **主组件**: `App.vue` - 包含完整编辑器界面和逻辑
- **样式**: `index.css` - 现代化UI设计，响应式布局
- **路由**: 单页面应用，无需额外路由

### 后端 (Node.js + Express)
- **服务器**: `server.js` - RESTful API端点
- **Git集成**: 使用`simple-git`库进行Git操作
- **GitHub API**: 使用`octokit`库创建Pull Request
- **数据存储**: 本地`data/`目录，包含配置文件和克隆的仓库

### 关键API端点
1. `POST /api/auth/validate` - 验证GitHub凭据
2. `GET /api/auth/status` - 检查认证状态
3. `POST /api/repo/clone` - 克隆/更新仓库
4. `GET /api/files/:filename` - 获取文件内容
5. `POST /api/files/save` - 保存文件并创建PR
6. `GET /api/manual-commands` - 获取手动Git命令

## 使用流程

### 1. 环境准备
```bash
# 安装依赖
npm install
cd server && npm install && cd ..

# 配置环境
cp server/.env.example server/.env
# 编辑server/.env填入GitHub用户名和Token
```

### 2. 启动应用
```bash
# 一键启动（推荐）
npm start

# 或分别启动
# 终端1: cd server && node server.js
# 终端2: npm run dev
```

### 3. 访问编辑器
打开浏览器访问: `http://localhost:5173`

### 4. 编辑工作流程
1. **身份验证** - 输入GitHub用户名和Personal Access Token
2. **仓库准备** - 点击"Clone/Update Repository"
3. **编辑文件** - 在三个JSON文件间切换编辑
4. **提交更改** - 输入提交信息，点击"Save & Create PR"
5. **创建PR** - 系统自动创建Pull Request至`dev`分支

## 安全特性

1. **本地凭据存储** - GitHub Token仅存储在本地`.env`文件
2. **分支保护** - 强制所有PR指向`dev`分支，保护`main`分支
3. **JSON验证** - 防止无效JSON提交
4. **身份验证** - 所有API请求需要有效的GitHub Token

## 备用方案

为无法运行Web应用的用户提供的手动Git命令：
```bash
# 克隆仓库
git clone https://github.com/awadwd/ArknightsAuthorization_Series-mirror.git

# 创建分支（严禁使用main）
git checkout -b edit-filename-$(date +%s)

# 编辑文件...
# 提交和推送...
# 在GitHub上创建PR至dev分支
```

## 文件结构

```
arknightstoolWorkspace/
├── server/                      # 后端服务器
│   ├── server.js               # 主服务器文件
│   ├── package.json            # 后端依赖
│   ├── .env.example           # 环境变量模板
│   └── data/                   # 本地数据存储
│       ├── config.json         # 配置文件
│       └── repo/               # 克隆的仓库
├── src/                        # 前端源码
│   ├── App.vue                # 主Vue组件
│   ├── main.js                # 应用入口
│   └── index.css              # 全局样式
├── index.html                  # HTML入口
├── vite.config.js              # Vite配置
├── package.json                # 前端依赖和脚本
├── start.js                    # 一键启动脚本
├── README.md                   # 完整文档
├── QUICKSTART.md               # 快速开始指南
└── PROJECT_SUMMARY_20260530.md # 本文件
```

## 后续改进建议

1. **增强错误处理** - 添加更详细的错误提示和恢复建议
2. **文件差异对比** - 在提交前显示更改差异
3. **多人协作** - 添加WebSocket支持实时协作编辑
4. **历史记录** - 查看文件编辑历史和回滚功能
5. **权限管理** - 细粒度的仓库访问权限控制
6. **自动化测试** - 添加单元测试和集成测试

## 重要注意事项

⚠️ **严禁提交到main分支** - 所有PR必须指向`dev`分支，否则将被拒绝
⚠️ **需要Git安装** - 系统必须安装Git才能使用克隆功能
⚠️ **GitHub Token权限** - 需要`repo`范围的Personal Access Token
⚠️ **JSON格式验证** - 编辑器会自动验证JSON格式，防止无效提交

## 访问链接

- **前端应用**: http://localhost:5173
- **后端API**: http://localhost:3000
- **GitHub仓库**: https://github.com/awadwd/ArknightsAuthorization_Series-mirror
- **GitCode镜像**: https://gitcode.com/huangjinzhou1/ArknightsAuthorization_Series

---

**项目状态**: ✅ 完成并可用
**创建时间**: 2026年5月30日
**版本**: 1.0.0
