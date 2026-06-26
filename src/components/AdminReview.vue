<template>
  <div class="admin-review-container">
    <!-- 页面标题 -->
    <div class="section-header">
      <span class="section-eyebrow">管理员</span>
      <h1 class="section-title">反馈审核</h1>
      <p class="section-description">审核用户提交的数据反馈，审核通过后将自动更新数据</p>
    </div>

    <!-- 统计信息 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">{{ pendingCount }}</div>
        <div class="stat-label">待审核</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">{{ approvedCount }}</div>
        <div class="stat-label">已通过</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">{{ rejectedCount }}</div>
        <div class="stat-label">已拒绝</div>
      </div>
    </div>

    <!-- 筛选选项 -->
    <div class="filter-section">
      <button 
        class="filter-btn" 
        :class="{ active: currentFilter === 'all' }" 
        @click="setFilter('all')"
      >
        全部
      </button>
      <button 
        class="filter-btn" 
        :class="{ active: currentFilter === 'pending' }" 
        @click="setFilter('pending')"
      >
        待审核
      </button>
      <button 
        class="filter-btn" 
        :class="{ active: currentFilter === 'approved' }" 
        @click="setFilter('approved')"
      >
        已通过
      </button>
      <button 
        class="filter-btn" 
        :class="{ active: currentFilter === 'rejected' }" 
        @click="setFilter('rejected')"
      >
        已拒绝
      </button>
    </div>

    <!-- 反馈列表 -->
    <div class="feedback-list">
      <div v-if="filteredFeedbacks.length === 0" class="empty-state">
        <div class="empty-icon">📭</div>
        <p>暂无反馈数据</p>
      </div>

      <div 
        v-for="(feedback, index) in filteredFeedbacks" 
        :key="index"
        class="feedback-card"
        :class="'status-' + feedback.status"
      >
        <!-- 卡片头部 -->
        <div class="feedback-header">
          <div class="feedback-meta">
            <span class="feedback-id">#{{ index + 1 }}</span>
            <span class="feedback-box">盒号: {{ feedback.boxId }}</span>
            <span class="feedback-type">{{ feedback.type }}</span>
          </div>
          <span class="feedback-status" :class="feedback.status">
            {{ getStatusText(feedback.status) }}
          </span>
        </div>

        <!-- 反馈内容 -->
        <div class="feedback-body">
          <!-- 错误字段 -->
          <div v-if="feedback.errorFields && feedback.errorFields.length > 0" class="info-row">
            <label>错误字段:</label>
            <div class="tag-list">
              <span v-for="field in feedback.errorFields" :key="field" class="tag">
                {{ getFieldName(field) }}
              </span>
            </div>
          </div>

          <!-- 原始数据 -->
          <div v-if="feedback.originalData" class="info-row">
            <label>原始数据:</label>
            <div class="data-box error">{{ feedback.originalData }}</div>
          </div>

          <!-- 正确数据 -->
          <div class="info-row">
            <label>正确数据:</label>
            <div class="data-box success">{{ feedback.correctData }}</div>
          </div>

          <!-- 详细说明 -->
          <div v-if="feedback.description" class="info-row">
            <label>详细说明:</label>
            <p class="description">{{ feedback.description }}</p>
          </div>

          <!-- 图片 -->
          <div v-if="feedback.images && feedback.images.length > 0" class="info-row">
            <label>图片凭证:</label>
            <div class="image-list">
              <img 
                v-for="(img, imgIndex) in feedback.images" 
                :key="imgIndex"
                :src="img"
                @click="previewImage(img)"
                class="feedback-image"
              />
            </div>
          </div>

          <!-- 联系方式 -->
          <div v-if="feedback.contact" class="info-row">
            <label>联系方式:</label>
            <span class="contact">{{ feedback.contact }}</span>
          </div>

          <!-- 提交时间 -->
          <div class="info-row">
            <label>提交时间:</label>
            <span class="time">{{ formatTime(feedback.createTime) }}</span>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="feedback-actions" v-if="feedback.status === 'pending'">
          <button class="btn btn-success" @click="approveFeedback(feedback, index)">
            ✓ 通过
          </button>
          <button class="btn btn-danger" @click="showRejectDialog(feedback, index)">
            ✗ 拒绝
          </button>
        </div>

        <!-- 审核信息 -->
        <div v-if="feedback.status !== 'pending' && feedback.reviewInfo" class="review-info">
          <p>
            <strong>审核人:</strong> {{ feedback.reviewInfo.reviewer }}
          </p>
          <p>
            <strong>审核时间:</strong> {{ formatTime(feedback.reviewInfo.reviewTime) }}
          </p>
          <p v-if="feedback.reviewInfo.reason">
            <strong>原因:</strong> {{ feedback.reviewInfo.reason }}
          </p>
        </div>
      </div>
    </div>

    <!-- 拒绝原因对话框 -->
    <div v-if="showRejectModal" class="modal-overlay" @click.self="showRejectModal = false">
      <div class="modal-content">
        <h3>拒绝原因</h3>
        <textarea 
          v-model="rejectReason" 
          placeholder="请输入拒绝原因..."
          class="form-input"
          rows="4"
        ></textarea>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showRejectModal = false">取消</button>
          <button class="btn btn-danger" @click="confirmReject">确认拒绝</button>
        </div>
      </div>
    </div>

    <!-- 图片预览 -->
    <div v-if="previewImageUrl" class="image-preview-modal" @click="previewImageUrl = ''">
      <img :src="previewImageUrl" />
    </div>
  </div>
</template>

<script>
export default {
  name: 'AdminReview',
  props: {
    username: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      currentFilter: 'all',
      feedbacks: [],
      showRejectModal: false,
      rejectReason: '',
      currentFeedback: null,
      currentIndex: -1,
      previewImageUrl: ''
    }
  },
  computed: {
    pendingCount() {
      return this.feedbacks.filter(f => f.status === 'pending').length
    },
    approvedCount() {
      return this.feedbacks.filter(f => f.status === 'approved').length
    },
    rejectedCount() {
      return this.feedbacks.filter(f => f.status === 'rejected').length
    },
    filteredFeedbacks() {
      if (this.currentFilter === 'all') {
        return this.feedbacks
      }
      return this.feedbacks.filter(f => f.status === this.currentFilter)
    }
  },
  mounted() {
    this.loadFeedbacks()
  },
  methods: {
    // 加载反馈数据
    async loadFeedbacks() {
      try {
        // 使用相对路径（同一域名下）
        const response = await fetch('/api/feedback')
        
        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            this.feedbacks = result.data || []
            console.log('加载反馈成功:', this.feedbacks.length, '条')
          }
        } else {
          console.error('加载反馈失败:', response.status, response.statusText)
          const errorText = await response.text()
          console.error('错误详情:', errorText)
        }
      } catch (e) {
        console.error('加载反馈失败:', e)
        console.error('错误详情:', e.message)
      }
    },

    // 保存反馈数据
    saveFeedbacks() {
      localStorage.setItem('feedbackList', JSON.stringify(this.feedbacks))
    },

    // 设置筛选
    setFilter(filter) {
      this.currentFilter = filter
    },

    // 获取状态文本
    getStatusText(status) {
      const map = {
        pending: '待审核',
        approved: '已通过',
        rejected: '已拒绝'
      }
      return map[status] || status
    },

    // 获取字段名称
    getFieldName(field) {
      const map = {
        release_date: '发售日期',
        size: '尺寸',
        material: '材质',
        retail_price: '零售价格',
        type: '类型',
        replicate: '复刻信息',
        Box_ImageUrl: '官方图片',
        characters: '干员信息'
      }
      return map[field] || field
    },

    // 格式化时间
    formatTime(time) {
      if (!time) return ''
      const date = new Date(time)
      return date.toLocaleString('zh-CN')
    },

    // 预览图片
    previewImage(url) {
      this.previewImageUrl = url
    },

    // 通过审核
    async approveFeedback(feedback, index) {
      if (!confirm('确认通过此反馈？\n\n建议：审核通过后系统将创建Pull Request，由仓库管理员最终审核。')) {
        return
      }

      try {
        // TODO: 创建GitHub Pull Request
        // 需要基于feedback.modifyData修改Box_Id.json，然后创建PR
        alert('功能开发中：将通过创建Pull Request的方式更新数据。');
        
        // 临时方案：只更新状态为approved
        const response = await fetch('/api/feedback-update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feedbackId: feedback.id,
            status: 'approved'
          })
        });
        
        if (response.ok) {
          feedback.status = 'approved';
          alert('审核通过！');
        } else {
          const result = await response.json();
          alert('操作失败: ' + result.error);
        }
      } catch (e) {
        console.error('审核失败:', e)
        alert('审核失败: ' + e.message)
      }
    },

    // 显示拒绝对话框
    showRejectDialog(feedback, index) {
      this.currentFeedback = feedback
      this.currentIndex = index
      this.rejectReason = ''
      this.showRejectModal = true
    },

    // 确认拒绝
    async confirmReject() {
      if (!this.rejectReason.trim()) {
        alert('请输入拒绝原因')
        return
      }

      try {
        const response = await fetch('/api/feedback-update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feedbackId: this.currentFeedback.id,
            status: 'rejected',
            reason: this.rejectReason
          })
        });
        
        if (response.ok) {
          this.currentFeedback.status = 'rejected';
          this.currentFeedback.reviewInfo = {
            reviewer: this.username,
            reviewTime: new Date().toISOString(),
            reason: this.rejectReason
          };
          
          this.showRejectModal = false;
          alert('已拒绝此反馈');
        } else {
          const result = await response.json();
          alert('操作失败: ' + result.error);
        }
      } catch (e) {
        console.error('拒绝失败:', e);
        alert('拒绝失败: ' + e.message);
      }
    }
  }
}
</script>

<style scoped>
.admin-review-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

/* 统计卡片 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.stat-number {
  font-size: 48px;
  font-weight: 700;
  color: #409EFF;
}

.stat-label {
  font-size: 14px;
  color: #666;
  margin-top: 8px;
}

/* 筛选按钮 */
.filter-section {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.filter-btn {
  padding: 8px 16px;
  border: 1px solid #ddd;
  background: white;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-btn.active {
  background: #409EFF;
  color: white;
  border-color: #409EFF;
}

/* 反馈列表 */
.feedback-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.feedback-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  border-left: 4px solid #999;
}

.feedback-card.status-pending {
  border-left-color: #E6A23C;
}

.feedback-card.status-approved {
  border-left-color: #67C23A;
}

.feedback-card.status-rejected {
  border-left-color: #F56C6C;
}

/* 卡片头部 */
.feedback-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #eee;
}

.feedback-meta {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.feedback-id {
  font-weight: 700;
  color: #333;
}

.feedback-box {
  background: #f0f0f0;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 13px;
}

.feedback-type {
  color: #666;
  font-size: 13px;
}

.feedback-status {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.feedback-status.pending {
  background: #FDF6EC;
  color: #E6A23C;
}

.feedback-status.approved {
  background: #F0F9EB;
  color: #67C23A;
}

.feedback-status.rejected {
  background: #FEF0F0;
  color: #F56C6C;
}

/* 信息行 */
.info-row {
  margin-bottom: 12px;
}

.info-row label {
  display: block;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
  font-size: 13px;
}

.tag-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tag {
  background: #ECF5FF;
  color: #409EFF;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.data-box {
  padding: 12px;
  border-radius: 8px;
  font-family: monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
}

.data-box.error {
  background: #FEF0F0;
  border: 1px solid #FBC4C4;
  color: #F56C6C;
}

.data-box.success {
  background: #F0F9EB;
  border: 1px solid #C2E7B0;
  color: #67C23A;
}

.description {
  color: #666;
  line-height: 1.6;
}

.image-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.feedback-image {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.2s;
}

.feedback-image:hover {
  transform: scale(1.1);
}

.contact {
  color: #409EFF;
}

.time {
  color: #999;
  font-size: 13px;
}

/* 操作按钮 */
.feedback-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.btn-success {
  background: #67C23A;
  color: white;
}

.btn-success:hover {
  background: #85CE61;
}

.btn-danger {
  background: #F56C6C;
  color: white;
}

.btn-danger:hover {
  background: #F78989;
}

.btn-secondary {
  background: #909399;
  color: white;
}

/* 审核信息 */
.review-info {
  margin-top: 16px;
  padding: 12px;
  background: #f9f9f9;
  border-radius: 8px;
  font-size: 13px;
}

.review-info p {
  margin: 4px 0;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #999;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

/* 模态框 */
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
}

.modal-content {
  background: white;
  border-radius: 12px;
  padding: 24px;
  width: 90%;
  max-width: 500px;
}

.modal-content h3 {
  margin: 0 0 16px;
}

.form-input {
  width: 100%;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  resize: vertical;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}

/* 图片预览 */
.image-preview-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  cursor: pointer;
}

.image-preview-modal img {
  max-width: 90%;
  max-height: 90%;
  object-fit: contain;
}
</style>
