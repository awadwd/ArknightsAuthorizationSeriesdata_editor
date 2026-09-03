<template>
  <div class="admin-config-container">
    <div v-if="debugInfo" style="background:#222;color:#0f0;font-family:monospace;padding:8px 12px;border-radius:4px;font-size:12px;margin-bottom:12px;word-break:break-all;">
      [DEBUG] {{ debugInfo }}
    </div>
    <div class="section-header">
      <span class="section-eyebrow">管理员</span>
      <h1 class="section-title">配置管理</h1>
      <p class="section-description">
        修改服务端配置（仓库源、可编辑文件、PR 默认分支、反馈存储等）。仅仓库所有者可操作，保存后立即生效。
      </p>
    </div>

    <!-- 权限检查中 -->
    <div v-if="!authReady" class="alert alert-info">正在检查权限...</div>

    <!-- 非 owner -->
    <div v-else-if="!isOwnerAuth" class="alert alert-warning">
      <strong>无权限</strong>：当前登录用户不是仓库所有者，无法修改。如需权限，请用 GitHub 登录用户
      <code>awadwd</code> 或 GitCode 用户 <code>huangjinzhou1</code>。
    </div>

    <template v-else>
      <div v-if="loading" class="alert alert-info">加载配置中...</div>
      <div v-if="loadError" class="alert alert-danger">{{ loadError }}</div>

      <template v-if="config">
        <!-- GitHub Repo -->
        <div class="panel">
          <h3 class="panel-title">GitHub 仓库（镜像）</h3>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Owner</label>
              <input class="form-input" v-model="config.repoConfigs.github.owner" />
            </div>
            <div class="form-group">
              <label class="form-label">Repo</label>
              <input class="form-input" v-model="config.repoConfigs.github.repo" />
            </div>
            <div class="form-group">
              <label class="form-label">默认分支</label>
              <input class="form-input" v-model="config.repoConfigs.github.branch" />
            </div>
          </div>
        </div>

        <!-- GitCode Repo -->
        <div class="panel">
          <h3 class="panel-title">GitCode 仓库（主仓库）</h3>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Owner</label>
              <input class="form-input" v-model="config.repoConfigs.gitcode.owner" />
            </div>
            <div class="form-group">
              <label class="form-label">Repo</label>
              <input class="form-input" v-model="config.repoConfigs.gitcode.repo" />
            </div>
            <div class="form-group">
              <label class="form-label">默认分支</label>
              <input class="form-input" v-model="config.repoConfigs.gitcode.branch" />
            </div>
          </div>
        </div>

        <!-- Editor Files -->
        <div class="panel">
          <h3 class="panel-title">可编辑文件列表</h3>
          <div class="form-group">
            <label class="form-label">文件路径（每行一个，如 <code>Box_Id.json</code>）</label>
            <textarea
              class="form-input"
              v-model="editorFilesText"
              rows="4"
              style="min-height:100px;font-family:monospace;"
            ></textarea>
            <span class="form-hint">保存时自动按行解析为数组</span>
          </div>
        </div>

        <!-- PR -->
        <div class="panel">
          <h3 class="panel-title">Pull Request 默认设置</h3>
          <div class="form-group">
            <label class="form-label">默认基础分支（PR 目标）</label>
            <input class="form-input" v-model="config.pr.defaultBaseBranch" />
            <span class="form-hint">一般填 <code>dev</code>（dev 是数据源分支，main 已设保护）</span>
          </div>
        </div>

        <!-- OAuth -->
        <div class="panel">
          <h3 class="panel-title">OAuth（GitCode clientId）</h3>
          <div class="form-group">
            <label class="form-label">GitCode OAuth Client ID</label>
            <input class="form-input" v-model="config.oauth.gitcodeClientId" />
            <span class="form-hint">公开值，前端可见。Client Secret 走环境变量，不在此展示。</span>
          </div>
        </div>

        <!-- Feedback -->
        <div class="panel">
          <h3 class="panel-title">反馈存储</h3>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">存储文件路径</label>
              <input class="form-input" v-model="config.feedback.storagePath" />
            </div>
            <div class="form-group">
              <label class="form-label">GitHub 分支</label>
              <input class="form-input" v-model="config.feedback.branch" />
            </div>
          </div>
          <div class="alert alert-info" style="margin-top:12px;">
            <strong>GITHUB_TOKEN</strong> 用于读写反馈仓库，走环境变量配置（不在此编辑）。
          </div>
        </div>

        <!-- 自动同步 -->
        <div class="panel">
          <h3 class="panel-title">自动同步（知晓云 → kc-data）</h3>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">启用自动同步</label>
              <label class="switch">
                <input type="checkbox" v-model="config.autoSync.enabled" />
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group">
              <label class="form-label">Cron 计划（每小时由 GitHub Actions 触发）</label>
              <input class="form-input" v-model="config.autoSync.schedule" />
              <span class="form-hint">默认 <code>0 * * * *</code>（每小时整点）。需仓库配置 <code>ADMIN_TOKEN</code> secret 与 GitHub Actions。</span>
            </div>
          </div>
          <div class="sync-status" v-if="syncStatus">
            <div>最近同步：<strong>{{ formatTime(syncStatus.lastRunAt) }}</strong></div>
            <div v-if="syncStatus.triggeredBy">触发者：{{ syncStatus.triggeredBy }}</div>
            <div v-if="syncStatus.prUrl">PR：<a :href="syncStatus.prUrl" target="_blank" rel="noopener">{{ syncStatus.prUrl }}</a></div>
            <div v-if="syncStatus.pushError" class="text-danger">推送错误：{{ syncStatus.pushError }}</div>
          </div>
          <div class="save-bar" style="margin-top:12px;">
            <button class="btn btn-secondary" @click="manualSync" :disabled="syncing" type="button">
              {{ syncing ? '同步中...' : '立即同步一次' }}
            </button>
            <span v-if="syncMsg" class="badge badge-connected">{{ syncMsg }}</span>
            <span v-if="syncError" class="save-error">{{ syncError }}</span>
          </div>
          <div class="alert alert-info" style="margin-top:12px;">
            自动同步需要：① 仓库 Secrets 配置 <code>ADMIN_TOKEN</code>（你的 GitHub PAT）；② 已启用 <code>.github/workflows/sync-knowcloud.yml</code>。
          </div>
        </div>

        <!-- 数据表编辑 -->
        <div class="panel">
          <h3 class="panel-title">业务数据表（kc-data）</h3>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">选择数据表</label>
              <select class="form-input" v-model="selectedTable" @change="loadTable">
                <option value="">— 请选择 —</option>
                <option v-for="t in tablesList" :key="t" :value="t">{{ t }}（{{ tableCounts[t] || 0 }} 条）</option>
              </select>
            </div>
          </div>
          <div v-if="selectedTable" class="form-group">
            <label class="form-label">表数据（JSON 数组，保存即提 PR）</label>
            <textarea
              class="form-input"
              v-model="tableText"
              rows="12"
              style="min-height:240px;font-family:monospace;font-size:12px;"
            ></textarea>
            <div class="save-bar" style="margin-top:12px;">
              <button class="btn btn-primary" @click="saveTable" :disabled="tableSaving" type="button">
                {{ tableSaving ? '保存中...' : '保存该表' }}
              </button>
              <span v-if="tableMsg" class="badge badge-connected">{{ tableMsg }}</span>
              <span v-if="tableError" class="save-error">{{ tableError }}</span>
            </div>
          </div>
        </div>

        <!-- Save -->
        <div class="save-bar">
          <button class="btn btn-primary btn-lg" @click="save" :disabled="saving" type="button">
            {{ saving ? '保存中...' : '保存配置' }}
          </button>
          <button class="btn btn-secondary" @click="reload" :disabled="saving" type="button">
            重新加载
          </button>
          <span v-if="saveSuccess" class="badge badge-connected">✓ 已保存</span>
          <span v-if="saveError" class="save-error">{{ saveError }}</span>
        </div>
      </template>
    </template>
  </div>
</template>

<script>
import axios from 'axios'
import { getAdminConfig, setAdminConfig } from '../api/config'

export default {
  name: 'AdminConfig',
  data() {
    return {
      authReady: false,
      isOwnerAuth: false,
      debugInfo: '',
      loading: false,
      loadError: '',
      saving: false,
      saveSuccess: false,
      saveError: '',
      config: null,
      editorFilesText: '',
      // 同步
      syncStatus: null,
      syncing: false,
      syncMsg: '',
      syncError: '',
      // 数据表
      tablesList: [],
      tableCounts: {},
      selectedTable: '',
      tableText: '',
      tableSaving: false,
      tableMsg: '',
      tableError: '',
    }
  },
  async mounted() {
    const tok = localStorage.getItem('gh_token') || ''
    try {
      const { data: j } = await axios.get('/api/auth/status')
      this.isOwnerAuth = !!(j && j.authenticated && j.isOwner)
      this.debugInfo = 'token=' + tok.slice(0, 8) + '... len=' + tok.length + ' | status=' + JSON.stringify(j)
    } catch (e) {
      this.debugInfo = 'token=' + tok.slice(0, 8) + '... len=' + tok.length + ' | ERROR=' + (e && e.message)
    }
    this.authReady = true
    if (this.isOwnerAuth) {
      await this.load()
      await this.loadSyncStatus()
      await this.loadTables()
    }
  },
  watch: {
    editorFilesText(v) {
      if (this.config && Array.isArray(this.config.editorFiles)) {
        const lines = v.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        this.config.editorFiles = lines
      }
    },
  },
  methods: {
    normalize(raw) {
      return {
        repoConfigs: {
          github: { owner: '', repo: '', branch: 'dev', ...(raw.repoConfigs && raw.repoConfigs.github || {}) },
          gitcode: { owner: '', repo: '', branch: 'dev', ...(raw.repoConfigs && raw.repoConfigs.gitcode || {}) },
        },
        editorFiles: Array.isArray(raw.editorFiles) ? raw.editorFiles.slice() : [],
        oauth: { gitcodeClientId: '', ...(raw.oauth || {}) },
        pr: { defaultBaseBranch: 'dev', ...(raw.pr || {}) },
        feedback: { storagePath: 'feedback.json', branch: 'master', ...(raw.feedback || {}) },
        autoSync: {
          enabled: false,
          schedule: '0 * * * *',
          source: 'knowcloud',
          tables: ['Version', 'choearth_notice', 'more_notice', 'questionnaire', 'SearchWord_Version', 'Guess_Version', 'AiToolsConfig'],
          lastRunAt: null,
          lastResult: null,
          ...(raw.autoSync || {}),
        },
      }
    },
    formatTime(iso) {
      if (!iso) return '从未'
      try { return new Date(iso).toLocaleString() } catch (e) { return iso }
    },
    async load() {
      this.loading = true
      this.loadError = ''
      this.saveSuccess = false
      this.saveError = ''
      try {
        const data = await getAdminConfig()
        if (data && data.success && data.config) {
          this.config = this.normalize(data.config)
          this.editorFilesText = (this.config.editorFiles || []).join('\n')
        } else {
          this.loadError = '获取配置失败：' + ((data && data.error) || '未知错误')
        }
      } catch (e) {
        this.loadError = '获取配置失败：' + ((e.response && e.response.data && e.response.data.error) || e.message)
      } finally {
        this.loading = false
      }
    },
    async loadSyncStatus() {
      try {
        const { data } = await axios.get('/api/admin/sync-status')
        if (data && data.success) this.syncStatus = data.status
      } catch (e) {}
    },
    async manualSync() {
      this.syncing = true
      this.syncMsg = ''
      this.syncError = ''
      try {
        const { data } = await axios.post('/api/admin/sync')
        if (data && data.success) {
          this.syncMsg = '同步完成'
          this.syncStatus = data.status
          setTimeout(() => { this.syncMsg = '' }, 3000)
        } else {
          this.syncError = (data && data.error) || '同步失败'
        }
      } catch (e) {
        this.syncError = (e.response && e.response.data && e.response.data.error) || e.message
      } finally {
        this.syncing = false
      }
    },
    async loadTables() {
      try {
        const { data } = await axios.get('/api/admin/tables')
        if (data && data.success) {
          this.tablesList = data.tables || []
          this.tableCounts = {}
          const d = data.data || {}
          for (const k of Object.keys(d)) this.tableCounts[k] = Array.isArray(d[k]) ? d[k].length : 0
        }
      } catch (e) {}
    },
    async loadTable() {
      if (!this.selectedTable) { this.tableText = ''; return }
      try {
        const { data } = await axios.get('/api/admin/tables')
        if (data && data.success) {
          const rows = (data.data && data.data[this.selectedTable]) || []
          this.tableText = JSON.stringify(rows, null, 2)
        }
      } catch (e) {
        this.tableError = e.message
      }
    },
    async saveTable() {
      if (!this.selectedTable) return
      this.tableSaving = true
      this.tableMsg = ''
      this.tableError = ''
      let rows
      try {
        rows = JSON.parse(this.tableText)
        if (!Array.isArray(rows)) throw new Error('必须是 JSON 数组')
      } catch (e) {
        this.tableError = 'JSON 解析失败：' + e.message
        this.tableSaving = false
        return
      }
      try {
        const { data } = await axios.post('/api/admin/tables', { table: this.selectedTable, rows })
        if (data && data.success) {
          this.tableMsg = '已提 PR'
          setTimeout(() => { this.tableMsg = '' }, 3000)
        } else {
          this.tableError = (data && data.error) || '保存失败'
        }
      } catch (e) {
        this.tableError = (e.response && e.response.data && e.response.data.error) || e.message
      } finally {
        this.tableSaving = false
      }
    },
    reload() {
      this.saveSuccess = false
      this.saveError = ''
      this.load()
    },
    async save() {
      if (!this.config) return
      this.saving = true
      this.saveSuccess = false
      this.saveError = ''
      try {
        const data = await setAdminConfig(this.config)
        if (data && data.success) {
          this.saveSuccess = true
          setTimeout(() => { this.saveSuccess = false }, 3000)
        } else {
          this.saveError = (data && data.error) || '保存失败'
        }
      } catch (e) {
        this.saveError = (e.response && e.response.data && e.response.data.error) || e.message
      } finally {
        this.saving = false
      }
    },
  },
}
</script>

<style scoped>
.admin-config-container {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}

.panel {
  background: var(--panel, white);
  border: 1px solid var(--border-light, #e0e0e0);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.panel-title {
  margin: 0 0 12px;
  font-weight: 700;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.form-group {
  margin-bottom: 8px;
}

.form-label {
  display: block;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--text-muted, #555);
  font-size: 13px;
}

.form-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted, #888);
}

.alert {
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.alert-info    { background: #f0f9ff; border: 1px solid #b3e0ff; color: #0c4a6e; }
.alert-warning { background: #fef9c3; border: 1px solid #facc15; color: #713f12; }
.alert-danger  { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary   { background: #409eff; color: white; }
.btn-secondary { background: #909399; color: white; }
.btn-lg        { padding: 12px 24px; font-size: 16px; }

.save-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 24px;
}

.sync-status {
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-muted, #555);
  line-height: 1.6;
}

.text-danger { color: #991b1b; }

.badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.badge-connected {
  background: #f0f9eb;
  color: #67c23a;
}

.save-error {
  color: #991b1b;
  font-size: 13px;
}

.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: #ccc;
  border-radius: 24px;
  transition: 0.2s;
}
.slider::before {
  content: "";
  position: absolute;
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: 50%;
  transition: 0.2s;
}
.switch input:checked + .slider { background: #409eff; }
.switch input:checked + .slider::before { transform: translateX(20px); }
</style>
