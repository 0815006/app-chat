/**
 * 从 SVG logo 生成所有 Tauri 应用图标
 *
 * 用法: node scripts/gen-icons.mjs
 *
 * 流程:
 *   1. 用 sharp 将 public/logo.svg 渲染为 1024x1024 的源 PNG
 *   2. 调用 tauri icon 命令自动生成所有平台所需的图标格式和尺寸
 *
 * 需要: npm install --save-dev sharp
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SVG_PATH = join(ROOT, 'public', 'logo.svg')
const SOURCE_PNG = join(ROOT, 'src-tauri', 'icons', '_source.png')

// 确保 icons 目录存在
const iconsDir = join(ROOT, 'src-tauri', 'icons')
mkdirSync(iconsDir, { recursive: true })

console.log('🎨 渲染 SVG → 1024x1024 PNG...')
await sharp(SVG_PATH)
  .resize(1024, 1024)
  .png()
  .toFile(SOURCE_PNG)

console.log('✅ 源 PNG 已生成:', SOURCE_PNG)

// 使用 Tauri CLI 生成所有图标格式
// 这会自动生成: 32x32.png, 128x128.png, 128x128@2x.png, icon.ico, icon.icns, 以及 Windows Store 图标
console.log('🚀 调用 tauri icon 生成所有平台图标...')
try {
  execSync('npx tauri icon src-tauri/icons/_source.png', {
    cwd: ROOT,
    stdio: 'inherit',
  })
  console.log('✅ 所有图标生成完毕!')
} catch (err) {
  console.error('❌ tauri icon 执行失败:', err.message)
  console.log('💡 请确认 @tauri-apps/cli 已安装: npm install')
  process.exit(1)
}

// 清理临时源文件
if (existsSync(SOURCE_PNG)) {
  unlinkSync(SOURCE_PNG)
  console.log('🧹 已清理临时文件:', SOURCE_PNG)
}

console.log('\n📦 生成的图标文件:')
console.log('   src-tauri/icons/32x32.png      — 托盘图标 / 小图标')
console.log('   src-tauri/icons/128x128.png    — 标准图标')
console.log('   src-tauri/icons/128x128@2x.png — 高分屏图标 (256x256)')
console.log('   src-tauri/icons/icon.ico       — Windows 图标')
console.log('   src-tauri/icons/icon.icns      — macOS 图标')
console.log('   src-tauri/icons/Square*.png    — Windows Store 图标')
