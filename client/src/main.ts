import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { createRouter, createWebHistory } from 'vue-router'
import RefundSupport from './components/RefundSupport.vue'
import AdminDashboard from './components/AdminDashboard.vue'

const routes = [
  { path: '/', component: RefundSupport },
  { path: '/admin', component: AdminDashboard },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

const app = createApp(App)

app.use(router)
app.mount('#app')
