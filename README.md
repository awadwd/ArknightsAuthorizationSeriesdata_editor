Arknights Tool Editor

一款基于网页的协作编辑器，用于开发、编辑明日方舟授权系列项目的 JSON 配置文件功能特性

✅ **网页端 JSON 编辑器** - 可直接在浏览器内编辑 Box_id.json、Version.json、searchWord.json

✅ **GitHub 对接** - 使用 GitHub 账号鉴权，编辑器内直接创建 Pull Request

✅ **分支保护机制** - 禁止向 main 分支提交 PR，此类 PR 会被直接驳回

✅ **手动 Git 指令** - 无法运行网页端程序时，可一键复制全套 Git 操作命令

✅ **JSON 实时校验** - 实时检测 JSON 语法格式是否合法环境前置要求

1. **系统必须安装 Git**
  
  * 下载地址：[https://git-scm.com/downloads](https://link.wtturl.cn/?target=https%3A%2F%2Fgit-scm.com%2Fdownloads&scene=im&aid=497858&lang=zh "autolink")
  * 校验安装：在终端执行 `git --version`
2. **GitHub 账号 + 个人访问令牌 (PAT)**
  
  * 创建令牌页面：[https://github.com/settings/tokens](https://link.wtturl.cn/?target=https%3A%2F%2Fgithub.com%2Fsettings%2Ftokens&scene=im&aid=497858&lang=zh "autolink")
  * 所需权限范围：`repo`（完整仓库读写权限）
3. **Node.js（v14 及以上版本）**
  
  * 下载地址：[https://nodejs.org/](https://link.wtturl.cn/?target=https%3A%2F%2Fnodejs.org%2F&scene=im&aid=497858&lang=zh "autolink")

安装与部署步骤

### 第一步：克隆仓库

bash

运行 # 克隆GitHub镜像仓库 git clone https://github.com/awadwd/ArknightsAuthorization_Series-mirror.git cd ArknightsAuthorization_Series-mirror/arknightstoolWorkspace

### 第二步：安装依赖包

bash

运行 # 安装前端依赖 npm install # 安装后端服务依赖 cd server npm install cd ..

### 第三步：配置环境变量

bash

运行 # 复制环境变量示例文件 cp server/.env.example server/.env # 编辑 server/.env 文件，填入你的GitHub账号信息 # GITHUB_USERNAME=你的GitHub用户名 # GITHUB_TOKEN=你的个人访问令牌

### 第四步：启动程序

bash

运行 # 终端1：启动后端服务 cd server node server.js # 开发热更新模式（自动重启）： # npm run dev # 终端2：启动前端开发服务 npm run dev

### 第五步：打开编辑器页面

浏览器访问以下地址即可使用：

plaintext http://localhost:5173使用教程

### 1. 账号鉴权

* 输入你的 GitHub 用户名与个人访问令牌
* 账号凭证仅本地存储，不会上传至任何服务端
* 点击「鉴权验证」校验账号有效性

### 2. 仓库初始化

* 点击「克隆 / 更新仓库」，将代码仓库拉取至本地
* 仓库文件存放路径：`server/data/repo/`

### 3. 文件编辑

* 切换标签页分别编辑 `Box_id.json`、`Version.json`、`searchWord.json`
* 在编辑器内直接修改 JSON 内容
* 实时语法校验提示 JSON 是否格式正确

### 4. 保存修改并提交 PR

* 填写提交说明，清晰描述本次修改内容
  
* 点击「保存并创建 PR」
  
* 编辑器将自动执行以下流程：
  
  1. 创建全新分支（永远不会直接提交至 main 分支）
  2. 将修改写入对应配置文件
  3. 提交代码并推送至远程仓库
  4. 向 **dev 分支** 发起 Pull Request（禁止提交至 main）

### 5. 手动 Git 操作指令

若无法运行网页端程序，点击「获取手动 Git 命令」，复制终端可直接执行的全套 Git 操作指令。重要规范

🚫 **严禁向 main 分支提交 PR** - 此类 PR 会被直接驳回

✅ **所有 Pull Request 必须提交至 dev 分支**

✅ **保存前务必校验 JSON 格式** - 非法 JSON 会引发程序报错

✅ **提交说明需清晰易懂**，方便审核人员快速理解修改内容项目目录结构

plaintext arknightstoolWorkspace/ ├── server/ # Node.js后端服务 │ ├── server.js # 服务主程序 │ ├── package.json # 后端依赖配置 │ ├── .env.example # 环境变量模板文件 │ └── data/ # 本地数据存储（仓库、配置） │ ├── config.json # 本地程序配置 │ └── repo/ # 本地克隆的代码仓库 ├── src/ # Vue.js前端项目 │ ├── App.vue # 主页面组件 │ ├── main.js # Vue程序入口 │ └── index.css # 全局样式文件 ├── public/ # 静态资源文件夹 ├── index.html # HTML入口页面 ├── package.json # 前端依赖配置 ├── vite.config.js # Vite打包配置 └── README.md # 本说明文档后端接口列表

后端服务提供以下 API 接口：

* `POST /api/auth/validate` - 校验 GitHub 账号令牌有效性
* `GET /api/auth/status` - 查询当前鉴权状态
* `POST /api/repo/clone` - 克隆 / 更新本地仓库
* `GET /api/files/:filename` - 读取指定 JSON 文件内容
* `POST /api/files/save` - 保存文件并自动创建 PR
* `GET /api/manual-commands` - 获取手动 Git 操作指令
* `POST /api/repo/protect-main` - 锁定 main 分支（管理员权限）

常见问题排查

### 账号鉴权失败

* 确认令牌已勾选 `repo` 权限范围
* 核对 GitHub 用户名输入无误
* 检查令牌是否过期失效

### 仓库克隆失败

* 检查本地网络连通性
* 确认你拥有该仓库访问权限
* 确认 Git 已正确安装并配置环境变量

### JSON 格式校验报错

* 使用在线 JSON 校验工具检查语法
* 常见错误：缺少逗号、括号未闭合、末尾多余逗号

### 创建 PR 失败

* 确认未尝试向 main 分支推送代码
* 保证新建分支名称不重复
* 确认你的账号拥有仓库推送权限

项目贡献规范

1. 基于 `dev` 分支新建开发分支（禁止从 main 分支创建）
2. 完成代码修改
3. 完整自测修改内容
4. 向 `dev` 分支提交 Pull Request
5. 等待管理员审核通过后合并

开源协议

本项目采用 MIT 开源协议，详情参阅 LICENSE 文件。问题反馈渠道

遇到程序 bug 或疑问可通过以下渠道反馈：

* GitHub 议题：[https://github.com/awadwd/ArknightsAuthorization_Series-mirror/issues](https://link.wtturl.cn/?target=https%3A%2F%2Fgithub.com%2Fawadwd%2FArknightsAuthorization_Series-mirror%2Fissues&scene=im&aid=497858&lang=zh "autolink")
* GitCode 镜像议题：[https://gitcode.com/huangjinzhou1/ArknightsAuthorization_Series/issues](https://link.wtturl.cn/?target=https%3A%2F%2Fgitcode.com%2Fhuangjinzhou1%2FArknightsAuthorization_Series%2Fissues&scene=im&aid=497858&lang=zh "autolink")
