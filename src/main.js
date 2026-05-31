import { createApp } from 'vue'
import App from './App.vue'
import './index.css'
import { initI18n } from './i18n'

// Initialize i18n before mounting the app
initI18n()

createApp(App).mount('#app')
