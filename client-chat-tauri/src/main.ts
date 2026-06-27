import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './themes/light.css'
import './themes/dark.css'
import './style.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// 全局禁用 WebView2 浏览器默认右键菜单
// 各组件如需自定义右键菜单，在具体元素上 @contextmenu.prevent 即可
document.addEventListener('contextmenu', (e) => e.preventDefault())