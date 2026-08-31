// 仓库所有者白名单（硬编码）。"仓库所有者" = 能改服务端配置的账户。
// 调整此名单需重部署（设计如此：owner 名单本身是基础设施，不应运行时改）。
const OWNER_USERS = {
  github: new Set(['awadwd']),
  gitcode: new Set(['huangjinzhou1']),
};

// 任何 source 下，只要 username 在任一 owner 列表里即视为 owner。
// 原因：早期登录可能未写入 source 字段 / source 不规范，按 source 严格分流会漏判。
export function isOwner(username, source) {
  if (!username) return false;
  const u = String(username).toLowerCase();
  for (const list of Object.values(OWNER_USERS)) {
    if (list.has(u)) return true;
  }
  return false;
}

export function getOwnerList(source) {
  return Array.from(OWNER_USERS[source] || OWNER_USERS.github);
}
