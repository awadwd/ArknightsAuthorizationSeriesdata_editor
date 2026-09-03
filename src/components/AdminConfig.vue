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
    }
  },
  async mounted() {
    // 检查 owner 权限（用 axios，自动继承 App.vue 中的 Authorization 拦截器）
    const tok = localStorage.getItem('gh_token') || ''
    try {
      const { data: j } = await axios.get('/api/auth/status')
      this.isOwnerAuth = !!(j && j.isAuthenticated && j.isOwner)
      this.debugInfo = 'token=' + tok.slice(0, 8) + '... len=' + tok.length + ' | status=' + JSON.stringify(j)
    } catch (e) {
      this.debugInfo = 'token=' + tok.slice(0, 8) + '... len=' + tok.length + ' | ERROR=' + (e && e.message)
    }
    this.authReady = true
    if (this.isOwnerAuth) await this.load()
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
      // 兜底：保证所有字段存在
      return {
        repoConfigs: {
          github: { owner: '', repo: '', branch: 'dev', ...(raw.repoConfigs && raw.repoConfigs.github || {}) },
          gitcode: { owner: '', repo: '', branch: 'dev', ...(raw.repoConfigs && raw.repoConfigs.gitcode || {}) },
        },
        editorFiles: Array.isArray(raw.editorFiles) ? raw.editorFiles.slice() : [],
        oauth: { gitcodeClientId: '', ...(raw.oauth || {}) },
        pr: { defaultBaseBranch: 'dev', ...(raw.pr || {}) },
        feedback: { storagePath: 'feedback.json', branch: 'master', ...(raw.feedback || {}) },
      }
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
</style>