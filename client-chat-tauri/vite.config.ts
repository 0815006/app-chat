/// <reference types="vite/client" />
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue(), tailwindcss()],
    // 阻止 Vite 吞没 Rust 触发的错误
    clearScreen: false,
    server: {
      // Tauri 预期固定端口
      port: 5174,
      strictPort: true,
      // 支持 Tauri 桌面应用通过局域网访问 dev server
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 5175,
          }
        : undefined,
      proxy: {
        '/api': {
          target: env.VITE_GO_BASE_URL || 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
      },
    },
    // 环境变量前缀：VITE_ 开头的变量会注入到前端
    envPrefix: 'VITE_',
  }
})
