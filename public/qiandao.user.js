// ==UserScript==
// @name         千岛行情采集 → 通行证工具编辑器
// @namespace    https://github.com/awadwd/ArknightsAuthorizationSeriesdata_editor
// @version      1.2.0
// @description  在千岛（qiandao.com）页面里自动收集明日方舟通行证的市价，一键复制或直接上传到编辑器，省掉 F12 粘贴
// @author       awadwd
// @match        https://qiandao.com/*
// @match        https://www.qiandao.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/* 工作原理
 * ---------------------------------------------------------------------------
 * 页面里真正的抓取逻辑在编辑器站点的 /qiandao-collector.js 里（和控制台版是同一份文件）。
 * 本脚本只做三件事：把它注入页面 → 画一个浮动面板 → 复制 / 上传。
 *
 * 为什么必须注入到页面上下文：千岛的列表请求是页面自己发的，只有在页面上下文 hook
 * 住 fetch / XMLHttpRequest 才能抄到响应体。Tampermonkey 用 @grant none 时本脚本
 * 本来就在页面上下文，但为了避免把 400 行抽取逻辑抄两遍（一改就得改两处），
 * 这里选择从编辑器站点拉那一份过来注入。
 *
 * 上传走 X-Collect-Token（在编辑器「市价 → 千岛接入 → 采集令牌」里生成），
 * 该令牌只能写这一份会话缓存，不能改仓库、不能提 PR。
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var DEFAULT_BASE = 'https://arknightsauthorizationseriesdataeditor.pages.dev';
  var LS_BASE = 'qd_collect_editor_base';
  var LS_TOKEN = 'qd_collect_token';
  var LS_AUTO = 'qd_collect_auto';
  var LS_BOX = 'qd_selected_box';

  function ls(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) {}
  }

  var state = {
    base: (ls(LS_BASE, '') || DEFAULT_BASE).replace(/\/+$/, ''),
    token: ls(LS_TOKEN, ''),
    auto: ls(LS_AUTO, '1') === '1',
    open: false,
    busy: false,
    lastUpload: null,
    scroller: null,
    pickedInput: null,   // 用户手动点过的输入框，自动搜索优先用它
  };

  /* ---------------- 注入采集脚本 ---------------- */
  var injectPromise = null;
  function injectCollector() {
    if (window.__QD_COLLECTOR_READY__ && window.__QD) return Promise.resolve(window.__QD);
    if (injectPromise) return injectPromise;
    injectPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = state.base + '/qiandao-collector.js?t=' + Date.now();
      s.async = false;
      s.onload = function () {
        if (window.__QD) { flushEarly(); resolve(window.__QD); }
        else reject(new Error('脚本已加载但没有挂上 __QD'));
      };
      s.onerror = function () {
        injectPromise = null;
        reject(new Error('拉不到采集脚本：' + s.src + '\n检查「编辑器地址」是否填对、页面是否能访问它'));
      };
      // document-start 时 <head> 可能还不存在，别再因为 appendChild 抛错把 promise 打死
      function place() {
        var parent = document.head || document.documentElement;
        if (parent) parent.appendChild(s);
        else document.addEventListener('DOMContentLoaded', function () {
          (document.head || document.documentElement).appendChild(s);
        });
      }
      try { place(); } catch (e) { injectPromise = null; reject(e); }
    });
    return injectPromise;
  }

  /* ---------------- 早期请求兜底 ----------------
   * 采集脚本是跨域拉过来的，几十到几百毫秒；页面自己的首屏请求（岛页的 feed）往往比它更早。
   * 所以这里先挂一个极薄的记录器，等 __QD 就绪再回放给它 —— 不重复实现抽取逻辑。
   */
  var EARLY = [];
  var EARLY_MAX = 60;
  function pushEarly(rec) {
    if (window.__QD_PAUSE__) return;
    if (window.__QD) return;   // 采集脚本已经在了，它自己在记，别重复
    if (EARLY.length >= EARLY_MAX) EARLY.shift();
    EARLY.push(rec);
  }
  function flushEarly() {
    var qd = window.__QD;
    if (!qd || !qd.__ingest || !EARLY.length) return;
    var list = EARLY.slice();
    EARLY.length = 0;
    try { qd.__ingest(list); } catch (e) {}
  }
  function installEarlyHook() {
    if (window.__QD_EARLY_HOOK__) return;
    window.__QD_EARLY_HOOK__ = true;
    var of = window.fetch;
    if (typeof of === 'function') {
      window.fetch = function (input, init) {
        var url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch (e) {}
        var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        var body = init && typeof init.body === 'string' ? init.body : '';
        var p = of.apply(this, arguments);
        if (!/qiandao|gactus|myminapp|\/api\//i.test(url)) return p;
        try {
          p.then(function (res) {
            try {
              if (!res || res.type === 'opaque' || res.type === 'opaqueredirect') return;
              var ct = res.headers.get('content-type') || '';
              if (!/json|text/i.test(ct)) return;
              res.clone().text().then(function (t) {
                pushEarly({ method: method, url: url, body: body, status: res.status, resp: String(t).slice(0, 600000) });
              }).catch(function () {});
            } catch (e) {}
          }).catch(function () {});
        } catch (e) {}
        return p;
      };
    }
    var XO = window.XMLHttpRequest;
    if (XO && XO.prototype) {
      var open = XO.prototype.open;
      var send = XO.prototype.send;
      XO.prototype.open = function (m, u) {
        this.__qd = { method: String(m || 'GET').toUpperCase(), url: String(u || ''), body: '' };
        return open.apply(this, arguments);
      };
      XO.prototype.send = function (b) {
        var self = this;
        var rec = this.__qd;
        if (rec && typeof b === 'string') rec.body = b;
        if (rec && /qiandao|gactus|myminapp|\/api\//i.test(rec.url)) {
          this.addEventListener('load', function () {
            try {
              var ct = self.getResponseHeader('content-type') || '';
              if (!/json|text/i.test(ct)) return;
              var t = self.responseType === '' || self.responseType === 'text' ? self.responseText : '';
              pushEarly({ method: rec.method, url: rec.url, body: rec.body, status: self.status, resp: String(t || '').slice(0, 600000) });
            } catch (e) {}
          });
        }
        return send.apply(this, arguments);
      };
    }
  }
  try { installEarlyHook(); } catch (e) {}

  /* ---------------- 面板 ---------------- */
  var el = {};
  var CSS = [
    '#qd-panel{position:fixed;right:16px;bottom:16px;z-index:2147483000;font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a;}',
    '#qd-panel *{box-sizing:border-box;}',
    '#qd-card{width:268px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.16);overflow:hidden;}',
    '#qd-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f8fafc;cursor:pointer;user-select:none;border-bottom:1px solid #eef2f7;}',
    '#qd-head b{font-size:13px;font-weight:600;}',
    '#qd-dot{width:8px;height:8px;border-radius:50%;background:#cbd5e1;flex:0 0 auto;}',
    '#qd-dot.on{background:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.16);}',
    '#qd-count{margin-left:auto;font-size:12px;color:#64748b;}',
    '#qd-body{padding:10px 12px;display:none;}',
    '#qd-panel.open #qd-body{display:block;}',
    '.qd-row{display:flex;gap:6px;margin-bottom:8px;}',
    '.qd-btn{flex:1;border:1px solid #dbe2ea;background:#fff;color:#0f172a;border-radius:8px;padding:6px 8px;font-size:12px;cursor:pointer;white-space:nowrap;}',
    '.qd-btn:hover{background:#f1f5f9;}',
    '.qd-btn:disabled{opacity:.45;cursor:not-allowed;}',
    '.qd-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff;}',
    '.qd-btn.primary:hover{background:#1d4ed8;}',
    '.qd-field{margin-bottom:8px;}',
    '.qd-field label{display:block;font-size:11px;color:#64748b;margin-bottom:2px;}',
    '.qd-field input{width:100%;border:1px solid #dbe2ea;border-radius:8px;padding:5px 7px;font-size:12px;color:#0f172a;background:#fff;}',
    '.qd-field select{width:100%;border:1px solid #dbe2ea;border-radius:8px;padding:5px 7px;font-size:12px;color:#0f172a;background:#fff;}',
    '.qd-field input:focus,.qd-field select:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12);}',
    '#qd-msg{font-size:11px;line-height:1.5;color:#64748b;white-space:pre-wrap;word-break:break-all;max-height:168px;overflow:auto;}',
    '#qd-msg.ok{color:#047857;}',
    '#qd-msg.err{color:#b91c1c;}',
    '#qd-msg.warn{color:#b45309;}',
    '.qd-sep{height:1px;background:#eef2f7;margin:8px 0;}',
    '.qd-mini{font-size:11px;color:#94a3b8;line-height:1.45;}',
    '.qd-check{display:flex;align-items:center;gap:6px;font-size:12px;color:#334155;margin-bottom:6px;cursor:pointer;white-space:nowrap;}',
    '.qd-check input{width:auto;flex:0 0 auto;margin:0;}',
    '#qd-tip{position:fixed;right:16px;bottom:96px;z-index:2147483000;max-width:280px;background:#0f172a;color:#fff;font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:8px 10px;border-radius:8px;opacity:0;transition:opacity .2s;pointer-events:none;}',
    '#qd-tip.show{opacity:1;}',
  ].join('');

  function mount() {
    if (document.getElementById('qd-panel')) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'qd-panel';
    wrap.innerHTML = [
      '<div id="qd-card">',
      '  <div id="qd-head"><span id="qd-dot"></span><b>千岛采集</b><span id="qd-count">等待请求…</span></div>',
      '  <div id="qd-body">',
      '    <div class="qd-row">',
      '      <button class="qd-btn" data-act="roll">自动翻页</button>',
      '      <button class="qd-btn primary" data-act="upload">上传</button>',
      '    </div>',
      '    <div class="qd-sep"></div>',
      '    <div class="qd-field">',
      '      <label>自动搜索（脚本自己填搜索框、自己点）</label>',
      '      <select id="qd-box"><option value="">全部干员（按 Box_Id.json）</option></select>',
      '    </div>',
      '    <div class="qd-row">',
      '      <button class="qd-btn primary" data-act="autosearch">开始自动搜索</button>',
      '      <button class="qd-btn" data-act="stopsearch">停止</button>',
      '    </div>',
      '    <div id="qd-msg">滚动或切一下分类，页面的列表请求会被自动抄下来。</div>',
      '    <div class="qd-row" style="margin-top:8px;">',
      '      <button class="qd-btn" data-act="copy">复制 JSON</button>',
      '      <button class="qd-btn" data-act="probe">检查通道</button>',
      '      <button class="qd-btn" data-act="clear">清空</button>',
      '    </div>',
      '    <div class="qd-sep"></div>',
      '    <div class="qd-field"><label>编辑器地址</label><input id="qd-base" placeholder="https://…pages.dev" /></div>',
      '    <div class="qd-field"><label>采集令牌（可留空，只复制不上传）</label><input id="qd-token" placeholder="留空=只复制" /></div>',
      '    <label class="qd-check"><input type="checkbox" id="qd-auto" /> 翻完自动上传</label>',
      '    <div class="qd-mini">令牌在编辑器「市价 → 千岛接入 → 采集令牌」里生成。</div>',
      '  </div>',
      '</div>',
    ].join('');
    (document.body || document.documentElement).appendChild(wrap);

    el.panel = wrap;
    el.dot = wrap.querySelector('#qd-dot');
    el.count = wrap.querySelector('#qd-count');
    el.msg = wrap.querySelector('#qd-msg');
    el.base = wrap.querySelector('#qd-base');
    el.token = wrap.querySelector('#qd-token');
    el.auto = wrap.querySelector('#qd-auto');
    el.box = wrap.querySelector('#qd-box');

    el.base.value = state.base === DEFAULT_BASE ? '' : state.base;
    el.base.placeholder = DEFAULT_BASE;
    el.token.value = state.token;
    el.auto.checked = state.auto;

    wrap.querySelector('#qd-head').addEventListener('click', function () {
      state.open = !state.open;
      wrap.classList.toggle('open', state.open);
      if (state.open) { refreshCount(); loadRoster(); }
    });

    wrap.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'copy') doCopy();
      else if (act === 'upload') doUpload();
      else if (act === 'clear') doClear();
      else if (act === 'roll') doRoll();
      else if (act === 'autosearch') doAutoSearch();
      else if (act === 'stopsearch') doStopSearch();
      else if (act === 'probe') doProbe();
    });

    el.base.addEventListener('change', function () {
      var v = el.base.value.trim().replace(/\/+$/, '');
      // 只认 http(s):// 地址。别的值（比如被搜索关键词写进来的）一律回滚，
      // 别让一次误写把这台浏览器里的地址永久改坏
      if (v && !/^https?:\/\/[^\s]+$/i.test(v)) {
        el.base.value = state.base === DEFAULT_BASE ? '' : state.base;
        return say('「编辑器地址」要填 http(s):// 开头的地址，已还原成 ' + state.base, 'warn');
      }
      state.base = v || DEFAULT_BASE;
      lsSet(LS_BASE, v);
      injectPromise = null;   // 换站点要重新拉脚本
      injectCollector().then(function () { say('已切换到 ' + state.base, 'ok'); }).catch(function (e) { say(e.message, 'err'); });
    });
    el.token.addEventListener('change', function () {
      var t = el.token.value.trim();
      if (t && !/^[\w.\-]{8,}$/.test(t)) {
        el.token.value = state.token;
        return say('采集令牌格式不对（应为 qd_ 开头的一串字母数字），已还原', 'warn');
      }
      state.token = t;
      lsSet(LS_TOKEN, state.token);
      say(state.token ? '令牌已保存（只存在本机浏览器）' : '已清空令牌，只能复制不能上传', 'ok');
    });
    el.auto.addEventListener('change', function () {
      state.auto = el.auto.checked;
      lsSet(LS_AUTO, state.auto ? '1' : '0');
    });
    if (el.box) {
      el.box.addEventListener('change', function () { lsSet(LS_BOX, el.box.value); });
    }

    // 记下用户手动点过的输入框（面板外的），自动搜索时优先用它 ——
    // 真实站点的搜索框常常没 class/placeholder，猜不准就靠这一下
    document.addEventListener('focusin', function (ev) {
      var t = ev.target;
      if (!t || inPanel(t) || !isEditableEl(t)) return;
      state.pickedInput = t;
    }, true);

    setInterval(refreshCount, 1500);

    if (looksLocal(state.base)) {
      state.open = true;
      wrap.classList.add('open');
      say('「编辑器地址」指向本机服务（' + state.base + '），这台地址上没有 /api/prices，上传一定失败。\n'
        + '改成 ' + DEFAULT_BASE + ' 或你自己线上部署的地址。', 'warn');
    }
  }

  function say(text, kind) {
    if (!el.msg) return;
    el.msg.textContent = text;
    el.msg.className = kind || '';
  }

  function refreshCount() {
    if (!el.count) return;
    var ready = !!window.__QD;
    el.dot.classList.toggle('on', ready);
    if (!ready) { el.count.textContent = '脚本未就绪'; return; }
    var apis = 0, records = 0;
    try {
      apis = (window.__QD.captured() || []).length;
      records = window.__QD.samples({ pass: false, elite: false }).length;
    } catch (e) {}
    el.count.textContent = apis ? apis + ' 接口 / ' + records + ' 条' : '等待请求…';
  }

  function currentBundle() {
    return window.__QD.bundle({});
  }

  function doCopy() {
    if (!window.__QD) return say('采集脚本还没就绪', 'warn');
    var text = JSON.stringify(currentBundle());
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      say('已复制（' + text.length + ' 字符）', 'ok');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        say('已复制（' + text.length + ' 字符），去编辑器粘贴', 'ok');
      }).catch(fallback);
    } else fallback();
  }

  function doClear() {
    if (!window.__QD) return;
    window.__QD.clear();
    say('已清空，重新滚动页面即可', 'ok');
    refreshCount();
  }

  /* ---------------- 上传通道诊断 ----------------
   * 「上传失败：Unexpected token '<'」只有一个含义：这个地址回的是一张网页，不是接口。
   * 最常见的是「编辑器地址」填成了本机 dev 服务（vite / node 没有 Pages Functions），
   * 直接把它翻成人话，别让人对着 JSON.parse 的报错猜。
   */
  function readBody(r) {
    return r.text().then(function (t) {
      var body = null;
      try { body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
      return { status: r.status, ct: r.headers.get('content-type') || '', text: t || '', body: body };
    });
  }

  function looksLocal(url) {
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?(\/|$)/i.test(url);
  }

  function snippet(t) {
    return String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function explain(res, url) {
    var lines = ['目标 ' + url, 'HTTP ' + res.status + (res.ct ? ' · ' + res.ct.split(';')[0] : '')];
    if (looksLocal(state.base)) {
      lines.push('「编辑器地址」现在是本机服务（' + state.base + '），它没有 /api/prices 这个函数。');
      lines.push('改成线上站点即可：' + DEFAULT_BASE);
    } else if (/text\/html/i.test(res.ct) || /^\s*</.test(res.text)) {
      lines.push('这个地址对 /api/prices 回的是网页而不是接口 —— 该站点没部署 Pages Functions，或路径被前端路由接管了。');
      lines.push('内容开头：' + snippet(res.text));
    } else if (!res.text) {
      lines.push('返回空内容（状态码异常但没正文）。');
    } else {
      lines.push('返回的不是 JSON：' + snippet(res.text));
    }
    return lines.join('\n');
  }

  // 上传失败时把数据塞进剪贴板，让人还能走「粘贴」这条老路
  function stashBundle() {
    try { return !!window.__QD.copy({}); } catch (e) { return false; }
  }

  function doProbe() {
    var url = state.base + '/api/prices';
    say('检查 ' + url + ' …');
    fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(readBody)
      .then(function (res) {
        if (res.body) {
          say('通道正常 · GET ' + url + ' → HTTP ' + res.status + '，返回 JSON。'
            + (state.token ? '\n令牌已填，可以直接上传。' : '\n还没填采集令牌，上传会被拒（401）。'), 'ok');
        } else {
          say('通道不通：\n' + explain(res, url), 'err');
        }
      })
      .catch(function (e) {
        say('连不上 ' + url + '：' + e.message + '\n'
          + '· 地址写错了？\n'
          + '· 该站点没给 Access-Control-Allow-Origin，浏览器把跨域请求挡了？\n'
          + '（本机 dev 服务就是这种情况，换成线上站点）', 'err');
      });
  }

  function doUpload() {
    if (!window.__QD) return say('采集脚本还没就绪', 'warn');
    if (!state.token) {
      state.open = true;
      el.panel.classList.add('open');
      return say('先在下面填「采集令牌」才能直接上传；不填就点「复制 JSON」粘过去', 'warn');
    }
    var bundle = currentBundle();
    if (!bundle.samples.length && !bundle.apis.length) {
      return say('还没抓到东西 —— 先在页面上滚几屏让列表发请求', 'warn');
    }
    var url = state.base + '/api/prices?action=save-session';
    state.busy = true;
    say('上传中…（' + bundle.samples.length + ' 条）');
    // 上传请求本身也会被采集脚本 hook 到，先暂停记录，免得污染「有没有新数据」的判断
    window.__QD_PAUSE__ = true;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Collect-Token': state.token },
      body: JSON.stringify({ bundle: bundle }),
    }).then(readBody).then(function (res) {
      state.busy = false;
      window.__QD_PAUSE__ = false;
      if (!res.body) {
        var stashed = stashBundle();
        return say('上传失败 · 接口返回的不是 JSON\n' + explain(res, url)
          + (stashed ? '\n\n已经把这批 JSON 复制到剪贴板：去编辑器「市价 → 千岛接入 → 控制台脚本」粘进去点「保存并解析」。' : ''), 'err');
      }
      var b = res.body;
      if (!b.success) {
        var hint = res.status === 401 || res.status === 403
          ? '令牌不对或已被重置 —— 回编辑器重新生成一个'
          : (b.error || 'HTTP ' + res.status);
        return say('上传失败：' + hint, 'err');
      }
      var d = b.detected || {};
      state.lastUpload = new Date();
      say('上传成功 · 记录 ' + (d.samples || 0) + ' 条 · 接口 ' + (d.apis || 0) + ' 个'
        + (b.seeded ? '\n并入任务 ' + b.seeded + ' 条（任务共 ' + b.crawlRecords + ' 条）' : '')
        + (b.note ? '\n' + b.note : ''), 'ok');
    }).catch(function (e) {
      state.busy = false;
      window.__QD_PAUSE__ = false;
      var stashed = stashBundle();
      say('上传失败 · 请求没发出去：' + e.message + '\n' + url + '\n'
        + '大概率是跨域被拒（该站点没用 Access-Control-Allow-Origin 放行）或地址不可达。'
        + (stashed ? '\n已把这批 JSON 复制到剪贴板，可以走「控制台脚本」粘贴那条路。' : ''), 'err');
    });
  }

  // 自动翻页：反复滚到底，直到连续 N 秒没有新数据
  function doRoll() {
    if (state.scroller) return say('已经在翻了，再点一下停止', 'warn');
    if (!window.__QD) return say('采集脚本还没就绪', 'warn');

    var lastCount = 0;
    var idleTicks = 0;
    var tick = 0;
    var started = Date.now();
    say('开始自动翻页…（最多 40 次滚动，1 分钟）');

    state.scroller = setInterval(function () {
      tick++;
      var n = 0;
      try { n = window.__QD.samples({ pass: false, elite: false }).length; } catch (e) {}
      if (n > lastCount) { lastCount = n; idleTicks = 0; } else { idleTicks++; }
      say('自动翻页中 · 第 ' + tick + ' 次 · 已抓 ' + n + ' 条');

      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      // 有些列表是内部滚动容器，一并推一下
      var scrollers = document.querySelectorAll('[class*="scroll"],[class*="list"]');
      for (var i = 0; i < scrollers.length && i < 6; i++) {
        var c = scrollers[i];
        if (c.scrollHeight > c.clientHeight + 40) c.scrollTop = c.scrollHeight;
      }

      var stop = idleTicks >= 5 || tick >= 40 || Date.now() - started > 60000;
      if (stop) {
        clearInterval(state.scroller);
        state.scroller = null;
        refreshCount();
        if (!lastCount) say('翻完了但还是没抓到 —— 试试手动切一下分类，或搜「通行证」', 'warn');
        else if (state.auto) { say('翻页结束，抓到 ' + lastCount + ' 条，开始上传…'); doUpload(); }
        else say('翻页结束，抓到 ' + lastCount + ' 条。点「上传」或「复制 JSON」', 'ok');
      }
    }, 1500);
  }

  /* ---------------- 干员名单 + 自动搜索 ---------------- */
  // Box_Id.json 走 jsdelivr 镜像（带 CORS，公开可读），拿到 92 个盒号 × 每盒 10 个干员
  var ROSTER_URL = 'https://cdn.jsdelivr.net/gh/awadwd/ArknightsAuthorization_Series-mirror@main/Box_Id.json';
  var LS_ROSTER = 'qd_roster_v1';
  var rosterCache = null;   // [{ boxId, names: [] }]

  function loadRoster() {
    if (rosterCache) return Promise.resolve(rosterCache);
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(LS_ROSTER) || 'null'); } catch (e) {}
    if (cached && cached.at && Date.now() - cached.at < 86400000 && cached.boxes) {
      rosterCache = cached.boxes;
      fillBoxOptions();
      return Promise.resolve(rosterCache);
    }
    return fetch(ROSTER_URL, { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (arr) {
      if (!Array.isArray(arr)) throw new Error('Box_Id.json 格式不对');
      rosterCache = arr.map(function (b) {
        var names = [];
        for (var i = 1; i <= 10; i++) {
          var c = b['character' + i];
          if (c && c.name && names.indexOf(c.name) < 0) names.push(String(c.name));
        }
        return { boxId: String(b.Box_id || ''), names: names };
      }).filter(function (b) { return b.names.length; });
      try { localStorage.setItem(LS_ROSTER, JSON.stringify({ at: Date.now(), boxes: rosterCache })); } catch (e) {}
      fillBoxOptions();
      return rosterCache;
    }).catch(function (e) {
      say('拉干员名单失败（' + e.message + '），这轮只搜「通行证」兜底', 'warn');
      rosterCache = [];
      return rosterCache;
    });
  }

  function fillBoxOptions() {
    if (!el.box || !rosterCache) return;
    var keep = el.box.value || ls(LS_BOX, '');
    var total = rosterCache.reduce(function (n, b) { return n + b.names.length; }, 0);
    var html = ['<option value="">全部干员（' + total + ' 人，很慢）</option>'];
    rosterCache.forEach(function (b, i) {
      if (!b.boxId) return;
      html.push('<option value="' + i + '">盒号 ' + b.boxId + '（' + b.names.length + ' 人）</option>');
    });
    el.box.innerHTML = html.join('');
    // 默认挑一个盒号而不是「全部」：一整盒 10 人几分钟能跑完，也不容易撞限流
    var has = keep !== '' && el.box.querySelector('option[value="' + keep + '"]');
    el.box.value = has ? keep : (rosterCache[0] && rosterCache[0].boxId ? '0' : '');
  }

  // 找页面上的搜索框：先按语义猜，再退回「用户刚点过的输入框」，最后才盲猜
  function visible(node) {
    if (!node || !node.getBoundingClientRect) return false;
    var r = node.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var st = window.getComputedStyle(node);
    return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  }

  // 面板自己也塞在页面里，文档顺序还在后面 —— 不排除掉就会被当成「站内搜索框」，
  // 一搜干员就把「编辑器地址」「采集令牌」写成了关键词。这个坑踩过一次。
  function inPanel(node) {
    try { return !!(node && node.closest && node.closest('#qd-panel')); } catch (e) { return false; }
  }

  function isEditableEl(node) {
    if (!node) return false;
    var tag = (node.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      var t = (node.getAttribute('type') || 'text').toLowerCase();
      return t === 'text' || t === 'search' || t === '';
    }
    return node.getAttribute && node.getAttribute('contenteditable') === 'true';
  }

  // 千岛有 web component，搜索框可能在 shadow root 里
  function collectEditable(root, out) {
    out = out || [];
    try {
      var nodes = root.querySelectorAll('input, textarea, [contenteditable="true"]');
      for (var i = 0; i < nodes.length; i++) out.push(nodes[i]);
      var all = root.querySelectorAll('*');
      for (var j = 0; j < all.length; j++) {
        if (all[j].shadowRoot) collectEditable(all[j].shadowRoot, out);
      }
    } catch (e) {}
    return out;
  }

  function describeInput(inp) {
    return [
      inp.placeholder, inp.className, inp.id,
      inp.getAttribute('aria-label'), inp.getAttribute('name'), inp.getAttribute('role'),
      inp.parentElement && inp.parentElement.className,
      inp.parentElement && inp.parentElement.parentElement && inp.parentElement.parentElement.className,
    ].join(' ');
  }

  function findSearchInput() {
    var nodes = collectEditable(document);
    var textish = [];
    var semantic = null;
    for (var i = 0; i < nodes.length; i++) {
      var inp = nodes[i];
      if (inPanel(inp)) continue;                    // 绝不碰自己的面板
      if (inp.disabled || inp.readOnly) continue;
      if (!visible(inp)) continue;
      if ((inp.getAttribute('type') || '').toLowerCase() === 'password') continue;
      var hay = describeInput(inp).toLowerCase();
      if (/搜|查找|search|keyword|query/.test(hay)) { semantic = semantic || inp; continue; }
      if (isEditableEl(inp)) textish.push(inp);
    }
    if (semantic) return semantic;
    // 用户手动点过的那个框最可信（真实站点的搜索框常常藏得没 class）
    if (state.pickedInput && textish.indexOf(state.pickedInput) >= 0) return state.pickedInput;
    // 只有一个候选才敢盲猜；有多个就报错让人点一下，别乱写
    return textish.length === 1 ? textish[0] : null;
  }

  // 直接改 value 不会触发 Vue/React 的绑定，得走原生 setter + 事件
  function setNativeValue(inp, val) {
    var tag = (inp.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') {
      inp.textContent = val;                       // contenteditable
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    var proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(inp, val);
    else inp.value = val;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function submitSearch(inp) {
    ['keydown', 'keypress', 'keyup'].forEach(function (type) {
      inp.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
    });
    // 有些实现只监听表单 submit
    var form = inp.closest('form');
    if (form) {
      try { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } catch (e) {}
    }
    inp.blur();
  }

  // 等「真抓到新样本」；顺带识别 405 —— 千岛限流是 405「您的手速也太快了」
  // 以前判断的是「接口数变多」，页面随便发个别的请求也算成功，结果把没搜到的也记成成功。
  function waitForCapture(before, timeoutMs) {
    return new Promise(function (resolve) {
      var started = Date.now();
      var timer = setInterval(function () {
        var cap = [];
        try { cap = window.__QD.captured(); } catch (e) {}
        var throttled = cap.some(function (c) { return c.status === 405 || c.status === 429; });
        if (throttled) { clearInterval(timer); return resolve({ status: 'throttled' }); }
        var now = before;
        try { now = window.__QD.count(); } catch (e) {}
        if (now > before) {
          clearInterval(timer);
          // 再等一点，让响应体落进来
          setTimeout(function () { resolve({ status: 'ok' }); }, 700);
          return;
        }
        if (Date.now() - started > timeoutMs) { clearInterval(timer); resolve({ status: 'timeout' }); }
      }, 250);
    });
  }

  /* ---------------- 打开千岛的搜索框 ----------------
   * 千岛的搜索是右上角一个「🔍 搜索」按钮，**默认收起**，点了才展开输入框。
   * 所以自动搜索得先找到那个按钮并点开，否则就会去乱写别的输入框。
   */
  function fireClick(node) {
    try {
      ['pointerdown', 'mousedown', 'mouseup'].forEach(function (t) {
        node.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      });
    } catch (e) {}
    try { node.click(); } catch (e) {
      try { node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch (e2) {}
    }
  }

  function isTriggerish(txt, meta) {
    // 触发器里常带图标（🔍 搜索），先把非文字字符去掉再比
    var t = String(txt || '').replace(/[^\u4e00-\u9fa5a-zA-Z]/g, '');
    if (/^(搜索|搜索商品|搜一搜|search)$/i.test(t)) return true;
    if (t.length <= 4 && /^搜索/.test(t)) return true;
    return /search|搜索/i.test(meta);
  }

  function findSearchTrigger() {
    var nodes = document.querySelectorAll('button, a, div, span, i, svg, img, [role="button"], [class*="search"], [class*="Search"], [id*="search"], [id*="Search"]');
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (inPanel(n) || !visible(n)) continue;
      var r = n.getBoundingClientRect();
      if (r.width < 10 || r.height < 10 || r.width > 360 || r.height > 140) continue;
      var txt = String(n.innerText || n.textContent || '').trim();
      var cls = n.className && n.className.baseVal !== undefined ? n.className.baseVal : (n.className || '');
      var meta = ((n.getAttribute('aria-label') || '') + ' ' + cls + ' ' + (n.id || '')).toLowerCase();
      if (!isTriggerish(txt, meta)) continue;
      var score = 0;
      if (/^(搜索|search)$/i.test(txt)) score += 3;
      if (/search/i.test(meta)) score += 2;
      if (r.top < 260) score += 2;                       // 顶部导航
      if (r.left > window.innerWidth * 0.45) score += 2;  // 右上角
      if (n.closest('header,nav,[class*="header"],[class*="nav"]')) score += 1;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  // 打开并返回可用的输入框；打不开就返回 null（绝不拿面板自己的框凑数）
  function openSearch(timeoutMs) {
    var cur = findSearchInput();
    if (cur && visible(cur)) return Promise.resolve(cur);
    var trig = findSearchTrigger();
    if (!trig) return Promise.resolve(cur || null);
    fireClick(trig);
    return new Promise(function (resolve) {
      var waited = 0;
      var limit = timeoutMs || 2500;
      var timer = setInterval(function () {
        waited += 200;
        var inp = findSearchInput();
        if (inp && visible(inp)) { clearInterval(timer); return resolve(inp); }
        if (waited >= limit) { clearInterval(timer); resolve(inp || null); }
      }, 200);
    });
  }

  function doStopSearch() {
    if (state.queue) {
      clearTimeout(state.queue.timer);
      state.queue = null;
      dropQueue();
      say('已停止自动搜索', 'warn');
    }
    if (state.scroller) { clearInterval(state.scroller); state.scroller = null; }
  }

  function doAutoSearch() {
    if (!window.__QD) return say('采集脚本还没就绪', 'warn');
    if (state.queue) return say('已经在搜了，点「停止」可以中断', 'warn');

    // 名单可能还没拉完：等它回来再开工，别让用户再点一次
    if (!rosterCache) {
      say('正在拉干员名单…');
      loadRoster().then(function () { startSearch(); });
      return;
    }
    startSearch();
  }

  function startSearch() {
    if (!window.__QD) return say('采集脚本还没就绪', 'warn');
    if (state.queue) return say('已经在搜了，点「停止」可以中断', 'warn');

    var idx = el.box && el.box.value !== '' ? Number(el.box.value) : -1;
    var names, label;
    if (idx >= 0 && rosterCache[idx]) {
      names = rosterCache[idx].names.slice();
      label = '盒号 ' + rosterCache[idx].boxId + '（' + names.length + ' 人）';
    } else {
      var all = [];
      rosterCache.forEach(function (b) { b.names.forEach(function (n) { if (all.indexOf(n) < 0) all.push(n); }); });
      names = all;
      label = '全部 ' + all.length + ' 人';
    }
    if (!names.length) {
      // 名单拉不到时至少把岛上「通行证」这一类翻一遍
      names = ['通行证'];
      label = '关键词兜底（通行证）';
    }

    // 千岛的搜索框默认是收起的，先点开右上角那个「🔍 搜索」
    say('正在打开搜索框…');
    openSearch(3000).then(function (input) {
      if (!input) {
        return say('打不开千岛的搜索框。\n手动点一下右上角「🔍 搜索」把它展开，再点「开始自动搜索」——脚本会记住你点过的那个输入框。', 'err');
      }
      var words = names.map(function (n) { return n + ' 通行证'; });
      state.queue = {
        words: words, i: 0, ok: 0, fail: 0, retry: 0, label: label,
        timer: null, uploaded: 0, input: input, resumes: 0,
      };
      say('开始自动搜索 · ' + label + '\n用' + (input === state.pickedInput ? '你刚点的搜索框' : '页面搜索框')
        + '逐个搜索并抓取，撞限流会自动等待；随时可按「停止」');
      saveQueue();
      stepSearch();
    });
  }

  /* 自动搜索要跨页面（千岛按 Enter 会跳到搜索结果页），所以进度得存 sessionStorage，
     跳页回来接着跑，不然一次跳转就把剩下的几百个词全丢了。 */
  var SS_QUEUE = 'qd_queue_v1';
  function saveQueue() {
    var q = state.queue;
    try {
      if (!q) { sessionStorage.removeItem(SS_QUEUE); return; }
      sessionStorage.setItem(SS_QUEUE, JSON.stringify({
        words: q.words, i: q.i, ok: q.ok, fail: q.fail, label: q.label,
        uploaded: q.uploaded || 0, resumes: q.resumes || 0, at: Date.now(),
        awaiting: q.awaiting || null, atCount: q.atCount || 0,
      }));
    } catch (e) {}
  }
  function dropQueue() {
    try { sessionStorage.removeItem(SS_QUEUE); } catch (e) {}
  }
  function resumeQueue() {
    if (state.queue) return;
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SS_QUEUE) || 'null'); } catch (e) {}
    if (!saved || !saved.words || !saved.words.length) return;
    if (saved.at && Date.now() - saved.at > 20 * 60 * 1000) { dropQueue(); return; }
    if ((saved.resumes || 0) > 120) { dropQueue(); return; }
    // 千岛的搜索是「按 Enter 跳页」，跳页时这一步的等待永远等不到结果。
    // 所以提交前记下 awaiting；回到新页面看到它，就说明上一个词已经搜过、要往后走一格，
    // 否则会卡在同一个关键词上无限重搜。
    var pending = !!(saved.awaiting && saved.awaiting.i === saved.i);
    if (pending) saved.i = saved.i + 1;
    if (saved.i >= saved.words.length) { dropQueue(); return; }

    state.queue = {
      words: saved.words, i: saved.i, ok: saved.ok || 0, fail: saved.fail || 0,
      label: saved.label || '', retry: 0, timer: null, uploaded: saved.uploaded || 0,
      input: null, resumes: (saved.resumes || 0) + 1, awaiting: null,
    };
    var q = state.queue;
    state.open = true;
    if (el.panel) el.panel.classList.add('open');
    say('跳页回来了，接着搜 · ' + saved.i + '/' + saved.words.length + '（已抓 ' + (saved.ok || 0) + ' 个词）');

    setTimeout(function () {
      if (!state.queue) return;
      // 上一个词到底抓没抓到，靠「记录数有没有变多」判断，比盲目记成功可信
      if (pending) {
        var now = 0;
        try { now = window.__QD ? window.__QD.count() : 0; } catch (e) {}
        if (now > (saved.atCount || 0)) q.ok++; else q.fail++;
      }
      stepSearch();
    }, 2200);
  }

  function stepSearch() {
    var q = state.queue;
    if (!q) return;
    if (!window.__QD) { state.queue = null; saveQueue(); return say('采集脚本掉了，刷新页面重来', 'err'); }

    if (q.i >= q.words.length) {
      state.queue = null;
      saveQueue();
      refreshCount();
      var tail = '自动搜索完成 · 成功 ' + q.ok + ' 个、无新数据 ' + q.fail + ' 个';
      if (state.auto && state.token) { say(tail + '，正在上传…'); doUpload(); }
      else say(tail + '。点「上传」或「复制 JSON」', 'ok');
      return;
    }

    var kw = q.words[q.i];
    // 搜索框每搜一次会被收起来（千岛默认收起），先确保它开着
    var input = (q.input && q.input.isConnected !== false && visible(q.input)) ? q.input : null;
    if (!input) {
      openSearch(2400).then(function (inp) {
        if (!state.queue) return;
        if (!inp) {
          state.queue = null;
          saveQueue();
          return say('搜索框又收起来了，而且点不开。\n手动点一下右上角「🔍 搜索」展开，再点「开始自动搜索」接着跑（已抓到的不会丢）。', 'err');
        }
        q.input = inp;
        stepSearch();
      });
      return;
    }

    var before = window.__QD.count();
    say('搜索 ' + (q.i + 1) + '/' + q.words.length + '：' + kw + '\n成功 ' + q.ok + ' · 无数据 ' + q.fail);
    q.awaiting = { kw: kw, i: q.i };
    q.atCount = before;
    saveQueue();
    setNativeValue(input, kw);
    submitSearch(input);

    waitForCapture(before, 12000).then(function (res) {
      if (!state.queue) return;
      q.awaiting = null;
      if (res.status === 'throttled') {
        q.retry++;
        if (q.retry > 4) {
          state.queue = null;
          saveQueue();
          return say('连续撞到千岛限流（手速太快），先停下。\n已抓到 ' + q.ok + ' 个，等 10 分钟再来，进度不会丢（上传过的都在服务端）。', 'err');
        }
        var wait = 45000 + q.retry * 30000;
        say('撞到限流，等 ' + Math.round(wait / 1000) + ' 秒后重试（第 ' + q.retry + ' 次）\n' + kw, 'warn');
        q.timer = setTimeout(function () { if (state.queue) stepSearch(); }, wait);
        return;
      }
      if (res.status === 'ok') q.ok++; else q.fail++;
      q.retry = 0;
      q.i++;
      // 边抓边传：每 12 个成功就落一次盘，免得多抓的全丢
      if (state.token && q.ok - q.uploaded >= 12) {
        q.uploaded = q.ok;
        doUpload();
      }
      saveQueue();
      q.timer = setTimeout(function () { if (state.queue) stepSearch(); }, 2200);
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    mount();
    injectCollector().then(function () {
      // 地址指向本机时别用「就绪」把警告盖掉
      if (!looksLocal(state.base)) say('就绪。滚动页面 / 切分类即可开始捕获。');
      refreshCount();
      resumeQueue();   // 上次自动搜索如果是在跳页时中断的，这里接着跑
    }).catch(function (e) {
      say(e.message, 'err');
    });
  }

  if (document.readyState === 'loading') {
    // document-start：先把 hook 装进去（越早越不容易漏请求），面板等 DOM 好了再画
    injectCollector().catch(function () {});
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
