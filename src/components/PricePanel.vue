<template>
  <div class="section price-page">
    <div class="section-header">
      <span class="section-eyebrow">PRICE</span>
      <h1 class="section-title">市价</h1>
      <p class="section-description">
        把 Box_Id.json 里每个干员的 <code>market_price</code>（精一 / 精二）从千岛行情自动拉回来，
        聚合去极值后走 PR 写回。也可以先手工填、或者导入一份 CSV，不必一次就把抓取配好。
      </p>
    </div>

    <div v-if="!authReady" class="pr-empty">正在校验权限…</div>
    <div v-else-if="!isOwner" class="pr-empty">只有仓库所有者可以维护市价。</div>

    <div v-else class="pr-wrap">
      <!-- ── 千岛接入 ─────────────────────────────────────────────── -->
      <div class="panel">
        <h3 class="panel-title">千岛接入</h3>
        <p class="form-hint" style="margin:0 0 12px;">
          千岛的接口挂在阿里云 WAF 后面，服务端裸请求会被挑战挡住。所以改成
          <b>用你自己的浏览器先抓到一份行情，把结果交给服务端</b>——cookie 和真实接口一起带上，
          之后服务端就能复用这份会话去刷新。
        </p>

        <ol class="qd-steps">
          <li>点下面的「打开千岛明日方舟岛」，用电脑浏览器（Chrome / Edge）打开</li>
          <li><b>F12 → Console</b>，点「复制采集脚本」，整段粘贴进去回车</li>
          <li>在页面上切一下分类、往下滚几屏、或者搜一下「通行证」，让列表重新请求</li>
          <li>执行 <code>__QD.samples()</code> 看有没有抓到，再执行 <code>__QD.copy()</code></li>
          <li>把复制到的内容粘回下面的框里，点「保存并解析」</li>
        </ol>

        <div class="pr-bar" style="margin-top:0;">
          <a class="btn btn-secondary" :href="islandUrl" target="_blank" rel="noopener">打开千岛明日方舟岛 ↗</a>
          <button class="btn btn-secondary" @click="copyCollector">复制采集脚本</button>
          <button class="btn btn-secondary" @click="testSession" :disabled="!session.present || testing">
            {{ testing ? '测试中…' : '测试服务端直连' }}
          </button>
          <button class="btn btn-secondary" @click="clearSession" :disabled="!session.present">清除会话</button>
        </div>

        <div v-if="session.present" class="qd-status" :class="session.expired ? 'exp' : 'ok'">
          <span class="qd-dot"></span>
          <template v-if="session.expired">
            会话已过期（{{ session.ageMinutes }} 分钟前保存）—— 回千岛重新抓一次
          </template>
          <template v-else>
            会话有效 · {{ session.cookieCount }} 个 cookie · {{ session.apiCount }} 个接口 ·
            {{ session.sampleCount }} 条记录 · {{ session.ageMinutes }} 分钟前保存 ·
            约 {{ session.expiresInMinutes }} 分钟后过期
          </template>
        </div>
        <div v-else class="qd-status none"><span class="qd-dot"></span>还没有会话，先按上面五步抓一次</div>

        <div class="form-group" style="margin-top:12px;">
          <label class="form-label">粘贴 <code>__QD.copy()</code> 的结果（JSON）</label>
          <textarea class="form-input pr-json" rows="5" v-model="bundleText"
            placeholder='{"cookie":"acw_sc__v2=...; ...","apis":[...],"samples":[{"title":"...","price":120}]}'></textarea>
          <span class="form-hint">只存在服务端 KV 里，接口回显会打码；不会进仓库、不会进 git。</span>
        </div>

        <div class="pr-bar" style="margin-top:8px;">
          <button class="btn btn-primary" @click="saveSession" :disabled="savingSession || !bundleText.trim()">
            {{ savingSession ? '解析中…' : '保存并解析' }}
          </button>
          <label class="qd-check">
            <input type="checkbox" v-model="form.requirePassKeyword" @change="saveConfig(true)" />
            只认标题里带「通行证」的记录
          </label>
        </div>

        <div v-if="sessionDetected" class="qd-detected">
          解析到：原始记录 <b>{{ sessionDetected.samples }}</b> 条，其中标了精英化
          <b>{{ sessionDetected.withElite }}</b> 条、带「通行证」<b>{{ sessionDetected.withPass }}</b> 条，
          可用接口 <b>{{ sessionDetected.apis }}</b> 个。
          <div v-if="sessionDetected.preview && sessionDetected.preview.length" class="qd-preview">
            <div v-for="(p, i) in sessionDetected.preview" :key="i">
              <span class="qd-price">¥{{ p.price }}</span>
              <span class="qd-title">{{ String(p.title).slice(0, 70) }}</span>
            </div>
          </div>
        </div>
        <div v-if="testResult" class="pr-alert" :class="testResult.ok ? 'ok' : 'info'" style="white-space:pre-wrap;">
          {{ testResult.text }}
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">自动抓取</h3>
        <p class="form-hint" style="margin:0 0 12px;">
          行情一个月更新一次就够，所以不追求一次抓完：每次只抓几页、页间隔几秒，
          撞到千岛「手速太快」就自动降速并退避，<b>进度存着</b>，下个周期接着抓剩下的。
          cron 每 30 分钟醒一次问一句「现在该继续吗」。
        </p>

        <div class="qd-grid">
          <div class="qd-kv"><span>状态</span><b :class="'qd-phase ' + crawlPhaseClass">{{ crawlPhaseLabel }}</b></div>
          <div class="qd-kv"><span>已抓商品</span><b>{{ crawl.records || 0 }}</b></div>
          <div class="qd-kv"><span>覆盖干员</span><b>{{ crawl.characters || 0 }}</b></div>
          <div class="qd-kv"><span>翻到第几页</span><b>{{ crawl.page || 0 }}</b></div>
          <div class="qd-kv"><span>页间隔</span><b>{{ crawl.delayMs ? (crawl.delayMs / 1000) + 's' : '—' }}</b></div>
          <div class="qd-kv"><span>下次可继续</span><b>{{ nextRunLabel }}</b></div>
        </div>

        <div v-if="crawl.present && crawl.series && crawl.series.length" class="form-hint" style="margin-top:6px;">
          涉及系列（{{ crawl.seriesCount }}）：{{ crawl.series.join('、') }}{{ crawl.seriesCount > crawl.series.length ? ' …' : '' }}
          <template v-if="!form.seriesFilter && crawl.seriesCount > 1">　⚠️ 多弹价格混在一起算，建议在上面「只取某一弹」里钉死一个</template>
        </div>
        <div v-if="crawl.lastError" class="pr-alert info" style="margin-top:10px;">{{ crawl.reason }}：{{ crawl.lastError }}</div>
        <div v-else-if="crawl.note" class="pr-alert info" style="margin-top:10px;">{{ crawl.note }}</div>
        <div v-else-if="crawl.present" class="form-hint" style="margin-top:8px;">{{ crawl.reason }}</div>

        <div class="pr-bar">
          <button class="btn btn-primary" @click="crawlStep()" :disabled="crawlBusy">
            {{ crawlBusy ? '抓取中…' : (crawl.phase === 'done' ? '再抓一轮（忽略月周期）' : '立即继续抓取') }}
          </button>
          <button class="btn btn-secondary" @click="previewCrawl" :disabled="crawlBusy || !crawl.records">
            用它算价并预览
          </button>
          <button class="btn btn-secondary" @click="crawlReset" :disabled="crawlBusy || !crawl.present">重置任务</button>
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">数据源</h3>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">来源</label>
            <select class="form-input" v-model="form.provider">
              <option value="qiandao">千岛行情（浏览器采集 / 会话直连）</option>
              <option value="manual">手工价表（永远可用）</option>
              <option value="import">导入 JSON / CSV</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">最少样本数</label>
            <input class="form-input" type="number" min="1" max="20" v-model.number="form.minSamples" />
            <span class="form-hint">低于这个样本数不覆盖旧价，避免一条孤例把价格带跑偏。</span>
          </div>
          <div class="form-group">
            <label class="form-label">异常剔除（MAD 倍数）</label>
            <input class="form-input" type="number" min="1" max="8" step="0.5" v-model.number="form.outlierMad" />
          </div>
          <div class="form-group">
            <label class="form-label">精一折算比例</label>
            <input class="form-input" type="number" min="0.3" max="1" step="0.01" v-model.number="form.elite1Ratio" />
            <span class="form-hint">只拿到一个精英化报价时，按这个比例推算另一个。</span>
          </div>
        </div>

        <div v-if="form.provider === 'qiandao'" class="pr-sub">
          <p class="form-hint" style="margin:0 0 10px;">
            只要上面存过会话，下面的接口地址就可以留空——采集时会重放会话里记录的真实接口。
            这一块是「哪天千岛放出稳定公开接口」时的兜底。
          </p>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">价格来源</label>
              <select class="form-input" v-model="form.priceField">
                <option value="strikePrice">市价 strikePrice（成交/划价）</option>
                <option value="minOnlinePrice">最低在售 minOnlinePrice</option>
              </select>
              <span class="form-hint">千岛每个商品同时给这两个值，箱子价一般看 strikePrice。</span>
            </div>
            <div class="form-group">
              <label class="form-label">只取某一弹（可空）</label>
              <input class="form-input" v-model="form.seriesFilter" placeholder="通行认证56.0" />
              <span class="form-hint">留空=所有系列混在一起取中位数；填了就只算这一弹。</span>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">接口地址（抓包得到）</label>
              <input class="form-input" v-model="form.endpoint" placeholder="https://api.qiandao.cn/xxx/list?page={page}" />
            </div>
            <div class="form-group pr-narrow">
              <label class="form-label">方法</label>
              <select class="form-input" v-model="form.method">
                <option>POST</option>
                <option>GET</option>
              </select>
            </div>
            <div class="form-group pr-narrow">
              <label class="form-label">模式</label>
              <select class="form-input" v-model="form.mode">
                <option value="feed">列表翻页</option>
                <option value="search">按干员名搜索</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">请求头 JSON（Cookie / Token 放这里）</label>
              <textarea class="form-input pr-json" rows="3" v-model="form.headersText" placeholder='{"Cookie":"...","User-Agent":"..."}'></textarea>
              <span class="form-hint">只在服务端使用；保存后回显会打码，留空表示保持原值。</span>
            </div>
            <div class="form-group">
              <label class="form-label">请求体模板</label>
              <textarea class="form-input pr-json" rows="3" v-model="form.body" placeholder='{"keyword":"{keyword}","page":{page}}'></textarea>
              <span class="form-hint">搜模式可用 <code>{keyword}</code>，翻页模式可用 <code>{page}</code>。</span>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">字段映射</label>
              <input class="form-input" v-model="form.mappingItems" placeholder="items 路径，例如 data.list" />
            </div>
            <div class="form-group">
              <label class="form-label">标题字段</label>
              <input class="form-input" v-model="form.mappingName" placeholder="title" />
            </div>
            <div class="form-group">
              <label class="form-label">价格字段</label>
              <input class="form-input" v-model="form.mappingPrice" placeholder="price" />
            </div>
            <div class="form-group">
              <label class="form-label">精英化字段（可空）</label>
              <input class="form-input" v-model="form.mappingElite" placeholder="elite" />
            </div>
          </div>
        </div>

        <div v-if="form.provider === 'import'" class="pr-sub">
          <label class="form-label">粘贴 JSON（数组）或 CSV（name,elite,price 三列）</label>
          <textarea class="form-input pr-json" rows="6" v-model="importText" placeholder='[{"name":"阿米娅","elite":"ELITE2","price":112}]'></textarea>
          <span class="form-hint">elite 支持 ELITE1/ELITE2、精一/精二、1/2；CSV 首行可以是表头。</span>
        </div>

        <div class="pr-bar">
          <button class="btn btn-primary" @click="saveConfig" :disabled="saving">保存数据源配置</button>
          <button class="btn btn-secondary" @click="preview" :disabled="loading">
            {{ loading ? '采集/计算中…' : '拉取并预览' }}
          </button>
          <button class="btn btn-success" @click="apply" :disabled="loading || !diffs.length">
            应用 {{ diffs.length }} 处改动（提 PR）
          </button>
          <a v-if="prUrl" :href="prUrl" target="_blank" rel="noopener" class="pr-link">打开 PR</a>
        </div>
        <div v-if="error" class="pr-alert err">{{ error }}</div>
        <div v-if="notice" class="pr-alert ok">{{ notice }}</div>
        <div v-if="hint" class="pr-alert info">{{ hint }}</div>
      </div>

      <div class="panel" v-if="summary">
        <h3 class="panel-title">采集结果</h3>
        <div class="pr-stats">
          <div><span>抓取记录</span><b>{{ summary.recordsCount || 0 }}</b></div>
          <div><span>过滤后</span><b>{{ summary.filteredCount || 0 }}</b></div>
          <div><span>报价样本</span><b>{{ summary.samples }}</b></div>
          <div><span>命中干员</span><b>{{ summary.matchedCharacters }}</b></div>
          <div><span>待改动</span><b>{{ summary.diffs }}</b></div>
          <div><span>数据来源</span><b>{{ sourceLabel }}</b></div>
          <div><span>目标仓库</span><b>{{ summary.target.kind }} · {{ summary.target.base }}</b></div>
        </div>
        <div v-if="summary.stale" class="pr-alert info" style="margin-top:10px;">
          这次用的是你上次在浏览器里抓到的快照（服务端直连失败），价格可能不是最新的。
        </div>
        <div v-if="summary.relaxedKeyword" class="pr-alert info" style="margin-top:10px;">
          加上「通行证」过滤后一条都不剩，已自动放宽——建议确认一下这个岛的分类是不是把通行证和其他周边混在一起。
        </div>
        <div v-if="summary.hint" class="pr-alert info" style="margin-top:10px;">{{ summary.hint }}</div>
        <div v-if="summary.unmatchedCount" class="pr-alert info" style="margin-top:10px;">
          有 {{ summary.unmatchedCount }} 条记录没匹配上干员名（前几条：{{ (summary.unmatched || []).slice(0, 3).join(' / ') }}）
        </div>
        <div v-if="summary.errors && summary.errors.length" class="pr-alert info" style="margin-top:10px;">
          部分请求失败：{{ summary.errors.slice(0, 3).join('；') }}
        </div>
      </div>

      <div class="panel" v-if="diffs.length">
        <h3 class="panel-title">涨跌预览（{{ diffs.length }}）</h3>
        <div class="pr-table-box">
          <table class="pr-table">
            <thead>
              <tr><th>盒号</th><th>干员</th><th>精英化</th><th>现价</th><th>新价</th><th>变化</th></tr>
            </thead>
            <tbody>
              <tr v-for="(d, i) in diffs" :key="i">
                <td>{{ d.boxId }}</td>
                <td>{{ d.name }}</td>
                <td>{{ d.elite === 'ELITE2' ? '精二' : '精一' }}</td>
                <td>{{ d.from == null ? '—' : d.from }}</td>
                <td>{{ d.to }}</td>
                <td :class="deltaClass(d)">{{ deltaText(d) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">当前价表（{{ matrix.length }} 名干员）</h3>
        <div class="pr-bar" style="margin-bottom:10px;">
          <input class="form-input pr-filter" v-model="matrixFilter" placeholder="搜索干员名" />
          <span class="form-hint">共 {{ matrix.length }} 条，展示前 {{ filteredMatrix.length }} 条</span>
        </div>
        <div class="pr-table-box" style="max-height:420px;">
          <table class="pr-table">
            <thead>
              <tr><th>干员</th><th>来源盒号</th><th>精一</th><th>精二</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in filteredMatrix.slice(0, 300)" :key="m.name + m.boxId">
                <td>{{ m.name }}</td>
                <td>{{ m.boxId }}</td>
                <td>{{ m.ELITE1 == null ? '—' : m.ELITE1 }}</td>
                <td>{{ m.ELITE2 == null ? '—' : m.ELITE2 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'

export default {
  name: 'PricePanel',
  data() {
    return {
      authReady: false,
      isOwner: false,
      loading: false,
      saving: false,
      error: '',
      notice: '',
      hint: '',
      prUrl: '',
      matrix: [],
      matrixFilter: '',
      diffs: [],
      summary: null,
      importText: '',
      session: { present: false },
      sessionDetected: null,
      crawl: { present: false },
      crawlBusy: false,
      previewFromCrawl: false,
      bundleText: '',
      savingSession: false,
      testing: false,
      testResult: null,
      islandId: '300569',
      form: {
        provider: 'manual',
        minSamples: 3,
        outlierMad: 3,
        elite1Ratio: 0.72,
        requirePassKeyword: true,
        endpoint: '',
        method: 'POST',
        mode: 'feed',
        priceField: 'strikePrice',
        seriesFilter: '',
        headersText: '',
        body: '',
        mappingItems: 'data.list',
        mappingName: 'title',
        mappingPrice: 'price',
        mappingElite: 'elite',
      },
    }
  },
  computed: {
    islandUrl() {
      return 'https://qiandao.com/island?id=' + (this.islandId || '300569')
    },
    sourceLabel() {
      const s = this.summary && this.summary.source
      if (s === 'session-replay') return '会话重放'
      if (s === 'session-cache') return '会话快照'
      if (s === 'crawl') return '抓取任务'
      if (s === 'endpoint') return '手填接口'
      return (this.summary && this.summary.provider) || '—'
    },
    crawlPhaseLabel() {
      const c = this.crawl || {}
      if (!c.present) return '还没有任务'
      if (c.phase === 'done') return c.appliedAt ? '已完成并写回' : '抓取完成'
      if (c.phase === 'cooldown') return '退避中（等限流过去）'
      if (c.phase === 'blocked') return '需要重新抓 cookie'
      if (c.phase === 'running') return '抓取中'
      return '待开始'
    },
    crawlPhaseClass() {
      const p = (this.crawl || {}).phase
      if (p === 'done') return 'ok'
      if (p === 'cooldown') return 'warn'
      if (p === 'blocked') return 'err'
      return ''
    },
    nextRunLabel() {
      const c = this.crawl || {}
      if (!c.present) return '—'
      if (c.phase === 'cooldown' && c.nextRunInMinutes != null) return c.nextRunInMinutes + ' 分钟后'
      if (c.phase === 'done' && c.finishedAt) {
        const days = Math.floor((Date.now() - Date.parse(c.finishedAt)) / 86400000)
        const left = (c.refreshDays || 30) - days
        return left > 0 ? `${left} 天后（月周期）` : '随时'
      }
      if (c.ready) return '现在'
      return '—'
    },
    filteredMatrix() {
      const k = this.matrixFilter.trim().toLowerCase()
      if (!k) return this.matrix
      return this.matrix.filter(m => m.name.toLowerCase().includes(k) || String(m.boxId).includes(k))
    },
  },
  async mounted() {
    try {
      const { data } = await axios.get('/api/auth/status')
      this.isOwner = !!(data && data.authenticated && data.isOwner)
    } catch (e) { this.isOwner = false }
    this.authReady = true
    if (this.isOwner) await this.load()
  },
  methods: {
    async load() {
      this.loading = true
      try {
        const { data } = await axios.get('/api/prices')
        if (!data || !data.success) throw new Error((data && data.error) || '读取失败')
        this.matrix = data.matrix || []
        this.session = (data.session && data.session.present) ? data.session : { present: false }
        this.crawl = data.crawl || { present: false }
        const p = data.prices || {}
        this.islandId = p.islandId || '300569'
        this.form.provider = p.provider || 'manual'
        this.form.minSamples = p.minSamples || 3
        this.form.outlierMad = p.outlierMad || 3
        this.form.elite1Ratio = p.elite1Ratio || 0.72
        this.form.requirePassKeyword = p.requirePassKeyword !== false
        this.form.endpoint = p.endpoint || ''
        this.form.method = p.method || 'POST'
        this.form.mode = p.mode || 'feed'
        this.form.priceField = p.priceField || 'strikePrice'
        this.form.seriesFilter = p.seriesFilter || ''
        this.form.mappingItems = (p.mapping && p.mapping.items) || 'data.list'
        this.form.mappingName = (p.mapping && p.mapping.name) || 'title'
        this.form.mappingPrice = (p.mapping && p.mapping.price) || 'price'
        this.form.mappingElite = (p.mapping && p.mapping.elite) || 'elite'
        this.form.headersText = ''
      } catch (e) {
        this.error = '读取市价失败：' + ((e.response && e.response.data && e.response.data.error) || e.message)
      } finally {
        this.loading = false
      }
    },
    // 复制采集脚本：直接拉 public/qiandao-collector.js，保证和仓库里那份一致
    async copyCollector() {
      this.error = ''
      try {
        const res = await fetch('/qiandao-collector.js', { cache: 'no-store' })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const code = await res.text()
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(code)
        } else {
          const ta = document.createElement('textarea')
          ta.value = code
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        this.notice = '脚本已复制（' + code.length + ' 字符）。去千岛页面 F12 → Console 粘贴回车。'
      } catch (e) {
        this.error = '复制脚本失败：' + e.message
      }
    },
    async saveSession() {
      this.savingSession = true
      this.error = ''
      this.notice = ''
      this.sessionDetected = null
      this.testResult = null
      try {
        let bundle
        try {
          bundle = JSON.parse(this.bundleText)
        } catch (e) {
          throw new Error('粘进来的不是合法 JSON，确认复制完整了（__QD.copy() 会一次性复制）')
        }
        const { data } = await axios.post('/api/prices?action=save-session', { bundle })
        if (!data || !data.success) throw new Error((data && data.error) || '保存失败')
        this.session = data.session || { present: false }
        this.sessionDetected = data.detected || null
        this.bundleText = ''
        this.notice = '会话已保存' + (data.note ? '：' + data.note : '')
        await this.preview()
      } catch (e) {
        this.error = '保存失败：' + ((e.response && e.response.data && e.response.data.error) || e.message)
      } finally {
        this.savingSession = false
      }
    },
    async testSession() {
      this.testing = true
      this.testResult = null
      try {
        const { data } = await axios.post('/api/prices?action=session-test', {})
        const lines = (data.results || []).map(r => r.ok
          ? '✓ ' + r.url + ' → ' + r.records + ' 条'
          : '✗ ' + r.url + ' → ' + r.error)
        this.testResult = {
          ok: !!data.ok,
          text: (data.ok ? '服务端能直连，可以自动刷新。' : (data.error || '服务端直连不通，只能靠浏览器快照。')) + '\n' + lines.join('\n'),
        }
        if (data.session) this.session = data.session
      } catch (e) {
        this.testResult = { ok: false, text: '测试失败：' + ((e.response && e.response.data && e.response.data.error) || e.message) }
      } finally {
        this.testing = false
      }
    },
    async crawlStep() {
      this.crawlBusy = true
      this.error = ''
      this.notice = ''
      try {
        const { data } = await axios.post('/api/prices?action=crawl-step', { force: true })
        if (data.crawl) this.crawl = data.crawl
        if (data.ok === false && data.paused) {
          this.error = `${data.error}　→ 已暂停，${data.waitMinutes} 分钟后（或下次 cron）接着抓第 ${data.page} 页`
        } else if (data.skipped) {
          this.notice = data.reason || '现在不需要抓'
        } else {
          this.notice = `本轮抓了 ${data.pages} 页、新增 ${data.added} 条，累计 ${data.records} 个商品`
            + (data.crawl && data.crawl.note ? '。' + data.crawl.note : '')
        }
      } catch (e) {
        this.error = '抓取失败：' + ((e.response && e.response.data && e.response.data.error) || e.message)
      } finally {
        this.crawlBusy = false
      }
    },
    async crawlReset() {
      if (!confirm('重置抓取任务？已攒下的记录会一起清掉（不会改动 Box_Id.json）。')) return
      try {
        const { data } = await axios.post('/api/prices?action=crawl-reset', {})
        this.crawl = data.crawl || { present: false }
        this.notice = '任务已重置'
      } catch (e) {
        this.error = '重置失败：' + e.message
      }
    },
    async previewCrawl() {
      this.loading = true
      this.error = ''
      this.notice = ''
      this.hint = ''
      this.diffs = []
      this.summary = null
      try {
        const { data } = await axios.post('/api/prices?action=crawl-preview', this.payloadBase())
        if (!data) throw new Error('无返回')
        if (!data.success) {
          this.error = data.error || '算价失败'
          this.hint = data.hint || ''
          return
        }
        this.summary = data
        this.diffs = data.list || []
        this.previewFromCrawl = true
        this.notice = this.diffs.length ? '预览完成，确认后点「应用」提 PR' : '价格没有变化'
      } catch (e) {
        this.error = '算价失败：' + ((e.response && e.response.data && e.response.data.error) || e.message)
      } finally {
        this.loading = false
      }
    },
    async clearSession() {
      if (!confirm('清除已保存的千岛会话？之后需要重新抓一次。')) return
      try {
        await axios.post('/api/prices?action=clear-session', {})
        this.session = { present: false }
        this.sessionDetected = null
        this.testResult = null
        this.notice = '会话已清除'
      } catch (e) {
        this.error = '清除失败：' + e.message
      }
    },
    payloadBase() {
      return {
        provider: this.form.provider,
        minSamples: this.form.minSamples,
        outlierMad: this.form.outlierMad,
        elite1Ratio: this.form.elite1Ratio,
      }
    },
    parsedSamples() {
      const text = this.importText.trim()
      if (!text) return null
      if (text.startsWith('[') || text.startsWith('{')) {
        const j = JSON.parse(text)
        return Array.isArray(j) ? j : (j.samples || j.data || [])
      }
      // CSV
      const lines = text.split(/\r?\n/).filter(Boolean)
      const out = []
      for (const line of lines) {
        const parts = line.split(',').map(s => s.trim())
        if (parts.length < 3) continue
        if (/name/i.test(parts[0]) && /price/i.test(parts[2])) continue
        out.push({ name: parts[0], elite: parts[1], price: Number(parts[2]) })
      }
      return out
    },
    async saveConfig(quiet) {
      this.saving = true
      this.error = ''
      if (!quiet) this.notice = ''
      try {
        const headers = this.form.headersText.trim() ? JSON.parse(this.form.headersText) : {}
        const { data } = await axios.post('/api/prices?action=save-config', {
          prices: {
            enabled: true,
            provider: this.form.provider,
            minSamples: this.form.minSamples,
            outlierMad: this.form.outlierMad,
            elite1Ratio: this.form.elite1Ratio,
            requirePassKeyword: this.form.requirePassKeyword,
            qiandao: {
              endpoint: this.form.endpoint,
              method: this.form.method,
              mode: this.form.mode,
              priceField: this.form.priceField,
              seriesFilter: this.form.seriesFilter,
              headers,
              body: this.form.body,
              mapping: {
                items: this.form.mappingItems,
                name: this.form.mappingName,
                price: this.form.mappingPrice,
                elite: this.form.mappingElite,
              },
            },
          },
        })
        if (!data || !data.success) throw new Error((data && data.error) || '保存失败')
        this.notice = '数据源配置已保存'
      } catch (e) {
        this.error = '保存失败：' + ((e.response && e.response.data && e.response.data.error) || e.message || e)
      } finally {
        this.saving = false
      }
    },
    async preview() {
      this.loading = true
      this.error = ''
      this.notice = ''
      this.hint = ''
      this.diffs = []
      this.summary = null
      this.previewFromCrawl = false
      try {
        const body = this.payloadBase()
        if (this.form.provider === 'import') {
          const samples = this.parsedSamples()
          if (!samples || !samples.length) throw new Error('没有解析到样本，检查一下粘贴的格式')
          body.samples = samples
        }
        const { data } = await axios.post('/api/prices?action=preview', body)
        if (!data) throw new Error('无返回')
        if (!data.success) {
          this.error = data.error || '采集失败'
          this.hint = data.hint || ''
          return
        }
        this.summary = data
        this.diffs = data.list || []
        this.notice = this.diffs.length ? '预览完成，确认后点「应用」提 PR' : '价格没有变化'
      } catch (e) {
        this.error = '采集失败：' + ((e.response && e.response.data && e.response.data.error) || e.message)
      } finally {
        this.loading = false
      }
    },
    async apply() {
      if (!this.diffs.length) return
      const fromCrawl = this.previewFromCrawl
      if (!confirm('将把 ' + this.diffs.length + ' 处市价改动写回 Box_Id.json 并创建 PR，继续？')) return
      this.loading = true
      this.error = ''
      this.prUrl = ''
      try {
        const body = this.payloadBase()
        if (!fromCrawl && this.form.provider === 'import') {
          const samples = this.parsedSamples()
          if (samples && samples.length) body.samples = samples
        }
        const { data } = await axios.post('/api/prices?action=' + (fromCrawl ? 'crawl-apply' : 'apply'), body)
        if (!data || !data.success) throw new Error((data && data.error) || '应用失败')
        this.prUrl = data.prUrl || ''
        this.notice = data.changed === false ? '价格没有变化，未创建 PR' : '已创建 PR'
        this.previewFromCrawl = false
        await this.load()
      } catch (e) {
        this.error = '应用失败：' + ((e.response && e.response.data && e.response.data.error) || e.message)
      } finally {
        this.loading = false
      }
    },
    deltaText(d) {
      if (d.from == null) return '新增'
      const diff = d.to - d.from
      if (!diff) return '持平'
      const pct = d.from ? Math.round((diff / d.from) * 1000) / 10 : 0
      return (diff > 0 ? '+' : '') + diff + '（' + (diff > 0 ? '+' : '') + pct + '%）'
    },
    deltaClass(d) {
      if (d.from == null) return 'pr-new'
      if (d.to > d.from) return 'pr-up'
      if (d.to < d.from) return 'pr-down'
      return ''
    },
  },
}
</script>

<style scoped>
.price-page { max-width: 1180px; }
/* 这几个类在 AdminConfig 里是 scoped 的，这里要自己定义一份，
   否则 form-row 不会成栅格（表现为每个字段独占一整行） */
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
.panel-title { margin: 0 0 12px; font-weight: 700; }
.form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.form-group { margin-bottom: 8px; }
.form-hint { display: block; margin-top: 6px; font-size: 12px; color: #6b7280; }
.pr-empty { padding: 40px; text-align: center; color: #6b7280; }
.pr-wrap { display: flex; flex-direction: column; gap: 16px; }
.pr-sub { margin-top: 4px; padding-top: 12px; border-top: 1px dashed #e5e7eb; }
.pr-narrow { max-width: 130px; }
.pr-json { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.pr-bar { display: flex; gap: 10px; align-items: center; margin-top: 14px; flex-wrap: wrap; }
.pr-link { font-size: 13px; color: #2563eb; text-decoration: underline; }
.pr-alert { margin-top: 12px; padding: 9px 12px; border-radius: 8px; font-size: 13px; }
.pr-alert.err { background: #fef2f2; color: #b91c1c; }
.pr-alert.ok { background: #ecfdf5; color: #047857; }
.pr-alert.info { background: #eff6ff; color: #1d4ed8; }
.pr-stats { display: flex; gap: 24px; flex-wrap: wrap; }
.pr-stats > div { display: flex; flex-direction: column; gap: 4px; }
.pr-stats span { font-size: 12px; color: #6b7280; }
.pr-stats b { font-size: 16px; }
.pr-table-box { overflow: auto; max-height: 460px; border: 1px solid #f1f2f4; border-radius: 8px; }
.pr-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pr-table th, .pr-table td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; text-align: left; }
.pr-table th { position: sticky; top: 0; background: #fafbfc; font-weight: 600; }
.pr-up { color: #b91c1c; }
.pr-down { color: #047857; }
.pr-new { color: #2563eb; }
.pr-filter { width: 220px; height: 32px; font-size: 13px; }

/* 千岛接入 */
.qd-steps { margin: 0 0 14px; padding-left: 20px; font-size: 13px; line-height: 1.9; color: #374151; }
.qd-steps li { margin-bottom: 2px; }
.qd-steps code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.qd-status { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 9px 12px;
  border-radius: 8px; font-size: 13px; background: #f9fafb; color: #4b5563; }
.qd-status.ok { background: #ecfdf5; color: #047857; }
.qd-status.exp { background: #fffbeb; color: #b45309; }
.qd-status.none { background: #f9fafb; color: #6b7280; }
.qd-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: 0 0 8px; }
.qd-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #374151; cursor: pointer; }
.qd-detected { margin-top: 12px; padding: 10px 12px; border-radius: 8px; background: #f8fafc;
  border: 1px solid #eef1f5; font-size: 13px; color: #374151; }
.qd-preview { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; }
.qd-preview > div { display: flex; gap: 8px; align-items: baseline; }
.qd-price { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #b45309; min-width: 60px; }
.qd-title { color: #6b7280; font-size: 12px; }

/* 自动抓取 */
.qd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
.qd-kv { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border-radius: 8px; background: #f8fafc; border: 1px solid #eef1f5; }
.qd-kv span { font-size: 11px; color: #6b7280; }
.qd-kv b { font-size: 14px; color: #111827; }
.qd-phase.ok { color: #047857; }
.qd-phase.warn { color: #b45309; }
.qd-phase.err { color: #b91c1c; }
</style>
