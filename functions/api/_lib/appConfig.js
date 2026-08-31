// 应用配置：读 KV config key，fallback 到硬编码默认值。
// 复用 AUTH_STORE 这个 KV namespace，key 区分（current_auth / config），无需新增 KV 绑定。
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
};

export async function getAppConfig(env) {
  try {
    const raw = await env.AUTH_STORE && env.AUTH_STORE.get('config');
    if (raw) {
      const parsed = JSON.parse(raw);
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
  await env.AUTH_STORE.put('config', JSON.stringify(cfg));
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