// 每日次数真源：把「游戏次数 / 今日宜挂次数」从本地缓存搬到服务端。
//
// 为什么需要它：次数原先只存在 uni storage 里，用户清一次缓存就能刷满，
// 分享/首胜奖励也能重复领取。这里改成服务端计次，本地只缓存显示值。
//
// 身份用的是设备指纹（客户端把 platform+机型+屏幕等哈希成 32 位 hex），
// 不采集原始机型信息，清缓存不会变，因此「清缓存重置次数」这条路被堵住。
//
// 接口：
//   GET  /api/quota?dk=<deviceKey>&day=2026-11-01
//        → { ok, day, game:{used,unlimited,bonus}, daily:{used,unlimited,tasks} }
//   POST /api/quota
//        body { dk, day?, op, kind?, rid?, n?, tasks? }
//        op = sync | consume | unlimited | grant | tasks
//        → 同 GET 的最新状态
//
// 复用编辑器项目已有的 AUTH_STORE 绑定，不新增 KV、不产生额外费用。
// 服务端只做计数，业务规则（基础几次、上限多少）仍在客户端算 —— 目标不是防破解，
// 而是「清缓存 / 换设备不能重置」。

const PREFIX = 'quota:';
const RATE_PREFIX = 'quota_rl:';
const TTL_DAYS = 4; // 当天 key 保留 4 天，够跨时区与补交
const MAX_RID = 12; // 每个 key 记住最近 12 个请求 id，用于重试去重
const RATE_LIMIT = 600; // 每 IP 每天请求上限（正常使用远低于此）
const MAX_GRANT = 2; // bonus 硬上限：分享 +1、首胜 +1，就这两次

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
	'Access-Control-Allow-Headers': 'content-type',
	'Access-Control-Max-Age': '86400',
	'Cache-Control': 'no-store'
};

function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
	});
}

/** 设备指纹：32 位小写 hex，客户端生成，服务端只做格式校验 */
function normalizeDevice(raw) {
	const dk = String(raw || '').trim().toLowerCase();
	return /^[a-f0-9]{32}$/.test(dk) ? dk : '';
}

/** 日期键 YYYY-MM-DD；拒绝未来日期（防止有人改成 2099 年提前攒次数） */
function normalizeDay(raw) {
	const s = String(raw || '').trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		const d = new Date(s + 'T00:00:00Z');
		if (!isNaN(d.getTime())) {
			const now = Date.now();
			// 客户端用自己的本地时区（东八区凌晨时 UTC 还是前一天），
			// 再加上时钟漂移，容差给到 2 天；再多就是有人在改日期攒次数了
			if (d.getTime() > now + 2 * 86400000) return '';
			return s;
		}
		return '';
	}
	// 没带 day 就用服务器日期
	const d = new Date();
	const p = (n) => (n < 10 ? '0' + n : '' + n);
	return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

function emptyState(day) {
	return {
		day,
		game: { used: 0, unlimited: false, bonus: 0 },
		daily: { used: 0, unlimited: false, tasks: 0 },
		rid: [],
		at: Date.now()
	};
}

/** 老版本 / 脏数据兜底，保证返回结构稳定 */
function normalizeState(raw, day) {
	const base = emptyState(day);
	if (!raw || typeof raw !== 'object') return base;
	const g = raw.game || {};
	const d = raw.daily || {};
	return {
		day,
		game: {
			used: Math.max(0, Math.min(999, Number(g.used) || 0)),
			unlimited: g.unlimited === true,
			bonus: Math.max(0, Math.min(MAX_GRANT, Number(g.bonus) || 0))
		},
		daily: {
			used: Math.max(0, Math.min(999, Number(d.used) || 0)),
			unlimited: d.unlimited === true,
			tasks: Math.max(0, Math.min(9, Number(d.tasks) || 0))
		},
		rid: Array.isArray(raw.rid) ? raw.rid.slice(-MAX_RID) : [],
		at: Number(raw.at) || Date.now()
	};
}

function publicState(s) {
	return {
		ok: true,
		day: s.day,
		game: { used: s.game.used, unlimited: s.game.unlimited, bonus: s.game.bonus },
		daily: { used: s.daily.used, unlimited: s.daily.unlimited, tasks: s.daily.tasks },
		at: s.at
	};
}

async function withinRateLimit(env, request) {
	const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
	const key = RATE_PREFIX + ip + ':' + new Date().toISOString().slice(0, 10);
	try {
		const used = Number(await env.AUTH_STORE.get(key)) || 0;
		if (used >= RATE_LIMIT) return false;
		await env.AUTH_STORE.put(key, String(used + 1), { expirationTtl: 86400 });
		return true;
	} catch (e) {
		return true; // 统计失败不阻断主流程
	}
}

async function readState(env, key, day) {
	let raw = null;
	try {
		raw = await env.AUTH_STORE.get(key);
	} catch (e) {
		return emptyState(day);
	}
	if (!raw) return emptyState(day);
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return emptyState(day);
	}
	return normalizeState(parsed, day);
}

async function writeState(env, key, state) {
	state.at = Date.now();
	await env.AUTH_STORE.put(key, JSON.stringify(state), { expirationTtl: TTL_DAYS * 86400 });
}

export async function onRequestOptions() {
	return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
	const { request, env } = context;
	if (!env.AUTH_STORE) return json({ ok: false, error: '次数服务未配置' }, 503);

	const url = new URL(request.url);
	const dk = normalizeDevice(url.searchParams.get('dk'));
	if (!dk) return json({ ok: false, error: '设备标识格式不对' }, 400);
	const rawDay = url.searchParams.get('day');
	const day = normalizeDay(rawDay);
	if (!day) return json({ ok: false, error: '日期不合法' }, 400);

	const state = await readState(env, PREFIX + dk + ':' + day, day);
	return json(publicState(state));
}

export async function onRequestPost(context) {
	const { request, env } = context;
	if (!env.AUTH_STORE) return json({ ok: false, error: '次数服务未配置' }, 503);

	let body;
	try {
		body = await request.json();
	} catch (e) {
		return json({ ok: false, error: '请求格式不对' }, 400);
	}

	const dk = normalizeDevice(body.dk);
	if (!dk) return json({ ok: false, error: '设备标识格式不对' }, 400);
	const day = normalizeDay(body.day);
	if (!day) return json({ ok: false, error: '日期不合法' }, 400);

	const op = String(body.op || 'sync');
	const kind = String(body.kind || 'game');
	if (op !== 'sync' && kind !== 'game' && kind !== 'daily') {
		return json({ ok: false, error: 'kind 只能是 game 或 daily' }, 400);
	}
	if (!(await withinRateLimit(env, request))) {
		return json({ ok: false, error: '今天的请求有点多，明天再来' }, 429);
	}

	const key = PREFIX + dk + ':' + day;
	const state = await readState(env, key, day);

	if (op === 'sync') {
		return json(publicState(state));
	}

	// 幂等：同一个 rid 重复提交（网络重试）只算一次
	const rid = String(body.rid || '').trim().slice(0, 40);
	if (rid && state.rid.indexOf(rid) >= 0) {
		return json(publicState(state));
	}

	if (op === 'consume') {
		const bucket = state[kind];
		if (bucket.used < 999) bucket.used += 1;
	} else if (op === 'unlimited') {
		state[kind].unlimited = true;
	} else if (op === 'grant') {
		// 分享 +1 / 首胜 +1，服务端封顶 MAX_GRANT，改客户端也刷不出无限次
		state.game.bonus = Math.min(MAX_GRANT, state.game.bonus + 1);
	} else if (op === 'tasks') {
		const n = Number(body.tasks);
		if (!isFinite(n) || n < 0) return json({ ok: false, error: 'tasks 不合法' }, 400);
		state.daily.tasks = Math.min(9, Math.floor(n));
	} else {
		return json({ ok: false, error: '未知操作' }, 400);
	}

	if (rid) {
		state.rid.push(rid);
		if (state.rid.length > MAX_RID) state.rid = state.rid.slice(-MAX_RID);
	}
	await writeState(env, key, state);
	return json(publicState(state));
}
