// 应用配置：读 KV `config` key，fallback 到硬编码默认值。
// 复用 AUTH_STORE 这个 KV namespace，key 区分（`current_auth` / `config`），无需新增 KV 绑定。
// 硬编码 fallback 必须永远可用：保证首次部署 / KV 数据丢失 / 解析失败时系统仍能跑。

export const DEFAULT_CONFIG = {
  repoConfigs: {
    github: {
      owner: 'awadwd',
      repo: 'ArknightsAuthorization_Series-mirror',
      branch: 'dev',
    },
    gitcode: {
      owner: 'huangjinzhou1',
      repo: 'ArknightsAuthorization_Series',
      branch: 'dev',
    },
  },
  editorFiles: ['Box_Id.json', 'Version.json', 'searchWord.json'],
  oauth: {
    githubClientId: '',     // 留空 = 用 env.GITHUB_CLIENT_ID
    githubScope: 'repo read:user',
    gitcodeClientId: '94ab054141264207b31c98c85e52d3b8',
    gitcodeScope: 'user project',
  },
  pr: {
    defaultBaseBranch: 'dev',
    commitMessageTemplate: 'edit: {filename} via 通行证工具编辑器',
  },
  feedback: {
    storagePath: 'feedback.json',
    branch: 'master',
  },
  // 自动同步：定时从知晓云拉数据表 -> 重写 kc-data.js
  // 频率以 intervalMinutes 为准（Cron/Workflow 都读它），schedule 只作展示
  autoSync: {
    enabled: true,
    intervalMinutes: 30,
    staleMinutes: 90,
    schedule: '*/30 * * * *',
    source: 'knowcloud',
    tables: ['Version', 'choearth_notice', 'more_notice', 'questionnaire', 'SearchWord_Version', 'Guess_Version', 'AiToolsConfig', '224660'],
    lastRunAt: null,
    lastTrigger: null,
    lastChanged: null,
    lastResult: null,
  },
  // 市价：可插拔数据源（千岛 / 手工 / 导入），聚合后写回 Box_Id.json 的
  // characterN.market_price.{ELITE1,ELITE2}
  prices: {
    enabled: true,
    provider: 'qiandao',          // qiandao | manual | import
    autoRefresh: true,
    refreshHours: 12,
    minSamples: 1,                 // 少于这个样本数不覆盖旧价（SPU 报价本身是权威值，1 就够；
                                  // 若走「帖子正文解析」建议调到 3 以上）
    outlierMad: 3,                 // 中位数绝对偏差倍数，超过视为异常报价
    elite1Ratio: 0.72,             // 只有综合价时，精一按精二的这个比例折算（需 deriveMissing）
    deriveMissing: false,          // 是否允许用比例推算缺的精英化价格（默认关，避免凭空改价）
    requirePassKeyword: true,      // 只认标题里带「通行证」的记录，过滤掉同岛的其他周边帖
    // 千岛：主力是「浏览器控制台采集」（见 public/qiandao-collector.js），
    // endpoint 那套只在确实有稳定公开接口时才有用。
    qiandao: {
      islandId: '300569',          // 明日方舟岛
      islandName: '明日方舟岛',
      // 采集令牌：油猴脚本 / 第三方页面凭借它调用 action=save-session。
      // 只能写会话缓存，读不到配置、提不了 PR；生成与清空走 action=collect-token。
      collectToken: '',
      collectTokenAt: null,
      // 实测可用：POST/GET https://api.qiandao.com/gactus/posts/by-tag-v4（需要带 acw_sc__v2/v3）
      endpoint: 'https://api.qiandao.com/gactus/posts/by-tag-v4',
      method: 'GET',
      headers: {},
      body: '',
      // 价格来源：strikePrice=市价（成交/划价）｜minOnlinePrice=最低在售
      priceField: 'strikePrice',
      // 只取某一弹，例如「通行认证56.0」；留空=全部系列混在一起算
      seriesFilter: '',
      // 返回值里怎么取：items 指向数组，其余是数组元素的字段路径
      mapping: { items: 'data.posts', name: 'title', elite: 'elite', price: 'price', time: 'updatedAt' },
      // 关键词模板，{name} 会被替换成干员名
      keyword: '明日方舟 通行证 {name}',
    },
    manual: {},                    // { 干员名: { ELITE1: 100, ELITE2: 112 } }
    // 抓取任务：慢速分页 + 退避等待 + 断点续跑 + 一月一轮
    crawl: {
      enabled: true,
      refreshDays: 30,             // 一轮抓完 30 天内不再自动重开
      maxPagesPerRun: 3,           // 每次 cron 醒来最多抓几页
      delayMs: 3000,               // 页间隔；撞限流会自动翻倍（有上限）
      maxDelayMs: 30000,
      backoffMinutes: [15, 25, 40, 120, 720],  // 连续失败后的等待阶梯（前几档还在 cookie 寿命内）
      maxPages: 60,                // 翻页安全上限
    },
    lastRunAt: null,
    lastResult: null,
  },
};

export async function getAppConfig(env) {
  try {
    // 注意这里必须是 `env.AUTH_STORE ? await ... : null`：
    // 写成 `await env.AUTH_STORE && env.AUTH_STORE.get('config')` 时，await 只作用于
    // 前半截，整个表达式返回的是没被 await 的 Promise，JSON.parse 会拿到 "[object Promise]"
    // 然后永远 fallback 到默认值——配置存进去了却读不出来。
    const raw = env && env.AUTH_STORE ? await env.AUTH_STORE.get('config') : null;
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return deepMerge(clone(DEFAULT_CONFIG), parsed);
    }
  } catch (e) {
    console.error('getAppConfig fallback to defaults:', e && e.message);
  }
  return clone(DEFAULT_CONFIG);
}

export async function saveAppConfig(env, cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error('config must be a non-null object');
  }
  if (!env || !env.AUTH_STORE) throw new Error('AUTH_STORE 未绑定，无法保存配置');
  await env.AUTH_STORE.put('config', JSON.stringify(cfg));
  return cfg;
}

// 局部更新：把 patch 深合并进「当前配置」再写回。
// 为什么必须这样：前端配置页只认识 repoConfigs/editorFiles/oauth/pr/feedback/autoSync 这几块，
// 整包 POST 上去会把 prices（含 qiandao 采集令牌、crawl 进度）整块抹掉，
// 表现为「改完一个开关，采集令牌就失效了」。走 patch 就只动真的改了的键。
// 写入时间戳 `_savedAt` 一并落盘：读取端据此判断「读回来的到底是不是我刚写的那份」。
export async function patchAppConfig(env, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('patch must be a non-null object');
  }
  const cur = await getAppConfig(env);
  const next = deepMerge(clone(cur), patch);
  next._savedAt = new Date().toISOString();
  await saveAppConfig(env, next);
  return next;
}

// Simple JSON deep clone (CF Workers runtime 无 structuredClone，2024 仍部分支持，用 JSON 兜底最稳)
function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// Deep merge: source 优先；Object 递归，Array 直接替换。
// source 显式给 null/undefined 保留 target；显式给空对象 {} 也保留 target 子键（设计如此）。
function deepMerge(target, source) {
  if (source === null || source === undefined) return target;
  if (typeof source !== 'object' || typeof target !== 'object') return source;
  if (Array.isArray(source)) return source.slice();
  const out = {};
  for (const k of Object.keys(target)) out[k] = target[k];
  for (const k of Object.keys(source)) {
    const sv = source[k];
    const tv = target[k];
    if (sv !== null && typeof sv === 'object' && !Array.isArray(sv) &&
        tv !== null && typeof tv === 'object' && !Array.isArray(tv)) {
      out[k] = deepMerge(tv, sv);
    } else {
      out[k] = sv;
    }
  }
  return out;
}
