// src/services/index.ts — 全局调度入口，根据环境变量选择后端适配器
import { SupabaseChatService } from './chatService'
import { GoChatService } from './goChatService'
import type { IChatService } from '../types'

const chatService: IChatService =
  import.meta.env.VITE_BACKEND_TYPE === 'GO'
    ? new GoChatService()
    : new SupabaseChatService()

export { chatService }
