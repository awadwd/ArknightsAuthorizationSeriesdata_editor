<template>
  <div class="site-shell">
    <!-- Header -->
    <header class="site-header">
      <div class="brand-lockup">
        <div class="brand-logo">
          <img src="/app-logo.png" alt="Logo" style="height:32px;width:auto;" />
        </div>
        <span class="brand-name">{{ t('app.title') }}</span>
      </div>

      <nav class="site-nav" :class="{ 'is-open': navOpen }">
        <a href="#" :class="{ active: view === 'editor' }" @click.prevent="setView('editor')">
          {{ t('nav.editor') }}
        </a>
        <a href="#" :class="{ active: view === 'about' }" @click.prevent="setView('about')">
          {{ t('nav.about') }}
        </a>

        <!-- Language Dropdown -->
        <div class="lang-dropdown" :class="{ 'is-open': langOpen }" style="margin-left: 4px;">
          <button class="lang-dropdown-trigger" @click="langOpen = !langOpen" type="button">
            {{ currentLangLabel }}
            <span class="arrow"></span>
          </button>
          <ul v-if="langOpen" class="lang-dropdown-menu">
            <li
              v-for="opt in localeOptions"
              :key="opt.code"
              :class="{ active: locale === opt.code }"
              @click="switchLang(opt.code)"
            >
              {{ opt.label }}
            </li>
          </ul>
        </div>

        <span v-if="isAuthenticated" class="nav-cta" style="cursor: default; margin-left: 4px;">
          {{ t('app.welcome', { name: username }) }}
        </span>
      </nav>

      <button class="mobile-nav-toggle" @click="navOpen = !navOpen" type="button">
        &#9776;
      </button>
    </header>

    <!-- Main Content -->
    <main class="site-main">
      <!-- About View -->
      <div v-if="view === 'about'" class="section">
        <div class="section-header">
          <span class="section-eyebrow">{{ t('nav.about') }}</span>
          <h1 class="section-title">{{ t('about.title') }}</h1>
          <p class="section-description">{{ t('about.description') }}</p>
        </div>

        <div class="feature-grid">
          <div class="feature-card">
            <div class="feature-icon">&#9998;</div>
            <h3 class="feature-card-title">{{ t('nav.editor') }}</h3>
            <p class="feature-card-text">{{ tmFeatureList()[0] }}</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">&#10003;</div>
            <h3 class="feature-card-title">JSON {{ t('editor.validJson') }}</h3>
            <p class="feature-card-text">{{ tmFeatureList()[1] }}</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">&#128274;</div>
            <h3 class="feature-card-title">GitHub {{ t('auth.title') }}</h3>
            <p class="feature-card-text">{{ tmFeatureList()[2] }}</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">&#128259;</div>
            <h3 class="feature-card-title">Pull Request</h3>
            <p class="feature-card-text">{{ tmFeatureList()[3] }}</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">&#127760;</div>
            <h3 class="feature-card-title">i18n</h3>
            <p class="feature-card-text">{{ tmFeatureList()[4] }}</p>
          </div>
        </div>

        <div class="panel mt-8">
          <h3 style="font-weight:700; margin:0 0 12px;">{{ t('about.tech') }}</h3>
          <p class="text-muted" style="margin:0;">{{ t('about.techStack') }}</p>
        </div>
      </div>

      <!-- Editor View -->
      <div v-else class="editor-section">
        <!-- Not Authenticated -->
        <div v-if="!isAuthenticated" class="auth-section">
          <h2>{{ t('auth.title') }}</h2>
          <p class="auth-subtitle">{{ t('auth.subtitle') }}</p>

          <div class="alert alert-info">
            <strong>GitHub:</strong> awadwd / ArknightsAuthorization_Series-mirror<br>
            <strong>GitCode:</strong> huangjinzhou1 / ArknightsAuthorization_Series
          </div>

          <!-- OAuth 登录按钮 -->
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
              <button
                class="btn btn-primary btn-lg"
                @click="oauthLogin('github')"
                :disabled="loading"
                type="button"
              >
                <span v-if="loading" class="animate-spin">&#8635;</span>
                &#128274; GitHub 登录
              </button>
              <button
                class="btn btn-secondary btn-lg"
                @click="oauthLogin('gitcode')"
                :disabled="loading"
                type="button"
              >
                <span v-if="loading" class="animate-spin">&#8635;</span>
                &#128274; GitCode 登录
              </button>
            </div>
          </div>

          <div class="alert alert-warning" style="margin-bottom: 20px;">
            <strong>或使用 Personal Access Token：</strong>
          </div>

          <div class="form-group">
            <label class="form-label">{{ t('auth.usernameLabel') }}</label>
            <input
              type="text"
              class="form-input"
              v-model="authForm.username"
              :placeholder="t('auth.usernamePlaceholder')"
              @keyup.enter="authenticate"
            />
          </div>

          <div class="form-group">
            <label class="form-label">{{ t('auth.tokenLabel') }}</label>
            <input
              type="password"
              class="form-input"
              v-model="authForm.token"
              :placeholder="t('auth.tokenPlaceholder')"
              @keyup.enter="authenticate"
            />
            <span class="form-hint">{{ t('auth.tokenHint') }}</span>
          </div>

          <div v-if="authError" class="alert alert-danger">
            {{ authError }}
          </div>

          <button
            class="btn btn-primary btn-lg btn-block"
            @click="authenticate"
            :disabled="loading || !authForm.username || !authForm.token"
            type="button"
          >
            <span v-if="loading" class="animate-spin">&#8635;</span>
            {{ loading ? t('auth.validating') : t('auth.submit') }}
          </button>
        </div>

        <!-- Authenticated: Repo Section -->
        <div v-else>
          <!-- Repo Source Selector -->
          <div class="panel" style="margin-bottom:16px;">
            <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
              <span style="font-weight:600;">{{ t('repo.source') || '仓库源' }}:</span>
              <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="radio" v-model="repoSource" value="github" @change="onRepoSourceChange" />
                <span>GitHub (镜像)</span>
              </label>
              <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="radio" v-model="repoSource" value="gitcode" @change="onRepoSourceChange" />
                <span>GitCode (主仓库)</span>
              </label>
            </div>
            <p v-if="repoSource === 'gitcode'" style="margin-top:8px; font-size:13px; color:#e65100;">
              ⚠️ GitCode 需要单独配置 Token，暂不支持 OAuth
            </p>
          </div>

          <!-- Repo Status Bar -->
          <div class="repo-info">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:12px;">
              <div class="badge" :class="isRepoReady ? 'badge-ready' : 'badge-not-ready'">
                {{ isRepoReady ? '&#10003; ' + t('repo.ready') : t('status.notReady') }}
              </div>
              <div v-if="isRepoReady" class="badge badge-connected">
                {{ t('status.connected') }}
              </div>
            </div>

            <div class="repo-info-grid">
              <div class="repo-info-item">
                <span class="repo-info-label">{{ t('repo.owner') }}</span>
                <span class="repo-info-value">{{ currentRepo.owner }}</span>
              </div>
              <div class="repo-info-item">
                <span class="repo-info-label">{{ t('repo.name') }}</span>
                <span class="repo-info-value">{{ currentRepo.repo }}</span>
              </div>
              <div class="repo-info-item">
                <span class="repo-info-label">{{ t('repo.baseBranch') }}</span>
                <span class="repo-info-value">{{ currentRepo.branch }}</span>
              </div>
            </div>
          </div>

          <!-- Clone Button -->
          <div style="text-align:center; margin-bottom:32px;">
            <button
              class="btn btn-primary btn-lg"
              @click="cloneOrPull"
              :disabled="loading"
              type="button"
            >
              <span v-if="loading" class="animate-spin">&#8635;</span>
              {{ loading ? (isRepoReady ? t('repo.pulling') : t('repo.cloning')) : t('repo.clone') }}
            </button>
            <button
              v-if="isAuthenticated"
              class="btn btn-danger"
              @click="logout"
              style="margin-left:8px;"
              type="button"
            >
              {{ t('app.logout') }}
            </button>
          </div>

          <!-- Error Messages -->
          <div v-if="errorMessage" class="alert alert-danger mb-4">
            {{ errorMessage }}
          </div>

          <!-- PR Success -->
          <div v-if="prUrl" class="pr-success">
            <h3>&#10003; {{ t('pr.success') }}</h3>
            <p class="text-muted mb-4">{{ t('pr.devBranchNote') }}</p>
            <a :href="prUrl" target="_blank" class="pr-link">
              &#8594; {{ t('pr.viewOnGithub') }}
            </a>
          </div>

          <!-- File Editor -->
          <div v-if="isRepoReady">
            <!-- File Selector + Edit Mode Toggle -->
            <div class="panel" style="margin-bottom:24px;">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                <h3 style="font-weight:700; margin:0;">{{ t('editor.title') }}</h3>
                <div style="display:flex; gap:8px; align-items:center;">
                  <button
                    class="btn btn-sm"
                    :class="editMode === 'visual' ? 'btn-primary' : 'btn-secondary'"
                    @click="editMode = 'visual'"
                    type="button"
                  >
                    &#128065; {{ t('editor.modeVisual') || '可视化' }}
                  </button>
                  <button
                    class="btn btn-sm"
                    :class="editMode === 'code' ? 'btn-primary' : 'btn-secondary'"
                    @click="editMode = 'code'"
                    type="button"
                  >
                    &#128190; {{ t('editor.modeCode') || '代码' }}
                  </button>
                </div>
              </div>
              <div class="file-selector" style="margin-top:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                  <button
                    v-for="f in files"
                    :key="f.value"
                    class="file-btn"
                    :class="{ active: activeFile === f.value }"
                    @click="switchFile(f.value)"
                    type="button"
                  >
                    {{ t(`editor.files.${f.value.replace('.json','')}`) }}
                  </button>
                </div>
                <button class="btn btn-sm btn-secondary" @click="exportZip" type="button" style="white-space:nowrap;">
                  &#128230; {{ t('editor.exportZip') || '导出 ZIP' }}
                </button>
              </div>
            </div>

            <!-- Visual Editor for Box_id.json -->
            <div v-if="editMode === 'visual' && activeFile === 'Box_Id.json'" class="visual-editor">
              <!-- Search & Add -->
              <div style="display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap;">
                <input
                  type="text"
                  class="form-input"
                  v-model="searchQuery"
                  :placeholder="t('editor.searchPlaceholder') || '搜索盒号或干员...'"
                  style="flex:1; min-width:200px;"
                />
                <button class="btn btn-success" @click="addNewBox" type="button">
                  + {{ t('editor.addBox') || '新增盒号' }}
                </button>
              </div>

              <!-- Box Cards -->
              <div class="box-grid">
                <div
                  v-for="(box, idx) in paginatedBoxes"
                  :key="box.Box_id || idx"
                  class="box-card"
                >
                  <!-- Box Header -->
                  <div class="box-card-header">
                    <span class="box-id">{{ box.Box_id || '新盒号' }}</span>
                    <div style="display:flex; gap:4px;">
                      <button class="btn btn-sm btn-ghost" @click="editBox(paginatedBoxesStartIdx + idx)" type="button">&#9998;</button>
                      <button class="btn btn-sm btn-ghost" @click="deleteBox(paginatedBoxesStartIdx + idx)" type="button" style="color:#d32f2f;">&#128465;</button>
                    </div>
                  </div>

                  <!-- Box Image -->
                  <div v-if="box.Box_ImageUrl" class="box-image">
                    <img :src="proxyUrl(box.Box_ImageUrl)" :alt="'Box ' + box.Box_id" @error="onImgError" />
                  </div>

                  <!-- Box Info -->
                  <div class="box-info">
                    <div class="box-info-row">
                      <span class="label">{{ t('editor.releaseDate') || '首发' }}:</span>
                      <span>{{ box.release_date || '-' }}</span>
                    </div>
                    <div class="box-info-row">
                      <span class="label">{{ t('editor.retailPrice') || '价格' }}:</span>
                      <span>{{ box.retail_price || '-' }}</span>
                    </div>
                    <div class="box-info-row">
                      <span class="label">{{ t('editor.type') || '类型' }}:</span>
                      <span>{{ box.type === 'true' ? (t('editor.typeBlind') || '盲抽') : (t('editor.typeSingle') || '单领') }}</span>
                    </div>
                    <div class="box-info-row">
                      <span class="label">{{ t('editor.replicate') || '复刻' }}:</span>
                      <span>{{ box.replicate === 'true' ? (box.replicate_date || '是') : '否' }}</span>
                    </div>
                  </div>

                  <!-- Characters -->
                  <div class="character-list">
                    <div
                      v-for="(char, cKey) in getCharacters(box)"
                      :key="cKey"
                      class="character-item"
                    >
                      <img
                        v-if="char.imageUrl"
                        :src="proxyUrl(char.imageUrl)"
                        :alt="char.name"
                        class="character-avatar"
                        @error="onImgError"
                      />
                      <div class="character-info">
                        <span class="character-name">
                          {{ char.name }}
                          <span v-if="char.hotcharacter" class="hot-badge">&#128293;</span>
                        </span>
                        <span v-if="char.market_price" class="character-price">
                          {{ t('editor.elite1') || '精一' }}: {{ char.market_price.ELITE1 }} |
                          <template v-if="!char.nolyELITE1">{{ t('editor.elite2') || '精二' }}: {{ char.market_price.ELITE2 }}</template>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Empty State -->
              <div v-if="paginatedBoxes.length === 0" class="panel center" style="padding:48px;">
                <p class="text-muted">{{ t('editor.noResults') || '没有找到匹配的盒号' }}</p>
              </div>

              <!-- Pagination -->
              <div v-if="totalPages > 1" class="pagination" style="display:flex; justify-content:center; align-items:center; gap:8px; margin-top:24px; flex-wrap:wrap;">
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="currentPage <= 1"
                  @click="currentPage--"
                  type="button"
                >
                  &laquo; {{ t('editor.prevPage') || '上一页' }}
                </button>
                <span style="padding:0 12px; font-size:14px;">
                  {{ currentPage }} / {{ totalPages }}
                </span>
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="currentPage >= totalPages"
                  @click="currentPage++"
                  type="button"
                >
                  {{ t('editor.nextPage') || '下一页' }} &raquo;
                </button>
              </div>
            </div>

            <!-- Visual Editor for searchWord.json -->
            <div v-else-if="editMode === 'visual' && activeFile === 'searchWord.json'" class="visual-editor">
              <div style="display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap;">
                <input
                  type="text"
                  class="form-input"
                  v-model="searchQuery"
                  :placeholder="t('editor.searchPlaceholder') || '搜索干员...'"
                  style="flex:1; min-width:200px;"
                />
              </div>

              <div class="searchword-grid">
                <div
                  v-for="(item, idx) in filteredSearchWords"
                  :key="idx"
                  class="searchword-card"
                >
                  <template v-for="(char, cKey) in item" :key="cKey">
                    <div class="searchword-header">
                      <span class="searchword-name">{{ char.name }}</span>
                      <button class="btn btn-sm btn-ghost" @click="editSearchWord(idx)" type="button">&#9998;</button>
                    </div>
                    <div class="searchword-info">
                      <div class="searchword-row">
                        <span class="label">EN:</span>
                        <span>{{ char.englishname || '-' }}</span>
                      </div>
                      <div class="searchword-row">
                        <span class="label">JP:</span>
                        <span>{{ char.japanesename || '-' }}</span>
                      </div>
                      <div class="searchword-row">
                        <span class="label">{{ t('editor.searchWords') || '搜索词' }}:</span>
                        <div class="searchword-tags">
                          <span v-for="(w, wi) in (char.serachword || [])" :key="wi" class="tag">{{ w }}</span>
                          <span v-if="!char.serachword || char.serachword.length === 0" class="text-muted">-</span>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </div>

            <!-- Code Editor -->
            <div v-else class="editor-panel">
              <div class="editor-header">
                <span class="editor-title">{{ activeFile }}</span>
                <span class="editor-status" :class="jsonValid ? 'valid' : 'invalid'">
                  {{ jsonValid ? t('editor.validJson') : t('editor.invalidJson') }}
                </span>
              </div>
              <div class="editor-body">
                <textarea
                  class="form-input"
                  v-model="jsonInput"
                  :placeholder="'{\n  \n}'"
                  @input="validateJson"
                  style="min-height:300px;"
                ></textarea>
              </div>
            </div>

            <!-- Commit Section -->
            <div class="commit-section">
              <div class="commit-header">
                <div>
                  <h3 style="font-weight:700; margin:0 0 4px;">{{ t('pr.autoCreated') }}</h3>
                  <p class="text-muted text-sm" style="margin:0;">{{ t('pr.devBranchNote') }}</p>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">{{ t('editor.commitMessage') }}</label>
                <input
                  type="text"
                  class="form-input"
                  v-model="commitMessage"
                  :placeholder="t('editor.commitPlaceholder')"
                />
              </div>

              <div class="commit-actions">
                <button
                  class="btn btn-primary"
                  @click="saveAndCreatePR"
                  :disabled="loading || !jsonValid || !commitMessage.trim()"
                  type="button"
                >
                  <span v-if="loading">&#8635;</span>
                  {{ loading ? t('editor.creating') : t('editor.createPR') }}
                </button>
                <button
                  class="btn btn-secondary"
                  @click="resetJson"
                  type="button"
                >
                  {{ t('editor.reset') }}
                </button>
              </div>
            </div>

            <!-- Manual Commands -->
            <div class="manual-section">
              <h3 class="manual-title">&#9881; {{ t('manual.title') }}</h3>
              <p class="manual-hint">{{ t('repo.manualHint') }}</p>
              <div class="manual-commands">
                <pre>{{ manualCommandsText }}</pre>
              </div>
              <button class="btn btn-secondary btn-sm mt-4" @click="copyManual" type="button">
                {{ manualCopied ? t('manual.copied') : t('manual.copy') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="site-footer">
      <div class="footer-content">
        <div class="footer-section">
          <span class="footer-title">{{ t('app.title') }}</span>
          <p class="footer-note">{{ t('footer.description') }}</p>
        </div>
        <div class="footer-section">
          <span class="footer-title">{{ t('nav.about') }}</span>
          <p class="footer-note">{{ t('footer.protection') }}</p>
          <a class="footer-link" href="https://github.com/awadwd/ArknightsAuthorization_Series-mirror" target="_blank">
            {{ t('nav.githubTitle') }}
          </a>
        </div>
      </div>
      <div class="footer-bottom">
        <p class="footer-copyright">
          ArknightsAuthorization_Series — {{ t('footer.openSource') }}
        </p>
        <div class="badge badge-not-ready">main &#8594; dev</div>
      </div>
    </footer>

    <!-- Box Edit Modal -->
    <div v-if="showBoxModal" class="modal-overlay" @click.self="showBoxModal = false">
      <div class="modal-content">
        <h3 style="margin:0 0 20px;">{{ editingBoxIndex === -1 ? (t('editor.addBox') || '新增盒号') : (t('editor.editBox') || '编辑盒号') }}</h3>
        
        <div class="form-group">
          <label class="form-label">Box_id</label>
          <input type="text" class="form-input" v-model="boxForm.Box_id" placeholder="如 1.0" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.releaseDate') || '首发日期' }}</label>
          <input type="text" class="form-input" v-model="boxForm.release_date" placeholder="如 2020/05/01" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.retailPrice') || '价格' }}</label>
          <input type="text" class="form-input" v-model="boxForm.retail_price" placeholder="如 25元/抽" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.type') || '类型' }}</label>
          <select class="form-input" v-model="boxForm.type">
            <option value="true">{{ t('editor.typeBlind') || '盲抽' }}</option>
            <option value="false">{{ t('editor.typeSingle') || '单领/赠品' }}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.replicate') || '是否复刻' }}</label>
          <select class="form-input" v-model="boxForm.replicate">
            <option value="false">否</option>
            <option value="true">是</option>
          </select>
        </div>
        <div v-if="boxForm.replicate === 'true'" class="form-group">
          <label class="form-label">{{ t('editor.replicateDate') || '复刻日期' }}</label>
          <input type="text" class="form-input" v-model="boxForm.replicate_date" placeholder="如 2026/5/1" />
        </div>
        <div class="form-group">
          <label class="form-label">Box_ImageUrl</label>
          <input type="text" class="form-input" v-model="boxForm.Box_ImageUrl" placeholder="盒号大图URL" />
        </div>

        <!-- Characters -->
        <h4 style="margin:20px 0 12px;">{{ t('editor.characters') || '干员列表' }}</h4>
        <div v-for="(char, cIdx) in boxFormCharacters" :key="cIdx" class="character-edit-item">
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="text" class="form-input" v-model="char.name" :placeholder="t('editor.charName') || '干员名称'" style="flex:1;" />
            <input type="text" class="form-input" v-model="char.imageUrl" placeholder="头像URL" style="flex:1;" />
            <button class="btn btn-sm btn-danger" @click="boxFormCharacters.splice(cIdx, 1)" type="button">&#128465;</button>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <label style="display:flex; align-items:center; gap:4px; font-size:0.9rem;">
              <input type="checkbox" v-model="char.hotcharacter" /> &#128293;
            </label>
            <label style="display:flex; align-items:center; gap:4px; font-size:0.9rem;">
              <input type="checkbox" v-model="char.nolyELITE1" /> {{ t('editor.onlyElite1') || '仅精一' }}
            </label>
            <input type="number" class="form-input" v-model.number="char.ELITE1" placeholder="精一价格" style="width:100px;" />
            <input v-if="!char.nolyELITE1" type="number" class="form-input" v-model.number="char.ELITE2" placeholder="精二价格" style="width:100px;" />
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" @click="addCharacter" type="button" style="margin-top:8px;">
          + {{ t('editor.addCharacter') || '添加干员' }}
        </button>

        <div style="display:flex; gap:8px; margin-top:24px; justify-content:flex-end;">
          <button class="btn btn-secondary" @click="showBoxModal = false" type="button">{{ t('editor.cancel') || '取消' }}</button>
          <button class="btn btn-primary" @click="saveBox" type="button">{{ t('editor.save') || '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import { useI18n, t as translate, tm } from './i18n'

// 使用相对路径（Cloudflare Pages Functions 同域）
// 开发环境代理到 localhost:3000，生产环境直接用相对路径
const API_BASE_URL = import.meta.env.DEV ? 'http://localhost:3000' : ''
axios.defaults.baseURL = API_BASE_URL
axios.defaults.timeout = 0

export default {
  name: 'App',

  setup() {
    const { locale, localeOptions, setLocale } = useI18n()
    return { locale, localeOptions, setLocale, tm, tmFeatureList }
  },

  data() {
    return {
      view: 'editor',
      navOpen: false,
      langOpen: false,
      editMode: 'visual',

      // Auth
      isAuthenticated: false,
      username: '',
      authForm: { username: '', token: '' },
      authError: '',

      // Repo
      isRepoReady: localStorage.getItem('repoReady') === 'true',
      repoSource: localStorage.getItem('repoSource') || 'github',
      repoConfigs: {
        github: { owner: 'awadwd', repo: 'ArknightsAuthorization_Series-mirror', branch: 'dev' },
        gitcode: { owner: 'huangjinzhou1', repo: 'ArknightsAuthorization_Series', branch: 'dev' }
      },

      // Editor
      activeFile: 'Box_Id.json',
      files: [
        { value: 'Box_Id.json', original: '' },
        { value: 'Version.json', original: '' },
        { value: 'searchWord.json', original: '' },
      ],
      jsonInput: '',
      jsonValid: true,
      commitMessage: '',
      searchQuery: '',

      // UI state
      loading: false,
      errorMessage: '',
      successMessage: '',
      prUrl: '',
      manualCopied: false,

      // Pagination
      currentPage: 1,
      itemsPerPage: 10,

      // Box modal
      showBoxModal: false,
      editingBoxIndex: -1,
      boxForm: {},
      boxFormCharacters: [],
    }
  },

  computed: {
    currentLangLabel() {
      const opt = this.localeOptions.find(o => o.code === this.locale)
      return opt ? opt.label : 'Language'
    },

    tmFeatureList() {
      return this.tm('about.featureList') || []
    },

    currentRepo() {
      return this.repoConfigs[this.repoSource] || this.repoConfigs.github
    },

    parsedJson() {
      if (!this.jsonInput.trim()) return null
      try {
        return JSON.parse(this.jsonInput)
      } catch {
        return null
      }
    },

    filteredBoxes() {
      if (!this.parsedJson || !Array.isArray(this.parsedJson)) return []
      if (!this.searchQuery.trim()) return this.parsedJson
      const q = this.searchQuery.toLowerCase()
      return this.parsedJson.filter(box => {
        if (box.Box_id && box.Box_id.toLowerCase().includes(q)) return true
        for (const key in box) {
          if (key.startsWith('character') && box[key]?.name?.toLowerCase().includes(q)) return true
        }
        return false
      })
    },

    filteredSearchWords() {
      if (!this.parsedJson || !Array.isArray(this.parsedJson)) return []
      if (!this.searchQuery.trim()) return this.parsedJson
      const q = this.searchQuery.toLowerCase()
      return this.parsedJson.filter(item => {
        for (const key in item) {
          if (item[key]?.name?.toLowerCase().includes(q)) return true
        }
        return false
      })
    },

    // Pagination
    totalPages() {
      if (!this.filteredBoxes || !Array.isArray(this.filteredBoxes)) return 0;
      return Math.ceil(this.filteredBoxes.length / this.itemsPerPage);
    },

    paginatedBoxes() {
      if (!this.filteredBoxes || !Array.isArray(this.filteredBoxes)) return [];
      const start = (this.currentPage - 1) * this.itemsPerPage;
      const end = start + this.itemsPerPage;
      return this.filteredBoxes.slice(start, end);
    },

    paginatedBoxesStartIdx() {
      return (this.currentPage - 1) * this.itemsPerPage;
    },

    manualCommandsText() {
      return `# ArknightsAuthorization_Series — Manual Git Workflow
# Base: awadwd/ArknightsAuthorization_Series-mirror

# Step 1: Clone the repository
git clone https://github.com/awadwd/ArknightsAuthorization_Series-mirror.git
cd ArknightsAuthorization_Series-mirror

# Step 2: Create a new branch for your changes
git checkout -b update/${this.activeFile.replace('.json','')}-${Date.now()}

# Step 3: Edit the file
# Open ${this.activeFile} in your editor and make changes

# Step 4: Commit your changes
git add ${this.activeFile}
git commit -m "${this.commitMessage || 'Update ' + this.activeFile}"

# Step 5: Push to your fork
git push origin update/${this.activeFile.replace('.json','')}-${Date.now()}

# Step 6: Create a Pull Request on GitHub
# Target branch: dev — main is protected!

# Edit file directly via GitHub web interface:
# https://github.com/awadwd/ArknightsAuthorization_Series-mirror/edit/dev/${this.activeFile}`
    },
  },

  methods: {
    t(key, params) {
      return translate(key, params)
    },

    setView(v) {
      this.view = v
      this.navOpen = false
    },

    switchLang(code) {
      this.setLocale(code)
      this.langOpen = false
    },

    onRepoSourceChange() {
      localStorage.setItem('repoSource', this.repoSource)
      this.isRepoReady = false
      localStorage.removeItem('repoReady')
      this.jsonInput = ''
      this.originalJson = ''
    },

    getCharacters(box) {
      const chars = []
      for (const key in box) {
        if (key.startsWith('character') && box[key]?.name) {
          chars.push(box[key])
        }
      }
      return chars
    },

    async authenticate() {
      if (!this.authForm.username || !this.authForm.token) return
      this.loading = true
      this.authError = ''
      try {
        const res = await axios.post('/api/auth/validate', {
          username: this.authForm.username,
          token: this.authForm.token,
        })
        if (res.data.success) {
          this.isAuthenticated = true
          this.username = res.data.user || this.authForm.username
          localStorage.setItem('isAuth', 'true')
          localStorage.setItem('user', this.username)
          localStorage.setItem('gh_token', this.authForm.token)
          localStorage.setItem('gh_user', this.authForm.username)
        } else {
          this.authError = res.data.error || translate('errors.authFailed', { message: 'Unknown error' })
        }
      } catch (err) {
        this.authError = translate('errors.authFailed', {
          message: err.response?.data?.error || err.message,
        })
      } finally {
        this.loading = false
      }
    },

    oauthLogin(source = 'github') {
      this.loading = true
      axios.get(`/api/auth/login?source=${source}`).then(res => {
        const authUrl = res.data.authUrl
        
        // 检测是否为移动端
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768
        
        if (isMobile) {
          // 移动端：保存当前状态，页面内跳转
          sessionStorage.setItem('oauth_redirect', window.location.href)
          window.location.href = authUrl
        } else {
          // PC端：弹窗
          const popup = window.open(authUrl, 'oauth-window', 'width=600,height=700,scrollbars=yes')
          if (!popup) {
            this.authError = '请允许弹出窗口以完成授权'
            this.loading = false
            return
          }
          // Listen for callback message
          const handleMessage = (event) => {
            if (event.data?.type === 'github-oauth-success') {
              this.isAuthenticated = true
              this.username = event.data.user
              localStorage.setItem('isAuth', 'true')
              localStorage.setItem('user', event.data.user)
              localStorage.setItem('gh_token', event.data.token)
              localStorage.setItem('gh_user', event.data.user)
              localStorage.setItem('auth_source', event.data.source || source)
              this.loading = false
              window.removeEventListener('message', handleMessage)
            }
          }
          window.addEventListener('message', handleMessage)
          // Fallback: poll for popup close
          const checkClosed = setInterval(() => {
            if (popup.closed) {
              clearInterval(checkClosed)
              this.loading = false
              window.removeEventListener('message', handleMessage)
            }
          }, 500)
        }
      }).catch(err => {
        this.authError = 'OAuth 登录失败: ' + err.message
        this.loading = false
      })
    },

    logout() {
      localStorage.removeItem('isAuth')
      localStorage.removeItem('user')
      localStorage.removeItem('gh_token')
      localStorage.removeItem('gh_user')
      this.isAuthenticated = false
      this.username = ''
      this.authForm = { username: '', token: '' }
      this.isRepoReady = false
      localStorage.removeItem('repoReady')
      this.prUrl = ''
      this.jsonInput = ''
      this.commitMessage = ''
    },

    async cloneOrPull() {
      this.loading = true
      this.errorMessage = ''
      this.prUrl = ''
      try {
        // GitCode 源：跳过后端验证（WAF 拦 CF Workers，CORS 拦浏览器）
        // 直接标记就绪，试加载文件，失败再报错
        if (this.repoSource === 'gitcode') {
          this.isRepoReady = true
          localStorage.setItem('repoReady', 'true')
          await this.loadCurrentFile()
          return
        }

        // GitHub 源：走后端 API
        const res = await axios.post('/api/repo/clone', { source: this.repoSource })
        if (res.data.success) {
          this.isRepoReady = true
          localStorage.setItem('repoReady', 'true')
          await this.loadCurrentFile()
        } else {
          throw new Error(res.data.error)
        }
      } catch (err) {
        this.errorMessage = translate('errors.cloneFailed', {
          message: err.response?.data?.error || err.message,
        })
      } finally {
        this.loading = false
      }
    },

    async switchFile(filename) {
      this.activeFile = filename
      this.prUrl = ''
      this.searchQuery = ''
      await this.loadCurrentFile()
    },

    async loadCurrentFile() {
      try {
        // GitCode 源：浏览器直接请求 raw 文件，绕过 Cloudflare Workers WAF 拦截
        if (this.repoSource === 'gitcode') {
          const config = this.repoConfigs.gitcode;
          const rawUrl = `https://raw.gitcode.com/${config.owner}/${config.repo}/raw/${config.branch}/${encodeURIComponent(this.activeFile)}`;
          const res = await fetch(rawUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const content = await res.text();
          this.jsonInput = content;
          this.files.forEach(f => {
            if (f.value === this.activeFile) f.original = content;
          });
          this.validateJson();
          return;
        }

        // GitHub 源：走后端 API
        const res = await axios.get(`/api/repo/file?filename=${encodeURIComponent(this.activeFile)}&source=${this.repoSource}`)
        if (res.data.content !== undefined) {
          this.jsonInput = res.data.content
          this.files.forEach(f => {
            if (f.value === this.activeFile) f.original = res.data.content
          })
          this.validateJson()
        }
      } catch (err) {
        this.jsonInput = ''
      }
    },

    validateJson() {
      if (!this.jsonInput.trim()) {
        this.jsonValid = true
        return
      }
      try {
        JSON.parse(this.jsonInput)
        this.jsonValid = true
      } catch {
        this.jsonValid = false
      }
    },

    resetJson() {
      const file = this.files.find(f => f.value === this.activeFile)
      this.jsonInput = file ? file.original : ''
      this.validateJson()
    },

    // Box CRUD
    addNewBox() {
      this.editingBoxIndex = -1
      this.boxForm = {
        Box_id: '',
        release_date: new Date().toISOString().slice(0, 10).replace(/-/g, '/'),
        size: '约5*10cm',
        material: '亚克力、涤纶',
        retail_price: '',
        type: 'true',
        replicate: 'false',
        replicate_date: '',
        Box_ImageUrl: '',
      }
      this.boxFormCharacters = []
      this.showBoxModal = true
    },

    editBox(idx) {
      // idx 来自 filteredBoxes，需要映射到 parsedJson 的真实索引
      const filtered = this.filteredBoxes
      if (!filtered || !filtered[idx]) return
      const box = filtered[idx]
      // 在 parsedJson 中找到同一个对象的索引
      const realIdx = this.parsedJson.indexOf(box)
      this.editingBoxIndex = realIdx
      this.boxForm = { ...box }
      this.boxFormCharacters = []
      for (const key in box) {
        if (key.startsWith('character') && box[key]?.name) {
          this.boxFormCharacters.push({
            key,
            name: box[key].name,
            imageUrl: box[key].imageUrl || '',
            hotcharacter: !!box[key].hotcharacter,
            nolyELITE1: !!box[key].nolyELITE1,
            ELITE1: box[key].market_price?.ELITE1 || 0,
            ELITE2: box[key].market_price?.ELITE2 || 0,
          })
        }
      }
      this.showBoxModal = true
    },

    deleteBox(idx) {
      if (!confirm(translate('editor.confirmDelete') || '确定删除此盒号？')) return
      const filtered = this.filteredBoxes
      if (!filtered || !filtered[idx]) return
      const box = filtered[idx]
      const realIdx = this.parsedJson.indexOf(box)
      if (realIdx === -1) return
      this.parsedJson.splice(realIdx, 1)
      this.jsonInput = JSON.stringify(this.parsedJson, null, 2)
      this.validateJson()
    },

    addCharacter() {
      this.boxFormCharacters.push({
        key: `character${this.boxFormCharacters.length + 1}`,
        name: '',
        imageUrl: '',
        hotcharacter: false,
        nolyELITE1: false,
        ELITE1: 0,
        ELITE2: 0,
      })
    },

    saveBox() {
      const boxes = this.parsedJson ? [...this.parsedJson] : []
      const newBox = { ...this.boxForm }
      
      // Add characters
      this.boxFormCharacters.forEach((char, idx) => {
        if (char.name.trim()) {
          newBox[`character${idx + 1}`] = {
            name: char.name,
            imageUrl: char.imageUrl,
            hotcharacter: char.hotcharacter || undefined,
            nolyELITE1: char.nolyELITE1 || undefined,
            market_price: {
              ELITE1: char.ELITE1,
              ...(char.nolyELITE1 ? {} : { ELITE2: char.ELITE2 }),
            },
          }
        }
      })

      if (this.editingBoxIndex === -1) {
        boxes.push(newBox)
      } else {
        boxes[this.editingBoxIndex] = newBox
      }

      this.jsonInput = JSON.stringify(boxes, null, 2)
      this.validateJson()
      this.showBoxModal = false
    },

    editSearchWord(idx) {
      // TODO: implement searchword edit modal
      alert('搜索词编辑功能开发中...')
    },

    async saveAndCreatePR() {
      if (!this.jsonValid || !this.commitMessage.trim()) return
      this.loading = true
      this.errorMessage = ''
      this.prUrl = ''
      try {
        const res = await axios.post('/api/repo/save-and-pr', {
          filename: this.activeFile,
          content: this.jsonInput,
          commitMessage: this.commitMessage,
        })
        if (res.data.success) {
          this.prUrl = res.data.prUrl
          this.successMessage = translate('pr.success')
          const file = this.files.find(f => f.value === this.activeFile)
          if (file) file.original = this.jsonInput
        } else {
          throw new Error(res.data.error)
        }
      } catch (err) {
        this.errorMessage = translate('errors.prFailed', {
          message: err.response?.data?.error || err.message,
        })
      } finally {
        this.loading = false
      }
    },

    async copyManual() {
      try {
        await navigator.clipboard.writeText(this.manualCommandsText)
        this.manualCopied = true
        setTimeout(() => { this.manualCopied = false }, 2000)
      } catch {
        // Fallback
      }
    },

    // Export ZIP
    async exportZip() {
      if (!this.jsonInput.trim()) {
        alert('请先加载数据再导出')
        return
      }
      try {
        const JSZip = window.JSZip;
        if (!JSZip) throw new Error('JSZip 未加载');
        const zip = new JSZip();
        // 打包三个 JSON 文件
        for (const file of this.files) {
          const content = file.value === this.activeFile ? this.jsonInput : file.original || '';
          zip.file(file.value, content);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `arknights-auth-data-${new Date().toISOString().slice(0, 10)}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('导出 ZIP 失败:', err);
        alert('导出失败: ' + err.message);
      }
    },

    proxyUrl(url) {
      if (!url) return ''
      // B站图床和PRTS图床需要代理
      if (url.includes('hdslb.com') || url.includes('prts.wiki')) {
        return `${API_BASE_URL}/api/proxy-image?url=${encodeURIComponent(url)}`
      }
      return url
    },

    onImgError(e) {
      e.target.style.display = 'none'
    },
  },

  mounted() {
    const savedAuth = localStorage.getItem('isAuth')
    const savedUser = localStorage.getItem('user')
    if (savedAuth === 'true' && savedUser) {
      this.isAuthenticated = true
      this.username = savedUser
      this.authForm.username = localStorage.getItem('gh_user') || savedUser
      this.authForm.token = localStorage.getItem('gh_token') || ''
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.lang-dropdown')) {
        this.langOpen = false
      }
    })
  },
}
</script>

<style scoped>
/* Visual Editor Styles */
.visual-editor {
  margin-bottom: 24px;
}

.box-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
}

.box-card {
  background: var(--panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
}

.box-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.box-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-soft);
  border-bottom: 1px solid var(--border-light);
}

.box-id {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--primary);
}

.box-image {
  width: 100%;
  max-height: 200px;
  overflow: hidden;
  background: #f8f9fa;
}

.box-image img {
  width: 100%;
  height: auto;
  object-fit: contain;
}

.box-info {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
}

.box-info-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.88rem;
  margin-bottom: 4px;
}

.box-info-row .label {
  color: var(--text-muted);
}

.character-list {
  padding: 12px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.character-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-soft);
  border-radius: var(--radius-md);
  font-size: 0.85rem;
}

.character-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}

.character-name {
  font-weight: 600;
}

.hot-badge {
  color: #e74c3c;
}

.character-price {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.character-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* SearchWord Grid */
.searchword-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.searchword-card {
  background: var(--panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 16px;
}

.searchword-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.searchword-name {
  font-weight: 700;
  font-size: 1.05rem;
}

.searchword-info {
  font-size: 0.9rem;
}

.searchword-row {
  margin-bottom: 6px;
}

.searchword-row .label {
  color: var(--text-muted);
  margin-right: 8px;
}

.searchword-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  display: inline-block;
  padding: 2px 8px;
  background: var(--bg-soft);
  border-radius: 12px;
  font-size: 0.8rem;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-content {
  background: var(--panel);
  border-radius: var(--radius-xl);
  padding: 24px;
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

.character-edit-item {
  padding: 12px;
  background: var(--bg-soft);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
}

@media (max-width: 768px) {
  .box-grid {
    grid-template-columns: 1fr;
  }
  .searchword-grid {
    grid-template-columns: 1fr;
  }
  .modal-content {
    max-width: 100%;
    margin: 10px;
  }
}

/* Pagination */
.pagination .btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pagination .btn-sm {
  min-width: 80px;
}
</style>
