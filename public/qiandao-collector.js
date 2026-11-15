/* 千岛（qiandao.com）行情采集器 · 控制台版
 * ---------------------------------------------------------------------------
 * 用法：
 *   1. 用电脑浏览器打开 https://qiandao.com/island?id=300569 （明日方舟岛）
 *   2. F12 → Console，整段粘贴本文件内容，回车
 *   3. 在页面上点一下分类 / 往下滚，让列表重新加载（脚本只记录粘贴之后发生的请求）
 *   4. 执行 __QD.samples() 看抓到什么，再执行 __QD.copy() 把结果复制走
 *   5. 回到「通行证工具编辑器 → 市价 → 千岛接入」，粘进输入框，保存
 *
 * 为什么要在浏览器里跑：
 *   api.qiandao.com 挂在阿里云 WAF 后面，需要 acw_sc__v2 cookie，还有频率限制。
 *   服务端裸请求会被挑战挡住，所以用「你自己已经登录/已通过校验的浏览器」来读，
 *   cookie 和真实接口一起交出去，服务端才能接着用。
 * ---------------------------------------------------------------------------
 */
(function () {
  if (window.__QD_COLLECTOR_READY__) {
    console.log('%c[千岛采集器] 已经装过了，直接 __QD.help() 看用法', 'color:#2563eb');
    return;
  }
  window.__QD_COLLECTOR_READY__ = true;

  var CAP = [];           // 捕获到的接口调用
  var MAX_RESP = 800000;  // 单个响应体最多留这么多字符，防止内存爆
  var MAX_ITEMS = 5000;   // 最多留这么多条记录

  /* ---------------- 通用抽取（与服务端 prices.js 的 extractRecords 同逻辑） ------------- */
  var TITLE_KEY = /^(title|content|name|goods_?name|item_?name|desc|description|text|subject|rawContent)$/i;
  var PRICE_KEY = /(price|amount|money|fee|成交|售价|价格|标价)/i;
  var HREF_KEY = /^(url|href|link|jump_?url|share_?url|path)$/i;
  var PASS_RE = /通行证|通行|pass/i;

  function collectArrays(node, out, depth) {
    if (depth > 6 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length && node.some(function (x) { return x && typeof x === 'object'; })) out.push(node);
      for (var i = 0; i < Math.min(node.length, 200); i++) collectArrays(node[i], out, depth + 1);
      return;
    }
    for (var k in node) {
      if (Object.prototype.hasOwnProperty.call(node, k)) collectArrays(node[k], out, depth + 1);
    }
  }

  function priceOf(v) {
    if (typeof v === 'number') return isFinite(v) && v > 0 && v < 1e7 ? v : null;
    if (typeof v === 'string') {
      var m = v.replace(/,/g, '').match(/(\d+(\.\d+)?)/);
      if (!m) return null;
      var n = Number(m[1]);
      return isFinite(n) && n > 0 && n < 1e7 ? n : null;
    }
    if (v && typeof v === 'object') {
      var keys = ['value', 'amount', 'price', 'cent', 'fen'];
      for (var i = 0; i < keys.length; i++) {
        if (v[keys[i]] != null) {
          var got = priceOf(v[keys[i]]);
          if (got != null) return /cent|fen/i.test(keys[i]) ? Math.round(got / 100) : got;
        }
      }
    }
    return null;
  }

  function deepFind(obj, keyRe, pick, depth, pri) {
    if (!obj || typeof obj !== 'object' || depth > 2) return null;
    var keys = Object.keys(obj);
    var hits = keys.filter(function (k) { return keyRe.test(k); });
    if (pri) hits.sort(function (a, b) { return pri(a) - pri(b); });
    for (var i = 0; i < hits.length; i++) {
      var v = pick(obj[hits[i]]);
      if (v != null) return v;
    }
    for (var j = 0; j < keys.length; j++) {
      var child = obj[keys[j]];
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        var got = deepFind(child, keyRe, pick, depth + 1, pri);
        if (got != null) return got;
      }
    }
    return null;
  }

  function eliteFromTitle(text) {
    var s = String(text || '');
    if (/精\s*[二贰2]|精英\s*[二贰2]|ELITE\s*[-_ ]?2|E2/i.test(s)) return 'ELITE2';
    if (/精\s*[一壹1]|精英\s*[一壹1]|ELITE\s*[-_ ]?1|E1/i.test(s)) return 'ELITE1';
    return null;
  }

  /* ---------------- SPU 抽取（千岛 posts/by-tag-v4 主路径） ----------------
   * data.posts[].labels[].spu = {
   *   name: '塔露拉(精英二VER.)-通行认证56.0',
   *   strikePrice: '39.27',     ← 市价（成交/划价）
   *   minOnlinePrice: '41'      ← 目前最低在售
   * }
   * 「XX-通行认证56.0」是精英一，「XX(精英二VER.)-通行认证56.0」是精英二。
   */
  var SPU_ELITE_RE = /[（(]\s*精英\s*([二一2壹])\s*VER\.?\s*[）)]/i;

  function parseSpuName(raw) {
    var s = String(raw || '').trim();
    if (!s) return null;
    var name = s, series = '';
    var m = s.match(/^(.+)[-－—]([^-－—]+)$/);
    if (m) { name = m[1].trim(); series = m[2].trim(); }
    var elite = 'ELITE1';
    var e = name.match(SPU_ELITE_RE);
    if (e) {
      elite = /[二2壹]/.test(e[1]) ? 'ELITE2' : 'ELITE1';
      name = name.replace(e[0], '').trim();
    }
    return name ? { name: name, elite: elite, series: series } : null;
  }

  function extractSpuRecords(payload, opts) {
    var o = opts || {};
    var field = o.priceField === 'minOnlinePrice' ? 'minOnlinePrice' : 'strikePrice';
    var altField = field === 'strikePrice' ? 'minOnlinePrice' : 'strikePrice';
    var seriesFilter = String(o.series || o.seriesFilter || '').trim();
    var byKey = {};

    function addOne(spu) {
      var p = parseSpuName(spu.name);
      if (!p) return;
      if (seriesFilter && p.series.indexOf(seriesFilter) < 0) return;
      var price = priceOf(spu[field]);
      var alt = priceOf(spu[altField]);
      if (price == null) return;
      var key = String(spu.id || (p.name + '|' + p.elite));
      if (byKey[key]) { byKey[key].count++; return; }
      byKey[key] = {
        name: p.name, elite: p.elite, series: p.series,
        price: price, online: alt,
        spuId: spu.id ? String(spu.id) : null,
        title: String(spu.name), count: 1, source: 'spu',
      };
    }

    (function visit(node, depth) {
      if (depth > 9 || !node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) visit(node[i], depth + 1); return; }
      if (typeof node.name === 'string' && (node.strikePrice != null || node.minOnlinePrice != null)) addOne(node);
      for (var k in node) {
        if (Object.prototype.hasOwnProperty.call(node, k)) visit(node[k], depth + 1);
      }
    })(payload, 0);

    var out = [];
    for (var key2 in byKey) {
      if (Object.prototype.hasOwnProperty.call(byKey, key2)) out.push(byKey[key2]);
    }
    return out;
  }

  function extractRecords(payload, opts) {
    var spu = extractSpuRecords(payload, opts);
    if (spu.length) return spu;
    var arrays = [];
    collectArrays(payload, arrays, 0);
    var out = [], seen = {};
    for (var a = 0; a < arrays.length; a++) {
      var arr = arrays[a];
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
        var title = deepFind(it, TITLE_KEY, function (v) {
          return typeof v === 'string' && v.trim().length >= 2 && v.length <= 300 ? v.trim() : null;
        }, 0, function (k) { return /^title$/i.test(k) ? 0 : /^(content|name)$/i.test(k) ? 1 : 2; });
        if (!title) continue;
        var price = deepFind(it, PRICE_KEY, priceOf, 0);
        if (price == null) continue;
        var href = deepFind(it, HREF_KEY, function (v) {
          return typeof v === 'string' && /^https?:|^\//.test(v) ? v : null;
        }, 0);
        var key = title + '|' + price;
        if (seen[key]) continue;
        seen[key] = 1;
        out.push({ name: null, title: title, price: price, elite: eliteFromTitle(title), href: href || null, source: 'text' });
        if (out.length >= MAX_ITEMS) return out;
      }
    }
    return out;
  }

  /* ---------------- 抓取 ---------------- */
  function shortUrl(u) {
    try { var x = new URL(u, location.href); return x.host + x.pathname; } catch (e) { return String(u).slice(0, 80); }
  }

  function addCapture(rec) {
    // 油猴面板自己上传会话时会把计时暂停，别把它自己的请求当成行情接口
    if (window.__QD_PAUSE__) return null;
    // 同 method+url+body 合并，只留最后一次的响应
    for (var i = 0; i < CAP.length; i++) {
      if (CAP[i].method === rec.method && CAP[i].url === rec.url && CAP[i].body === rec.body) {
        CAP[i].count++;
        if (rec.resp) { CAP[i].resp = rec.resp; CAP[i].status = rec.status; }
        return CAP[i];
      }
    }
    rec.count = 1;
    CAP.push(rec);
    var n = rec.resp ? extractRecords(safeParse(rec.resp)).length : 0;
    console.log('%c[采集] ' + rec.method + ' ' + shortUrl(rec.url) + (rec.status ? ' → ' + rec.status : '') + (n ? '　抽到 ' + n + ' 条' : ''),
      'color:#0f766e');
    return rec;
  }

  function safeParse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function attach(rec, promise) {
    promise.then(function (r) {
      rec.status = r.status;
      var ct = r.headers.get('content-type') || '';
      if (!/json|text/i.test(ct)) return;
      r.clone().text().then(function (t) {
        if (t && t.length <= MAX_RESP && safeParse(t)) rec.resp = t;
      }).catch(function () {});
    }).catch(function () {});
  }

  // hook fetch
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url);
      var hdrs = {};
      var src = (init && init.headers) || (input && input.headers);
      if (src) {
        if (typeof src.forEach === 'function') src.forEach(function (v, k) { hdrs[k] = v; });
        else Object.keys(src).forEach(function (k) { hdrs[k] = src[k]; });
      }
      var rec = addCapture({
        url: String(url), method: ((init && init.method) || 'GET').toUpperCase(),
        headers: hdrs, body: init && init.body != null ? String(init.body) : '',
      });
      var p = origFetch.apply(this, arguments);
      rec && attach(rec, p);
      return p;
    } catch (e) {
      return origFetch.apply(this, arguments);
    }
  };

  // hook XHR（站点可能用 axios 走 XHR）
  var XO = XMLHttpRequest.prototype.open;
  var XS = XMLHttpRequest.prototype.setRequestHeader;
  var XD = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__qd = { method: String(m || 'GET').toUpperCase(), url: String(u), headers: {} };
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this.__qd) this.__qd.headers[k] = v;
    return XS.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (b) {
    if (this.__qd) {
      this.__qd.body = b == null ? '' : String(b);
      var rec = addCapture(this.__qd);
      var self = this;
      if (!rec) return XD.apply(this, arguments);
      this.addEventListener('load', function () {
        if (!rec) return;
        rec.status = self.status;
        try {
          var t = self.responseType === '' || self.responseType === 'text' ? self.responseText : '';
          if (t && t.length <= MAX_RESP && safeParse(t)) rec.resp = t;
        } catch (e) {}
      });
    }
    return XD.apply(this, arguments);
  };

  /* ---------------- 对外 API ---------------- */
  function allRecords(opts) {
    var out = [];
    for (var i = 0; i < CAP.length; i++) {
      var j = safeParse(CAP[i].resp);
      if (!j) continue;
      var recs = extractRecords(j, opts || {});
      for (var k = 0; k < recs.length; k++) {
        recs[k]._api = i;
        out.push(recs[k]);
      }
    }
    return out;
  }

  function pickSamples(opts) {
    var o = opts || {};
    var needPass = o.pass !== false;
    var needElite = o.elite !== false;
    var list = allRecords({ priceField: o.price, seriesFilter: o.series });
    if (needPass) list = list.filter(function (r) { return PASS_RE.test(r.title); });
    if (needElite) list = list.filter(function (r) { return !!r.elite; });
    if (o.series) list = list.filter(function (r) { return String(r.series || '').indexOf(o.series) >= 0; });
    return list;
  }

  var API = {
    help: function () {
      console.log([
        '',
        '千岛采集器 · 可用命令',
        '  __QD.list()              看抓到了哪些接口',
        '  __QD.show(n)             看第 n 个接口的返回长什么样',
        '  __QD.samples()           抽出「通行证 + 精一/精二 + 价格」的记录并打印（默认筛选）',
        '  __QD.samples({pass:false})   不要求标题里有「通行证」',
        '  __QD.samples({elite:false})  不要求标了精一/精二',
        '  __QD.samples({series:"通行认证56.0"})  只看某一弹',
        '  __QD.samples({price:"minOnlinePrice"}) 用「最低在售」而不是「市价 strikePrice」',
        '  __QD.copy()              把结果复制到剪贴板（回编辑器粘贴这个）',
        '  __QD.bundle()            拿到结果对象（自己看 / 自己存）',
        '  __QD.download()          存成 qiandao-bundle.json',
        '  __QD.clear()             清空已捕获的请求，重新抓',
        '',
        '抓不到东西？在页面上切一下分类、往下滚几次，或者搜一下「通行证」，让列表重新请求一次。',
        '',
      ].join('\n'));
      return '已打印帮助';
    },

    list: function () {
      if (!CAP.length) {
        console.log('%c还没有捕获到任何接口。先在页面上操作一下（切分类 / 滚动 / 搜索）。', 'color:#b91c1c');
        return [];
      }
      var rows = CAP.map(function (c, i) {
        var n = c.resp ? extractRecords(safeParse(c.resp)).length : 0;
        return { '#': i, 方法: c.method, 接口: shortUrl(c.url), 状态: c.status || '', 次数: c.count, 可抽记录: n };
      });
      console.table(rows);
      return rows;
    },

    show: function (n) {
      var c = CAP[n];
      if (!c) return console.log('没有第 ' + n + ' 个接口，先 __QD.list()');
      console.log('URL:', c.url);
      console.log('请求头:', c.headers);
      console.log('请求体:', c.body);
      console.log('返回(前 2000 字):', (c.resp || '(空/非 JSON)').slice(0, 2000));
      return c;
    },

    samples: function (opts) {
      var list = pickSamples(opts);
      var raw = allRecords();
      var spuCount = raw.filter(function (r) { return r.source === 'spu'; }).length;
      console.log('%c共 ' + raw.length + ' 条原始记录（其中 SPU 报价 ' + spuCount + ' 条），筛完剩 ' + list.length + ' 条',
        'color:#2563eb;font-weight:bold');
      if (!list.length) {
        console.log('一条都没筛出来。试试 __QD.samples({pass:false}) 或 __QD.samples({elite:false}) 看看原始长什么样，再用 __QD.show(n) 检查接口返回。');
        return list;
      }
      console.table(list.slice(0, 40).map(function (r) {
        return {
          干员: r.name || '(需按标题匹配)',
          精英化: r.elite || '—',
          市价: r.price,
          最低在售: r.online == null ? '—' : r.online,
          系列: r.series || '—',
          商品名: String(r.title || '').slice(0, 40),
        };
      }));
      if (list.length > 40) console.log('…还有 ' + (list.length - 40) + ' 条，__QD.copy() 会全部带上');
      return list;
    },

    bundle: function (opts) {
      var list = pickSamples(opts);
      var tokens = {};
      try {
        ['localStorage', 'sessionStorage'].forEach(function (store) {
          var s = window[store];
          for (var i = 0; i < s.length; i++) {
            var k = s.key(i);
            if (/token|auth|uid|user|session|ticket|sign|device/i.test(k)) {
              tokens[store + ':' + k] = String(s.getItem(k) || '').slice(0, 600);
            }
          }
        });
      } catch (e) {}
      var qs = new URLSearchParams(location.search);
      return {
        kind: 'qiandao-collector',
        version: 1,
        origin: location.origin,
        url: location.href,
        islandId: qs.get('id') || '',
        ua: navigator.userAgent,
        cookie: document.cookie,
        tokens: tokens,
        apis: CAP.map(function (c) {
          return {
            method: c.method, url: c.url, headers: c.headers, body: c.body,
            status: c.status || null, count: c.count,
          };
        }),
        samples: list.map(function (r) {
          return {
            name: r.name || null,
            title: r.title,
            price: r.price,
            elite: r.elite || null,
            series: r.series || '',
            online: r.online == null ? null : r.online,
            spuId: r.spuId || null,
            href: r.href || null,
          };
        }),
        collectedAt: new Date().toISOString(),
      };
    },

    copy: function (opts) {
      var text = JSON.stringify(API.bundle(opts));
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          console.log('%c已复制（' + text.length + ' 字符），回编辑器粘贴到「千岛接入」里', 'color:#047857;font-weight:bold');
        }).catch(function () { fallback(); console.log('%c已复制（用的备用方式）', 'color:#047857'); });
      } else {
        fallback();
        console.log('%c已复制', 'color:#047857;font-weight:bold');
      }
      return text.length;
    },

    download: function (opts) {
      var text = JSON.stringify(API.bundle(opts), null, 2);
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'qiandao-bundle.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
      console.log('已下载 qiandao-bundle.json');
    },

    clear: function () {
      CAP.length = 0;
      console.log('已清空捕获，继续在页面上操作即可。');
    },

    captured: function () { return CAP; },
  };

  window.__QD = API;

  console.log('%c[千岛采集器] 已启动', 'color:#2563eb;font-size:14px;font-weight:bold');
  console.log('现在请在页面上：切一下分类 / 往下滚几屏 / 搜一下「通行证」，让列表重新加载。');
  console.log('然后执行  __QD.samples()  看结果，再执行  __QD.copy()  复制。');
  console.log('不确定就用  __QD.help()  看全部命令。');
})();
