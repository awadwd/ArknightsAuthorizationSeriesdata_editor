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
      <div class="panel">
        <h3 class="panel-title">数据源</h3>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">来源</label>
            <select class="form-input" v-model="form.provider">
              <option value="qiandao">千岛行情（需填接口）</option>
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
          <div><span>样本</span><b>{{ summary.samples }}</b></div>
          <div><span>命中干员</span><b>{{ summary.matchedCharacters }}</b></div>
          <div><span>待改动</span><b>{{ summary.diffs }}</b></div>
          <div><span>目标仓库</span><b>{{ summary.target.kind }} · {{ summary.target.base }}</b></div>
        </div>
        <div v-if="summary.errors && summary.errors.length" class="pr-alert info">
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
      form: {
        provider: 'manual',
        minSamples: 3,
        outlierMad: 3,
        elite1Ratio: 0.72,
        endpoint: '',
        method: 'POST',
        mode: 'feed',
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
        const p = data.prices || {}
        this.form.provider = p.provider || 'manual'
        this.form.minSamples = p.minSamples || 3
        this.form.outlierMad = p.outlierMad || 3
        this.form.elite1Ratio = p.elite1Ratio || 0.72
        this.form.endpoint = p.endpoint || ''
        this.form.method = p.method || 'POST'
        this.form.mode = p.mode || 'feed'
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
    async saveConfig() {
      this.saving = true
      this.error = ''
      this.notice = ''
      try {
        const headers = this.form.headersText.trim() ? JSON.parse(this.form.headersText) : {}
        const { data } = await axios.post('/api/prices?action=save-config', {
          prices: {
            enabled: true,
            provider: this.form.provider,
            minSamples: this.form.minSamples,
            outlierMad: this.form.outlierMad,
            elite1Ratio: this.form.elite1Ratio,
            qiandao: {
              endpoint: this.form.endpoint,
              method: this.form.method,
              mode: this.form.mode,
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
        this.error = '保存失败：' + (e.message || e)
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
      if (!confirm('将把 ' + this.diffs.length + ' 处市价改动写回 Box_Id.json 并创建 PR，继续？')) return
      this.loading = true
      this.error = ''
      this.prUrl = ''
      try {
        const body = this.payloadBase()
        if (this.form.provider === 'import') {
          const samples = this.parsedSamples()
          if (samples && samples.length) body.samples = samples
        }
        const { data } = await axios.post('/api/prices?action=apply', body)
        if (!data || !data.success) throw new Error((data && data.error) || '应用失败')
        this.prUrl = data.prUrl || ''
        this.notice = data.changed === false ? '价格没有变化，未创建 PR' : '已创建 PR'
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
</style>
