// 云存档：把「个性化设置 + 游玩统计」存到云端，换设备凭一个存档码取回。
//
// 和 profile.js 的区别：
//   profile  短码 6 位、30 天过期，用途是「分享给别人看/临时传一下」；
//   archive  存档码 8 位、永不过期、可设 PIN，用途是「自己的长期存档」。
//
// 接口：
//   POST   /api/archive  { code?, pin?, p, stat? }   → { ok, code, hasPin, created }
//   GET    /api/archive?code=XXXX-XXXX&pin=1234      → { ok, p, stat, at }
//   DELETE /api/archive?code=XXXX-XXXX&pin=1234      → { ok }
//
// 存档码可自选（方便记），不填则由服务端生成。PIN 只做「防手滑覆盖」的弱保护，
// 服务端存的是 sha256 前 16 位，拿不到明文。

const PREFIX = 'archive:';
const RATE_PREFIX = 'archive_rl:';
const MAX_LEN = 4096; // 设置口令上限
const MAX_STAT_LEN = 1024; // 统计块上限
const RATE_LIMIT = 60; // 每 IP 每天写入次数
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

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

/** 接受 XXXX-XXXX / XXXXXXXX / 小写，统一成 8 位大写 */
function normalizeCode(raw) {
	const s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
	return /^[2-9A-HJ-NP-Z]{8}$/.test(s) ? s : '';
}

function normalizePin(raw) {
	const s = String(raw || '').trim();
	if (!s) return '';
	return /^\d{4,8}$/.test(s) ? s : '';
}

function randomString(length) {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let out = '';
	for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
	return out;
}

/** PIN 不落明文：sha256 取前 16 位 hex */
async function hashPin(pin) {
	const data = new TextEncoder().encode('akpassport-archive:' + pin);
	const digest = await crypto.subtle.digest('SHA-256', data);
	const bytes = new Uint8Array(digest).slice(0, 8);
	let out = '';
	for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
	return out;
}

function formatCode(code) {
	return code.slice(0, 4) + '-' + code.slice(4);
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
		return true;
	}
}

async function readRecord(env, code) {
	let raw = null;
	try {
		raw = await env.AUTH_STORE.get(PREFIX + code);
	} catch (e) {
		return null;
	}
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch (e) {
		return null;
	}
}

export async function onRequestOptions() {
	return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
	const { request, env } = context;
	if (!env.AUTH_STORE) return json({ ok: false, error: '云存档服务未配置' }, 503);

	let body;
	try {
		body = await request.json();
	} catch (e) {
		return json({ ok: false, error: '请求格式不对' }, 400);
	}

	const p = typeof body.p === 'string' ? body.p.trim() : '';
	if (!p) return json({ ok: false, error: '没有可保存的设置' }, 400);
	if (p.length > MAX_LEN) return json({ ok: false, error: '设置太大，暂不支持云存档' }, 413);
	if (p.indexOf('AKP1') !== 0) return json({ ok: false, error: '不是本工具的设置口令' }, 400);

	let stat = null;
	if (body.stat !== undefined && body.stat !== null) {
		try {
			stat = JSON.stringify(body.stat);
		} catch (e) {
			return json({ ok: false, error: '统计数据格式不对' }, 400);
		}
		if (stat.length > MAX_STAT_LEN) return json({ ok: false, error: '统计数据太大' }, 413);
	}

	const pinRaw = body.pin === undefined || body.pin === null ? '' : String(body.pin).trim();
	if (pinRaw && !normalizePin(pinRaw)) {
		return json({ ok: false, error: 'PIN 需要 4~8 位数字' }, 400);
	}

	if (!(await withinRateLimit(env, request))) {
		return json({ ok: false, error: '今天保存的次数有点多，明天再来' }, 429);
	}

	let code = normalizeCode(body.code);
	const created = !code;

	if (!code) {
		// 服务端生成，避开已占用的
		for (let attempt = 0; attempt < 8; attempt++) {
			const candidate = randomString(8);
			if (!(await readRecord(env, candidate))) {
				code = candidate;
				break;
			}
		}
		if (!code) return json({ ok: false, error: '存档码分配失败，重试一下' }, 500);
	}

	const existing = await readRecord(env, code);
	if (existing && existing.pinHash) {
		// 已设 PIN 的存档，必须带对 PIN 才能覆盖
		if (!pinRaw) return json({ ok: false, error: '这个存档码设了 PIN，需要先输入' }, 401);
		if ((await hashPin(pinRaw)) !== existing.pinHash) {
			return json({ ok: false, error: 'PIN 不对' }, 403);
		}
	}

	const record = {
		p,
		stat: stat,
		pinHash: pinRaw ? await hashPin(pinRaw) : (existing && existing.pinHash) || '',
		at: Date.now(),
		ver: 1
	};
	try {
		// 存档不设 TTL：用户换机/换系统后还要能取回
		await env.AUTH_STORE.put(PREFIX + code, JSON.stringify(record));
	} catch (e) {
		return json({ ok: false, error: '写入失败，稍后再试' }, 500);
	}

	return json({ ok: true, code: formatCode(code), hasPin: !!record.pinHash, created });
}

export async function onRequestGet(context) {
	const { request, env } = context;
	if (!env.AUTH_STORE) return json({ ok: false, error: '云存档服务未配置' }, 503);

	const url = new URL(request.url);
	const code = normalizeCode(url.searchParams.get('code'));
	if (!code) return json({ ok: false, error: '存档码格式不对（8 位字母数字）' }, 400);

	const record = await readRecord(env, code);
	if (!record) return json({ ok: false, error: 'not_found' }, 404);

	if (record.pinHash) {
		const pin = normalizePin(url.searchParams.get('pin'));
		if (!pin) return json({ ok: false, error: '需要 PIN' }, 401);
		if ((await hashPin(pin)) !== record.pinHash) {
			return json({ ok: false, error: 'PIN 不对' }, 403);
		}
	}

	let stat = null;
	if (record.stat) {
		try {
			stat = JSON.parse(record.stat);
		} catch (e) {
			stat = null;
		}
	}
	return json({ ok: true, p: record.p, stat, at: record.at, code: formatCode(code) });
}

export async function onRequestDelete(context) {
	const { request, env } = context;
	if (!env.AUTH_STORE) return json({ ok: false, error: '云存档服务未配置' }, 503);

	const url = new URL(request.url);
	const code = normalizeCode(url.searchParams.get('code'));
	if (!code) return json({ ok: false, error: '存档码格式不对' }, 400);

	const record = await readRecord(env, code);
	if (!record) return json({ ok: false, error: 'not_found' }, 404);

	if (record.pinHash) {
		const pin = normalizePin(url.searchParams.get('pin'));
		if (!pin || (await hashPin(pin)) !== record.pinHash) {
			return json({ ok: false, error: 'PIN 不对' }, 403);
		}
	}
	await env.AUTH_STORE.delete(PREFIX + code);
	return json({ ok: true });
}
