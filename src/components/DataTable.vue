<template>
  <div class="section kc-page">
    <div class="section-header">
      <span class="section-eyebrow">DATA</span>
      <h1 class="section-title">数据表</h1>
      <p class="section-description">
        操作逻辑对齐知晓云控制台：左边选表，右边改行，改完一次性提交成一个 PR。
        不再需要去知晓云逐条点，也不用改完再来这里手动同步。
      </p>
    </div>

    <div v-if="!authReady" class="kc-empty">正在校验权限…</div>
    <div v-else-if="!isOwner" class="kc-empty">只有仓库所有者可以使用数据表编辑。</div>

    <div v-else class="kc-wrap">
      <!-- 左：表列表 -->
      <aside class="kc-side">
        <div class="kc-side-head">
          <input class="form-input kc-search" v-model="tableFilter" placeholder="搜索表名" />
        </div>
        <ul class="kc-tables">
          <li
            v-for="t in filteredTables"
            :key="t"
            :class="['kc-table-item', { active: t === table }]"
            @click="selectTable(t)"
          >
            <span class="kc-table-name">{{ t }}</span>
            <span class="kc-table-count">{{ counts[t] != null ? counts[t] : '-' }}</span>
          </li>
        </ul>
        <div class="kc-side-foot">
          <button class="btn btn-secondary kc-mini" @click="loadAll" :disabled="loading">
            {{ loading ? '读取中…' : '重新读取' }}
          </button>
          <button class="btn btn-secondary kc-mini" @click="compareLive" :disabled="comparing">
            {{ comparing ? '对比中…' : '对比线上' }}
          </button>
        </div>
        <div v-if="liveDiff.length" class="kc-diff">
          <div class="kc-diff-title">线上 vs 仓库</div>
          <div v-for="d in liveDiff" :key="d.table" class="kc-diff-row">
            <span>{{ d.table }}</span>
            <span :class="['kc-diff-tag', d.status]">
              {{ d.status === 'same' ? '一致' : d.status === 'differs' ? '不同' : '失败' }}
            </span>
          </div>
          <button class="btn btn-secondary kc-mini kc-full" @click="pullLiveIntoPending">以线上覆盖本地（待提交）</button>
        </div>
      </aside>

      <!-- 右：表内容 -->
      <section class="kc-main">
        <div class="kc-toolbar">
          <div class="kc-title-row">
            <strong class="kc-title">{{ table || '选择一张表' }}</strong>
            <span v-if="table" class="kc-meta">{{ rows.length }} 行 / {{ columns.length }} 列</span>
            <span v-if="pending.length" class="kc-pending">{{ pending.length }} 处待提交</span>
          </div>
          <div class="kc-actions">
            <input class="form-input kc-filter" v-model="keyword" placeholder="搜索任意字段" />
            <select class="form-input kc-page-size" v-model.number="pageSize">
              <option :value="20">20 条/页</option>
              <option :value="50">50 条/页</option>
              <option :value="100">100 条/页</option>
            </select>
            <div class="kc-colbox">
              <button class="btn btn-secondary kc-mini" @click="colOpen = !colOpen">列显示</button>
              <div v-if="colOpen" class="kc-colmenu">
                <label v-for="c in columns" :key="c" class="kc-collabel">
                  <input type="checkbox" :checked="!hiddenCols.includes(c)" @change="toggleCol(c)" />
                  {{ c }}
                </label>
              </div>
            </div>
            <button class="btn btn-primary kc-mini" @click="openCreate" :disabled="!table">添加行</button>
            <button class="btn btn-danger kc-mini" @click="deleteSelected" :disabled="!selected.length">删除选中</button>
            <button class="btn btn-success kc-mini" @click="commit" :disabled="!pending.length || saving">
              {{ saving ? '提交中…' : '提交 ' + pending.length + ' 处改动' }}
            </button>
          </div>
        </div>

        <div v-if="error" class="kc-alert err">{{ error }}</div>
        <div v-if="notice" class="kc-alert ok">
          {{ notice }}
          <a v-if="prUrl" :href="prUrl" target="_blank" rel="noopener">打开 PR</a>
        </div>

        <div class="kc-table-box" v-if="table">
          <table class="kc-table">
            <thead>
              <tr>
                <th class="kc-c-check">
                  <input type="checkbox" :checked="allChecked" @change="toggleAll" />
                </th>
                <th v-for="c in visibleColumns" :key="c" class="kc-c">{{ c }}</th>
                <th class="kc-c kc-c-op">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in pageRows" :key="rowKey(row, idx)">
                <td class="kc-c-check">
                  <input type="checkbox" :checked="selected.includes(rowKey(row, idx))" @change="toggleRow(rowKey(row, idx))" />
                </td>
                <td v-for="c in visibleColumns" :key="c" class="kc-c" :title="cellText(row[c])">{{ cellText(row[c]) }}</td>
                <td class="kc-c kc-c-op">
                  <button class="kc-link" @click="openEdit(row)">编辑</button>
                  <button class="kc-link danger" @click="removeRow(row)">删除</button>
                </td>
              </tr>
              <tr v-if="!pageRows.length">
                <td :colspan="visibleColumns.length + 2" class="kc-norows">没有数据</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="kc-pager" v-if="table && pageCount > 1">
          <button class="btn btn-secondary kc-mini" :disabled="page === 1" @click="page = 1">首页</button>
          <button class="btn btn-secondary kc-mini" :disabled="page === 1" @click="page--">上一页</button>
          <span class="kc-pageno">{{ page }} / {{ pageCount }}</span>
          <button class="btn btn-secondary kc-mini" :disabled="page === pageCount" @click="page++">下一页</button>
          <button class="btn btn-secondary kc-mini" :disabled="page === pageCount" @click="page = pageCount">末页</button>
        </div>
      </section>
    </div>

    <!-- 行编辑抽屉 -->
    <div v-if="drawer.open" class="kc-drawer-mask" @click.self="drawer.open = false">
      <div class="kc-drawer">
        <div class="kc-drawer-head">
          <strong>{{ drawer.isNew ? '新增行' : '编辑行' }}</strong>
          <button class="kc-close" @click="drawer.open = false">×</button>
        </div>
        <div class="kc-drawer-body">
          <div v-for="f in drawerFields" :key="f.key" class="kc-field">
            <label class="form-label">{{ f.key }}</label>
            <textarea
              v-if="f.isJson"
              class="form-input kc-json"
              rows="3"
              v-model="drawer.model[f.key]"
              :placeholder="f.placeholder"
            ></textarea>
            <input v-else class="form-input" v-model="drawer.model[f.key]" :placeholder="f.placeholder" />
            <span v-if="f.error" class="kc-field-err">{{ f.error }}</span>
          </div>
          <div class="kc-field" v-if="drawer.extraKey !== null">
            <label class="form-label">新增字段</label>
            <div style="display:flex;gap:8px;">
              <input class="form-input" v-model="drawer.newKey" placeholder="字段名" />
              <input class="form-input" v-model="drawer.newVal" placeholder="值（对象/数组用 JSON）" />
            </div>
          </div>
        </div>
        <div class="kc-drawer-foot">
          <button class="btn btn-secondary" @click="addField">加字段</button>
          <button class="btn btn-primary" @click="applyDrawer">加入待提交</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)) }

export default {
  name: 'DataTable',
  data() {
    return {
      authReady: false,
      isOwner: false,
      loading: false,
      comparing: false,
      saving: false,
      error: '',
      notice: '',
      prUrl: '',
      tables: [],
      counts: {},
      table: '',
      tableFilter: '',
      keyword: '',
      page: 1,
      pageSize: 20,
      rows: [],
      liveRows: [],
      liveDiff: [],
      selected: [],
      hiddenCols: [],
      colOpen: false,
      // 待提交操作：{op, id, fields} / {op:'insert', row}
      pending: [],
      drawer: { open: false, isNew: false, model: {}, original: null, extraKey: null, newKey: '', newVal: '' },
    }
  },
  computed: {
    filteredTables() {
      const k = this.tableFilter.trim().toLowerCase()
      return this.tables.filter(t => !k || t.toLowerCase().includes(k))
    },
    columns() {
      const seen = []
      const push = (k) => { if (!seen.includes(k)) seen.push(k) }
      for (const r of this.rows) {
        if (r && typeof r === 'object') for (const k of Object.keys(r)) push(k)
      }
      // _id 永远第一，id 紧随其后，其余按出现顺序
      const order = (k) => (k === '_id' ? -2 : k === 'id' ? -1 : 0)
      return seen.sort((a, b) => order(a) - order(b) || (a === '_id' ? -1 : b === '_id' ? 1 : 0))
    },
    visibleColumns() {
      return this.columns.filter(c => !this.hiddenCols.includes(c))
    },
    filteredRows() {
      const k = this.keyword.trim().toLowerCase()
      if (!k) return this.rows
      return this.rows.filter(r => JSON.stringify(r).toLowerCase().includes(k))
    },
    pageCount() {
      return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize))
    },
    pageRows() {
      const s = (this.page - 1) * this.pageSize
      return this.filteredRows.slice(s, s + this.pageSize)
    },
    allChecked() {
      return this.pageRows.length > 0 && this.pageRows.every((r, i) => this.selected.includes(this.rowKey(r, i)))
    },
    drawerFields() {
      const m = this.drawer.model || {}
      const out = []
      for (const k of Object.keys(m)) {
        const v = m[k]
        const isJson = v && typeof v === 'object'
        out.push({ key: k, isJson, value: v, placeholder: isJson ? 'JSON' : '' })
      }
      return out
    },
  },
  watch: {
    keyword() { this.page = 1 },
    pageSize() { this.page = 1 },
    table() { this.page = 1 },
  },
  async mounted() {
    const tok = localStorage.getItem('gh_token') || ''
    try {
      const { data } = await axios.get('/api/auth/status')
      this.isOwner = !!(data && data.authenticated && data.isOwner)
    } catch (e) { this.isOwner = false }
    this.authReady = true
    if (this.isOwner) await this.loadAll()
  },
  methods: {
    cellText(v) {
      if (v == null) return ''
      if (typeof v === 'object') {
        const s = JSON.stringify(v)
        return s.length > 80 ? s.slice(0, 80) + '…' : s
      }
      return String(v)
    },
    rowKey(row, idx) {
      return row && (row._id || row.id) ? String(row._id || row.id) : 'idx:' + idx
    },
    toggleCol(c) {
      const i = this.hiddenCols.indexOf(c)
      if (i >= 0) this.hiddenCols.splice(i, 1)
      else this.hiddenCols.push(c)
    },
    toggleRow(k) {
      const i = this.selected.indexOf(k)
      if (i >= 0) this.selected.splice(i, 1)
      else this.selected.push(k)
    },
    toggleAll() {
      if (this.allChecked) {
        const keys = this.pageRows.map((r, i) => this.rowKey(r, i))
        this.selected = this.selected.filter(k => !keys.includes(k))
      } else {
        for (let i = 0; i < this.pageRows.length; i++) {
          const k = this.rowKey(this.pageRows[i], i)
          if (!this.selected.includes(k)) this.selected.push(k)
        }
      }
    },
    async loadAll() {
      this.loading = true
      this.error = ''
      try {
        const { data } = await axios.get('/api/admin/tables')
        if (!data || !data.success) throw new Error((data && data.error) || '读取失败')
        this.tables = data.tables || []
        const all = data.data || {}
        const counts = {}
        for (const k of Object.keys(all)) counts[k] = Array.isArray(all[k]) ? all[k].length : 0
        this.counts = counts
        if (!this.table && this.tables.length) this.table = this.tables[0]
        this.rows = clone(all[this.table] || [])
        this.pending = []
        this.selected = []
      } catch (e) {
        this.error = '读取数据失败：' + (e.response && e.response.data && e.response.data.error || e.message)
      } finally {
        this.loading = false
      }
    },
    async selectTable(t) {
      if (this.pending.length && !confirm('当前表还有未提交改动，切换后会丢失，继续？')) return
      this.table = t
      this.loading = true
      this.error = ''
      this.notice = ''
      this.prUrl = ''
      try {
        const { data } = await axios.get('/api/admin/tables')
        const all = (data && data.data) || {}
        this.rows = clone(all[t] || [])
        const counts = {}
        for (const k of Object.keys(all)) counts[k] = Array.isArray(all[k]) ? all[k].length : 0
        this.counts = counts
        this.pending = []
        this.selected = []
        this.liveDiff = []
      } catch (e) {
        this.error = e.message
      } finally {
        this.loading = false
      }
    },
    async compareLive() {
      this.comparing = true
      this.error = ''
      try {
        const { data } = await axios.get('/api/admin/tables?live=1')
        if (!data || !data.success) throw new Error((data && data.error) || '对比失败')
        this.liveDiff = data.diff || []
        this.liveRows = (data.live && data.live[this.table]) || []
      } catch (e) {
        this.error = '对比线上失败：' + (e.message || e)
      } finally {
        this.comparing = false
      }
    },
    pullLiveIntoPending() {
      if (!this.liveRows.length) { this.error = '还没有线上数据，先点「对比线上」'; return }
      const ids = this.liveRows.map(r => String(r._id || r.id || ''))
      this.pending = [
        ...this.pending.filter(p => p.op !== 'replace-table'),
        { op: 'replace-table', rows: clone(this.liveRows) },
      ]
      this.rows = clone(this.liveRows)
      this.notice = '已用线上数据覆盖当前表（尚未提交，点「提交」才会真正写回）'
      if (!ids.length) this.notice += '（线上行缺少 id，提交时会自动生成）'
    },
    openCreate() {
      const model = {}
      for (const c of this.columns) if (c !== '_id' && c !== 'id') model[c] = ''
      this.drawer = { open: true, isNew: true, model, original: null, extraKey: 0, newKey: '', newVal: '' }
    },
    openEdit(row) {
      const model = {}
      for (const k of Object.keys(row)) model[k] = typeof row[k] === 'object' && row[k] !== null ? JSON.stringify(row[k], null, 2) : row[k]
      this.drawer = { open: true, isNew: false, model, original: clone(row), extraKey: 0, newKey: '', newVal: '' }
    },
    addField() {
      const k = this.drawer.newKey.trim()
      if (!k) return
      this.drawer.model[k] = this.drawer.newVal
      this.drawer.newKey = ''
      this.drawer.newVal = ''
    },
    applyDrawer() {
      const d = this.drawer
      const fields = {}
      for (const k of Object.keys(d.model)) {
        const v = d.model[k]
        if (typeof v === 'string' && v.trim().startsWith('{') || typeof v === 'string' && v.trim().startsWith('[')) {
          try { fields[k] = JSON.parse(v) } catch (e) { this.error = '字段 ' + k + ' 不是合法 JSON'; return }
        } else {
          fields[k] = v
        }
      }
      if (d.isNew) {
        this.pending.push({ op: 'insert', row: fields })
        this.rows.push(Object.assign({ _id: 'tmp:' + Date.now() }, fields))
      } else {
        const id = d.original._id || d.original.id
        const changed = {}
        for (const k of Object.keys(fields)) {
          if (JSON.stringify(fields[k]) !== JSON.stringify(d.original[k])) changed[k] = fields[k]
        }
        if (!Object.keys(changed).length) { d.open = false; return }
        this.pending.push({ op: 'update', id: String(id), fields: changed })
        const row = this.rows.find(r => String(r._id || r.id) === String(id))
        if (row) Object.assign(row, changed)
      }
      this.error = ''
      d.open = false
    },
    removeRow(row) {
      const id = row._id || row.id
      if (!id || String(id).startsWith('tmp:')) {
        this.rows = this.rows.filter(r => r !== row)
        this.pending = this.pending.filter(p => !(p.op === 'insert' && p.row && JSON.stringify(p.row) === JSON.stringify(row)))
        return
      }
      if (!confirm('删除这一行？提交后才会真正写回仓库。')) return
      this.pending.push({ op: 'delete', id: String(id) })
      this.rows = this.rows.filter(r => String(r._id || r.id) !== String(id))
    },
    deleteSelected() {
      const list = this.rows.filter((r, i) => this.selected.includes(this.rowKey(r, i)))
      if (!list.length) return
      if (!confirm('删除选中的 ' + list.length + ' 行？')) return
      for (const r of list) {
        const id = r._id || r.id
        if (id) this.pending.push({ op: 'delete', id: String(id) })
      }
      const ids = list.map(r => String(r._id || r.id))
      this.rows = this.rows.filter(r => !ids.includes(String(r._id || r.id)))
      this.selected = []
    },
    async commit() {
      this.saving = true
      this.error = ''
      this.notice = ''
      try {
        const replace = this.pending.find(p => p.op === 'replace-table')
        let body
        if (replace) {
          body = { table: this.table, rows: replace.rows }
        } else {
          body = { table: this.table, ops: this.pending.filter(p => p.op !== 'replace-table') }
        }
        const { data } = await axios.post('/api/admin/tables', body)
        if (!data || !data.success) throw new Error((data && data.error) || '提交失败')
        this.prUrl = data.prUrl || ''
        this.notice = data.changed === false ? '数据和仓库一致，没有产生提交' : '已创建 PR，等仓库合并后线上才会更新'
        this.pending = []
        await this.loadAll()
      } catch (e) {
        const msg = (e.response && e.response.data && e.response.data.error) || e.message
        this.error = '提交失败：' + msg
      } finally {
        this.saving = false
      }
    },
  },
}
</script>

<style scoped>
.kc-page { max-width: 1280px; }
.kc-empty { padding: 40px; text-align: center; color: #6b7280; }
.kc-wrap { display: flex; gap: 16px; align-items: flex-start; }
.kc-side {
  width: 232px; flex: 0 0 232px; background: #fff; border: 1px solid #e5e7eb;
  border-radius: 12px; padding: 12px; position: sticky; top: 88px;
}
.kc-side-head { margin-bottom: 8px; }
.kc-search { height: 32px; font-size: 13px; }
.kc-tables { list-style: none; margin: 0; padding: 0; max-height: 46vh; overflow: auto; }
.kc-table-item {
  display: flex; justify-content: space-between; align-items: center; gap: 6px;
  padding: 7px 8px; border-radius: 8px; cursor: pointer; font-size: 13px;
}
.kc-table-item:hover { background: #f3f4f6; }
.kc-table-item.active { background: #eef2ff; color: #3730a3; font-weight: 600; }
.kc-table-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kc-table-count { font-size: 11px; color: #6b7280; flex: 0 0 auto; }
.kc-side-foot { display: flex; gap: 6px; margin-top: 10px; }
.kc-full { width: 100%; margin-top: 8px; }
.kc-diff { margin-top: 12px; border-top: 1px dashed #e5e7eb; padding-top: 10px; }
.kc-diff-title { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
.kc-diff-row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
.kc-diff-tag { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: #f3f4f6; }
.kc-diff-tag.same { background: #ecfdf5; color: #047857; }
.kc-diff-tag.differs { background: #fef3c7; color: #b45309; }
.kc-diff-tag.failed { background: #fee2e2; color: #b91c1c; }
.kc-main { flex: 1 1 auto; min-width: 0; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; }
.kc-toolbar { padding: 12px; border-bottom: 1px solid #f1f2f4; }
.kc-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.kc-title { font-size: 15px; }
.kc-meta { font-size: 12px; color: #6b7280; }
.kc-pending { font-size: 12px; color: #b45309; background: #fef3c7; padding: 2px 8px; border-radius: 999px; }
.kc-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.kc-filter { width: 200px; height: 32px; font-size: 13px; }
.kc-page-size { width: 108px; height: 32px; font-size: 13px; padding: 0 6px; }
.kc-colbox { position: relative; }
.kc-colmenu {
  position: absolute; z-index: 20; right: 0; top: 36px; width: 190px; max-height: 300px; overflow: auto;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px;
  box-shadow: 0 12px 28px -12px rgba(0,0,0,.25);
}
.kc-collabel { display: flex; gap: 6px; align-items: center; font-size: 12px; padding: 3px 2px; }
.kc-mini { height: 32px; padding: 0 12px; font-size: 13px; }
.kc-alert { margin: 10px 12px; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.kc-alert.err { background: #fef2f2; color: #b91c1c; }
.kc-alert.ok { background: #ecfdf5; color: #047857; }
.kc-alert a { margin-left: 8px; text-decoration: underline; }
.kc-table-box { overflow: auto; max-height: 62vh; }
.kc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.kc-table th, .kc-table td { border-bottom: 1px solid #f1f2f4; padding: 7px 8px; text-align: left; vertical-align: top; }
.kc-table th { position: sticky; top: 0; background: #fafbfc; font-weight: 600; color: #374151; z-index: 2; white-space: nowrap; }
.kc-table td.kc-c { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kc-c-check { width: 34px; }
/* 操作列钉在右侧：表宽超出时也能点到编辑/删除 */
.kc-c-op { width: 122px; min-width: 122px; white-space: nowrap; position: sticky; right: 0; background: #fff; }
.kc-table th.kc-c-op { background: #fafbfc; z-index: 3; }
.kc-table tbody tr:hover td { background: #fafbfc; }
.kc-link { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 12px; padding: 0 4px; }
.kc-link.danger { color: #dc2626; }
.kc-norows { text-align: center; color: #9ca3af; padding: 28px 0; }
.kc-pager { display: flex; gap: 8px; align-items: center; justify-content: center; padding: 10px; }
.kc-pageno { font-size: 12px; color: #6b7280; }
.kc-drawer-mask { position: fixed; inset: 0; background: rgba(15,23,42,.35); z-index: 60; display: flex; justify-content: flex-end; }
.kc-drawer { width: min(520px, 94vw); height: 100%; background: #fff; display: flex; flex-direction: column; }
.kc-drawer-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid #eef0f2; }
.kc-close { background: none; border: none; font-size: 22px; line-height: 1; cursor: pointer; color: #6b7280; }
.kc-drawer-body { flex: 1; overflow: auto; padding: 14px 16px; }
.kc-field { margin-bottom: 12px; }
.kc-field-err { color: #dc2626; font-size: 12px; }
.kc-json { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.kc-drawer-foot { padding: 12px 16px; border-top: 1px solid #eef0f2; display: flex; gap: 8px; justify-content: space-between; }
</style>
