import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.DEV ? 'http://localhost:3000' : '',
  timeout: 30000,
})

// GET /api/admin/config -> { success, config }
export async function getAdminConfig() {
  const { data } = await api.get('/api/admin/config')
  return data
}

// POST /api/admin/config { config } -> { success }
export async function setAdminConfig(config) {
  const { data } = await api.post('/api/admin/config', { config })
  return data
}