// 仓库所有者白名单（硬编码）。"仓库所有者" = 能改服务端配置的账户。
// 调整此名单需重部署（设计如此：owner 名单本身是基础设施，不应运行时改）。
const OWNER_USERS = {
  github: new Set(['awadwd']),
  gitcode: new Set(['huangjinzhou1']),
};

export function isOwner(username, source) {
  if (!username) return false;
  const u = String(username).toLowerCase();
  const list = OWNER_USERS[source || 'github'] || OWNER_USERS.github;
  return list.has(u);
}

export function getOwnerList(source) {
  return Array.from(OWNER_USERS[source] || OWNER_USERS.github);
}