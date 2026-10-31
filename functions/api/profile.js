// 个性化设置短码：把客户端压好的口令串存进 KV，换一个 6 位短码。
// 复用已有的 AUTH_STORE 绑定（编辑器的登录态也在这个 namespace 里，key 加前缀区分），
// 不新增 KV / 数据库，也不产生额外费用。
//
// 接口：
//   POST   /api/profile            { p: "AKP1…" }          → { ok, code, del, days }
//   GET    /api/profile?code=K7M2QX                        → { ok, p, at }
//   DELETE /api/profile?code=K7M2QX&del=XXXXXXXX           → { ok }
//
// 说明：服务端不解析口令内容，只是原样保存，因此设置结构升级不需要改这里。

const PREFIX = 'profile:';
const RATE_PREFIX = 'profile_rl:';
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const MAX_LEN = 4096;
const RATE_LIMIT = 30; // 每 IP 每天最多写入次数
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去掉 0/O/1/I

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
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

function normalizeCode(raw) {
	const code = String(raw || '').trim().toUpperCase();
	return /^[2-9A-HJ-NP-Z]{6}$/.test(code) ? code : '';
}

function randomString(length) {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let out = '';
	for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
	return out;
}

function todayKey() {
	return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function withinRateLimit(env, request) {
	const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
	const key = RATE_PREFIX + ip + ':' + todayKey();
	try {
		const used = Number(await env.AUTH_STORE.get(key)) || 0;
		if (used >= RATE_LIMIT) return false;
		await env.AUTH_STORE.put(key, String(used + 1), { expirationTtl: 86400 });
		return true;
	} catch (e) {
		// KV 统计失败不阻断主流程
		return true;
	}
}

export async function onRequestOptions() {
	return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
	const { request, env } = context;
	if (!env.AUTH_STORE) return json({ ok: false, error: '短码服务未配置' }, 503);

	let body;
	try {
		body = await request.json();
	} catch (e) {
		return json({ ok: false, error: '请求格式不对' }, 400);
	}

	const p = typeof body.p === 'string' ? body.p.trim() : '';
	if (!p) return json({ ok: false, error: '内容为空' }, 400);
	if (p.length > MAX_LEN) return json({ ok: false, error: '设置太大，暂不支持云端保存' }, 413);
	if (p.indexOf('AKP1') !== 0) return json({ ok: false, error: '不是本工具的设置口令' }, 400);

	if (!(await withinRateLimit(env, request))) {
		return json({ ok: false, error: '今天生成的次数有点多，明天再来或直接复制口令' }, 429);
	}

	let days = Number(body.days) || DEFAULT_DAYS;
	days = Math.min(Math.max(days, 1), MAX_DAYS);

	const del = randomString(8);
	for (let attempt = 0; attempt < 6; attempt++) {
		const code = randomString(6);
		const key = PREFIX + code;
		const exists = await env.AUTH_STORE.get(key);
		if (exists) continue;
		const record = JSON.stringify({ p, at: Date.now(), del });
		await env.AUTH_STORE.put(key, record, { expirationTtl: days * 86400 });
		return json({ ok: true, code, del, days });
	}
	return json({ ok: false, error: '短码分配失败，重试一下' }, 500);
}

export async function onRequestGet(context) {
	const { request, env } = context;
	if (!env.AUTH_STORE) return json({ ok: false, error: '短码服务未配置' }, 503);

	const url = new URL(request.url);
	const code = normalizeCode(url.searchParams.get('code'));
	if (!code) return json({ ok: false, error: '短码格式不对' }, 400);

	let raw = null;
	try {
		raw = await env.AUTH_STORE.get(PREFIX + code);
	} catch (e) {
		return json({ ok: false, error: '读取失败' }, 500);
	}
	if (!raw) return json({ ok: false, error: 'not_found' }, 404);

	let record;
	try {
		record = JSON.parse(raw);
	} catch (e) {
		return json({ ok: false, error: 'not_found' }, 404);
	}
	return json({ ok: true, p: record.p, at: record.at });
}

export async function onRequestDelete(context) {
	const { request, env } = context;
	if (!env.AUTH_STORE) return json({ ok: false, error: '短码服务未配置' }, 503);

	const url = new URL(request.url);
	const code = normalizeCode(url.searchParams.get('code'));
	const del = String(url.searchParams.get('del') || '').trim().toUpperCase();
	if (!code || !del) return json({ ok: false, error: '参数不全' }, 400);

	const key = PREFIX + code;
	const raw = await env.AUTH_STORE.get(key);
	if (!raw) return json({ ok: false, error: 'not_found' }, 404);

	let record;
	try {
		record = JSON.parse(raw);
	} catch (e) {
		return json({ ok: false, error: 'not_found' }, 404);
	}
	if (String(record.del || '').toUpperCase() !== del) {
		return json({ ok: false, error: '撤销码不对' }, 403);
	}
	await env.AUTH_STORE.delete(key);
	return json({ ok: true });
}
