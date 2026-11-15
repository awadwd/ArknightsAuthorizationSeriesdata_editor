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

---

## 自动同步：为什么不生效，以及现在怎么修

### 原来的问题

旧实现的"自动同步"其实只挂在两个东西上：

1. 配置页的「立即同步一次」——**要人点**；
2. `.github/workflows/sync-knowcloud.yml` 的 `schedule: 0 * * * *`——理论上每小时跑。

实际跑出来是这个样子（`gh run list` 实测）：

```
02:30 → 22:14 → 17:52 → 11:20 → 03:00 → 22:27 …   间隔 4~6 小时
```

GitHub Actions 的 `schedule` 在低活跃仓库上会被大幅推迟，再加上旧代码**每次同步都提一个 PR**（哪怕数据没变），
于是"看起来同步成功、实际什么都没变"。结论：**只靠 Actions 的 cron 保证不了时效**。

### 现在的三条通道

| 通道 | 触发方式 | 特点 |
| --- | --- | --- |
| Cloudflare Cron（主） | `server/wrangler.toml` 的 `[triggers] crons = ["*/30 * * * *"]` | 平台级触发，最稳；每 30 分钟打一次 `/api/admin/sync` |
| GitHub Actions（备） | 每 30 分钟 + 手动 dispatch | bot 直接改 `kc-data.js` 并 push，push 后可触发 Pages 部署钩子 |
| 页面自愈（兜底） | 打开「配置管理」时若已过期 | 静默补跑一次，谁打开后台谁就把数据刷新 |

### 需要配置的环境变量

在 **Cloudflare Pages → Settings → Environment variables**（Production）里加：

| 变量 | 作用 | 必需 |
| --- | --- | --- |
| `SYNC_TOKEN` | 机器触发口令。Worker cron / 任意外部 cron 带着它打 `/api/admin/sync` 就算 owner，不需要谁的 PAT | 是（不配就只剩手动+页面自愈） |
| `SYNC_GITHUB_TOKEN` | 机器触发时用来推送仓库的 PAT（`repo` 权限）。不填则回落到 `GITHUB_TOKEN` | 是 |
| `PAGES_DEPLOY_HOOK` | Pages 的 Deploy Hook URL。同步合并后立刻触发重建，避免"仓库更新了线上还是旧数据" | 强烈建议 |
| `GITHUB_TOKEN` | 反馈读写、审核相关（原有） | 是 |

Worker 侧（`cd server && wrangler secret put SYNC_TOKEN`）只需要 `SYNC_TOKEN`；
`EDITOR_API_BASE` 已写在 `server/wrangler.toml`，指向 Pages 域名。

配好后验证：

```bash
# 机器身份同步（不需要浏览器）
curl -X POST https://<你的 pages 域名>/api/admin/sync \
  -H "X-Sync-Token: $SYNC_TOKEN" -H "Content-Type: application/json" -d '{}'
# 返回 status.results 里每张表的 行数 / 耗时 / 是否变更
```

同步行为的变化：**数据没变就不再提 PR**（返回 `changed:false`）；单表拉取失败会保留旧数据，不会把表清空。

---

## 数据表页（对齐知晓云的操作逻辑）

导航「数据表」是照着知晓云控制台做的，用法一样：

- 左边选表（带行数），右边表格；
- 点「编辑」改一行（对象/数组字段用 JSON 编辑），「添加行」新增，「删除」删行，支持勾选批量删；
- 搜索框过滤任意字段，分页 20/50/100，右上「列显示」控制展示哪些列；
- **改动先攒着**，右上角显示「N 处待提交」，点一次「提交」把所有增删改合并成一个 PR；
- 左下「对比线上」会拉一份知晓云当前数据，逐表标「一致 / 不同 / 失败」，可以一键"以线上覆盖本地"再提交。

底层接口就是 `POST /api/admin/tables`，支持 `{ table, ops:[{op:'insert'|'update'|'delete', ...}] }`，
同时兼容旧的 `{ table, rows }` / `{ kcData }`。

---

## 市价（千岛 → Box_Id.json 的 market_price）

`Box_Id.json` 里每个干员是 `market_price: { ELITE1, ELITE2 }`。导航「市价」页负责把它自动化。

### 千岛怎么接（重要）

`api.qiandao.com` 挂在**阿里云 WAF** 后面：裸请求会被 `acw_sc__v2` 挑战页挡住，而且有频率限制
（实测连发几次就返回 `405 您的手速也太快了`）。所以不要指望「服务端自己搓签名」，
正确做法是**用你自己已经通过校验的浏览器读一次**，把结果交给服务端：

1. 打开 `https://qiandao.com/island?id=300569`（明日方舟岛），F12 → Console；
2. 页面上点「复制采集脚本」（源码在 `public/qiandao-collector.js`），整段粘进控制台回车；
3. 在页面上切分类 / 往下滚 / 搜「通行证」，让列表重新请求（脚本只能记录粘贴之后的请求）；
4. `__QD.samples()` 看抓到什么 → `__QD.copy()` 复制；
5. 粘回「市价 → 千岛接入」，点「保存并解析」。

存下来的是 `{ cookie, ua, apis[], samples[] }`，写在 KV 的 `qiandao_session` 一个 key 里，
不进 git、不进 config，接口回显一律打码。之后：

- **服务端重放**：拿这份 cookie 重放 `apis` 里记的接口 → 拿到最新价（能连上就自动刷新）；
- **连不上**（WAF 拦了/限流了）→ 自动退回 bundle 里那次抓到的快照，并在结果里标 `stale`，
  面板上会写「服务端直连失败，用的是快照」。点「测试服务端直连」可以随时看是哪条路。

### 价格从哪来

实测可用接口：`GET https://api.qiandao.com/gactus/posts/by-tag-v4`（带 `acw_sc__v2` / `acw_sc__v3`），
返回 `data.posts[].labels[].spu`：

```json
{ "name": "塔露拉(精英二VER.)-通行认证56.0", "strikePrice": "39.27", "minOnlinePrice": "41" }
```

- `strikePrice` = 市价（成交/划价），默认取它；`minOnlinePrice` = 目前最低在售，可在面板里切换；
- 商品名自带精英化：`XX-通行认证56.0` 是**精英一**，`XX(精英二VER.)-通行认证56.0` 是**精英二**；
- 同一条帖子会带多个 SPU、多条帖子会引用同一个 SPU，所以按 **SPU id 去重**，不是按帖子；
- 同名的不同弹（通行认证56.0 / 55.0…）价格差很多，面板里「只取某一弹」可以钉死一个系列，留空则混算。

接口换形状时还有兜底：从任意 JSON 里找「带价格的数组对象」，用标题 + 精一/精二识别，
这条路的样本建议把「最少样本数」调到 3 以上。

### 其余

1. **来源**三选一：`千岛行情` / `手工价表`（`{ 干员名: { ELITE1, ELITE2 } }`，永远可用）/ `导入`（JSON 或 `name,elite,price` CSV）。
2. **聚合**：同一干员+精英化取中位数，按 MAD 剔除离谱报价；样本数 < `minSamples` 不覆盖旧价
   （SPU 报价本身是权威值，默认 1；走标题解析时建议 3+）。只有单边价格时默认**不**用比例推算另一边。
3. **写回**：只改 `market_price`，走 PR（分支前缀 `prices/`），PR 描述里带涨跌清单。
   价格保留两位小数（`39.27` 不会被抹成 `39`）。
4. **匹配**：SPU 名先做精确名匹配，落不到再按标题包含匹配，避免「阿米娅」吃掉「阿米娅(近卫)」。
   匹配不上的记在 `unmatched` 里。

自动刷新：Worker cron 每 12 小时调一次 `POST /api/prices?action=apply`（见 `server/worker.js` 的 `scheduled`）。
会话过期（cookie 约 1 小时）后重放会失败并退回快照，重新抓一次即可。

---

## 审核通过 → 直接提 PR

审核页点「通过」不再是只改状态：

1. 先 `dryRun` 叫后端把 `feedback.modifyData` 打进 `Box_Id.json`，返回逐字段 diff（`旧值 → 新值`）；
2. 弹窗确认；确认后建分支 `review/<id>`、改文件、开 PR，并把 `prUrl` 写回 `feedback.json` 的 `reviewInfo`；
3. PR 合并权限仍然在仓库管理员手里（不自动 merge）。

`modifyData` 的 key 支持盒级字段（`type` / `replicate` / `retail_price`）也支持干员级嵌套路径
（`character1.market_price.ELITE2`、`character3.hotcharacter`）；中文字段名会被映射到英文字段名，
`已复刻/未复刻` 这类中文布尔值会转成数据里用的 `"true"/"false"`。目标仓库默认跟登录账号的源一致，
也可以在请求里用 `target: 'github' | 'gitcode'` 指定。
