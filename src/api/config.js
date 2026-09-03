import axios from 'axios'

// 使用全局 axios，自动继承 App.vue 中设置的 baseURL 与 Authorization 拦截器
export async function getAdminConfig() {
  const { data } = await axios.get('/api/admin/config')
  return data
}

export async function setAdminConfig(config) {
  const { data } = await axios.post('/api/admin/config', { config })
  return data
}
