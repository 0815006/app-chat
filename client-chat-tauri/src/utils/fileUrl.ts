/**
 * 文件 URL 解析工具
 *
 * 后端 saveFile() 返回相对路径（如 "/uploads/avatars/xxx.png"），
 * 前端根据部署模式拼接完整 URL：
 *   - Supabase 模式：后端返回的是完整 HTTP URL（以 http 开头），直接使用
 *   - Go all-in-one Web 模式：浏览器自动补齐相对路径（/uploads/...）
 *   - Go Tauri 桌面端模式：用 VITE_GO_BASE_URL 前缀拼接
 *
 * 使用方式：所有 <img :src>、fetch()、window.open() 等涉及文件 URL 的地方，
 * 在消费 DB 中存储的路径字符串时，先调用此函数做归一化。
 */

/**
 * 将后端返回的文件路径解析为可访问的完整 URL
 * @param path - 数据库中存储的路径（可能是相对路径 /uploads/... 或 Supabase 完整 URL）
 * @returns 可访问的完整 URL
 */
export function resolveFileUrl(path: string | null | undefined): string {
  if (!path) return ''

  // Supabase 模式：后端返回完整 HTTP(S) URL，直接使用
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }

  // Go 后端相对路径：拼接 VITE_GO_BASE_URL
  // - all-in-one Web：VITE_GO_BASE_URL 为空字符串，浏览器自动补齐
  // - Tauri 桌面端：VITE_GO_BASE_URL 为后端地址
  const base = import.meta.env.VITE_GO_BASE_URL ?? ''
  return base + path
}
