# 项目核心编码规范 (Tauri + Vue 3 + Supabase → Go 双后台 Chat App)

## 1. 项目基础信息与目录结构

当前工作区是一个基于 **Tauri 2.x + Vue 3 + TypeScript** 的 Windows 桌面聊天工具。

- **客户端目录**：`client-chat-tauri` (Tauri + Vue 3 + Vite + Tailwind CSS + Pinia)
- **一期后端**：直接使用 **Supabase** (本地 Docker 部署，PostgreSQL + Realtime + Storage)
- **二期后端**：`go-chat-server` (Go + Gin + WebSocket + GORM + MySQL + Redis)，支持双后台可切换模式
- **数据库**：一期 Supabase PostgreSQL，二期 MySQL

### 1.1 客户端工程目录结构

```
client-chat-tauri/
├── .tauri/                    # Tauri 桌面核心配置（Rust 管理）
│   ├── tauri.conf.json
│   └── src/                   # Rust 源码（快捷键、系统通知等）
├── src/                       # Vue 3 前端源码（核心战场）
│   ├── App.vue                # 根组件
│   ├── main.ts                # 项目入口
│   ├── assets/                # 静态资源（表情包、默认头像、提示音）
│   ├── router/                # 路由配置
│   │   └── index.ts           # 路由表 + beforeEach 守卫
│   ├── components/            # 公共可复用小组件
│   │   ├── Avatar.vue
│   │   └── ImagePreview.vue
│   ├── views/                 # 页面级组件（大视图）
│   │   ├── Login.vue
│   │   └── chat/              # 聊天主面板（必须切块设计）
│   │       ├── Index.vue      # 聊天页主入口（网格布局容器）
│   │       ├── Sidebar.vue    # 左侧功能边栏
│   │       ├── FriendList.vue # 好友/群组列表
│   │       ├── ChatWindow.vue # 右侧对话窗口（气泡流）
│   │       └── InputArea.vue  # 底部输入框
│   ├── types/                 # TypeScript 类型声明 + 服务接口契约
│   │   └── index.ts           # 定义 User、Message、Friend Interface + IChatService 接口
│   ├── utils/                 # 基础底层工具
│   │   └── supabase.ts        # Supabase 客户端单例（唯一入口）
│   ├── services/              # 🔌 网络层服务接口（解耦核心！）
│   │   ├── chatService.ts     # 聊天服务实现（一期：Supabase；二期：新增 goChatService.ts）
│   │   └── ...                # 未来扩展：userService.ts, fileService.ts
│   └── stores/                # 🧠 Pinia 状态管理
│       ├── auth.ts            # 登录状态、当前用户资料缓存
│       └── chat.ts            # 好友列表、消息数组、未读数、实时监听
├── .env.development           # 本地开发环境变量
├── .env.production            # 生产部署环境变量
├── vite.config.ts
└── package.json
```

### 1.2 项目初始化清单（新工程必做）

使用 Vite 模板创建项目后，必须立即执行以下清理步骤：

1. **删除 Vite 模板残余文件**：
   - 删除 `src/components/HelloWorld.vue`（Vite 默认示例组件）
   - 删除 `src/assets/vue.svg`、`src/assets/vite.svg`、`src/assets/hero.png`（模板静态资源）
2. **清理全局样式**：将 `src/style.css` 中 Vite 模板样式（定宽 1126px 的 `#app`、hero 动画、`#next-steps` 等）全部移除，仅保留必要的全局 reset 和 CSS 变量。
3. **创建环境变量文件**：在 `client-chat-tauri/` 根目录创建 `.env.development` 和 `.env.production`，配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`（详见第 6 节）。**此步骤为阻塞性前置条件**，缺失环境变量会导致应用启动即崩溃。
4. **安装依赖**：`npm install`，确保 `@supabase/supabase-js`、`pinia`、`vue-router`、`@tailwindcss/vite`、`tailwindcss` 等核心依赖已安装。

### 1.3 Go 二期后端工程目录结构

```
go-chat-server/
├── config/
│   ├── config.yaml            # MySQL、Redis、端口等配置
│   └── config.go              # 配置结构体映射
├── global/
│   └── global.go              # 全局单例（*gorm.DB, *redis.Client 等）
├── initialize/
│   ├── db.go                  # 初始化 MySQL、AutoMigrate
│   ├── redis.go               # 初始化 Redis
│   └── router.go              # 统一注册 HTTP 与 WebSocket 路由
├── middleware/
│   └── jwt.go                 # JWT 登录鉴权中间件
├── model/
│   ├── user.go                # 用户资料表结构体
│   ├── friendship.go          # 好友关系表结构体
│   └── message.go             # 聊天消息表结构体
├── api/
│   ├── user.go                # 注册、登录（发放 JWT）
│   └── friendship.go          # 好友相关 HTTP 接口
├── service/
│   ├── user.go                # 用户业务逻辑
│   └── message_store.go       # 消息异步持久化
├── im/                        # 📡 长连接管理中枢
│   ├── client.go              # 单个在线客户端连接
│   ├── manager.go             # 核心 Hub：管理在线人员、消息路由
│   └── handler.go             # WebSocket 建立/断开/消息处理
├── go.mod
├── go.sum
└── main.go                    # 启动入口
```

---

## 2. 前端开发规范 (Vue 3 + TypeScript + Tauri)

### 2.1 核心语法与 UI

- **必须使用** Vue 3 `<script setup>` 组合式 API + TypeScript（严格模式）。
- **严禁使用** `any` 类型、Vue 2 Options API、纯 JavaScript。
- **界面绘制**：必须使用 **Tailwind CSS** 自行手绘（Discord 风格、暗黑/现代极简）。
- **绝对禁止** 引入 Element Plus、Ant Design、Naive UI 等外部 UI 组件库，确保打包体积最小。
- **每个组件或文件代码原则上不超过 300 行**，超过请进行模块切块拆分。

### 2.2 极致解耦架构规范 (核心规范，必须严格遵守)

- **绝对禁止** 在 `src/views/` 和 `src/components/` (UI 视图层) 中直接引入并调用 Supabase SDK 或任何网络请求。
- 所有的数据获取、发送、登录等网络行为，必须统一封装在 `src/services/` 目录下。
- 视图层**仅与 Pinia Store 交互**，通过 Store 调度 Service 层。
- **目的**：确保未来将底层网络从 Supabase 切换为自建 Go 后端时，UI 视图层和 Store 层无需改动任何一行代码。
- Service 层采用**适配器模式 (Adapter Pattern)**：
  - 在 `src/types/index.ts` 中定义通用服务接口（如 `IChatService`），声明所有业务方法签名。
  - 在 `src/services/` 中提供具体实现类（一期：`chatService.ts` 基于 Supabase SDK；二期：新增 `goChatService.ts` 基于 Axios + WebSocket）。
  - 通过 Store 消费接口类型，运行时注入具体实现，实现后端零感知切换。

### 2.3 聊天主界面布局骨架规范 (CSS Grid)

主聊天界面 `views/chat/Index.vue` 必须基于以下 CSS Grid 骨架进行渲染，禁止随意修改网格结构：

```css
.chat-layout {
  display: grid;
  grid-template-columns: 64px 280px 1fr;  /* 左侧图标栏 64px | 好友列表 280px | 聊天区自适应 */
  grid-template-rows: 1fr 68px;           /* 消息区自适应 | 底部输入区 68px */
  height: 100dvh;
  width: 100%;
  overflow: hidden;
}
```

**区域划分**：
| 网格区域 | 组件 | 说明 |
|----------|------|------|
| 第一列 | `Sidebar.vue` | 功能图标竖列（消息、联系人、设置等），宽度固定 64px |
| 第二列第一行 | `FriendList.vue` | 好友/群组列表，宽度固定 280px |
| 第三列第一行 | `ChatWindow.vue` | 消息气泡流区域，自适应宽度，支持滚动 |
| 第三列第二行 | `InputArea.vue` | 底部消息输入区，高度固定 68px |

**设计原则**：
- 禁止随意修改列宽和行高，保持 Discord 经典布局比例。
- 好友列表支持 `overflow-y: auto` 内部滚动。
- 聊天窗口消息区域必须支持键盘 `Escape` 取消操作、`Enter` 发送消息等快捷键（在 Tauri Rust 层实现全局监听，前端也可做 `@keydown` 后备）。

### 2.4 类型与数据规范

- **通用唯一标识**：系统中所有实体（用户、消息、好友关系等）的物理主键统一使用 **UUID** (string 类型，字段命名为 `id`)，由数据库侧 `gen_random_uuid()` 自动生成。
- **工号属性**：7 位数字工号（`employee_id`，如 `'0001234'`）仅作为用户档案的**展示属性**（类似工牌号），**不作为**任何表的物理主键或外键关联键。所有关联关系必须通过 UUID (`id`) 建立。
- 所有核心数据对象（User、Message、Friend）必须在 `src/types/index.ts` 中定义严格的 TypeScript Interface。其中 `User` 接口须同时包含 `id: string`（UUID 主键）和 `employee_id?: string`（7 位工号，展示用）。
- 聊天消息必须包含 `msg_type` 字段 (string)，取值范围限定为：`'text' | 'image' | 'file' | 'voice'`。
  - `text`：纯文本消息，content 存文本内容
  - `image`：图片消息，content 存 Supabase Storage 返回的 URL 链接，渲染时用 `<img>` 标签
  - `file`：文件消息，content 存文件下载 URL，渲染为带下载图标的文件卡片
  - `voice`：语音消息，content 存音频 URL，渲染为语音条

### 2.5 组件组织规范

- 聊天主界面必须进行切块设计，拆分为 `Sidebar`、`FriendList`、`ChatWindow`、`InputArea` 等独立子组件，每个子组件代码不超过 300 行。
- **弹窗/Drawer 抽离规则**：页面中出现的复杂弹窗、抽屉、确认对话框等，**绝对禁止**堆砌在单一 View 视图中。必须抽离为独立组件，放置在 `src/components/` 下对应的业务子目录中。子目录命名必须与业务视图严格对应。
  - 示例：`views/chat/` 相关的用户资料弹窗，应抽离为 `components/chat/UserProfileDialog.vue`。
  - 示例：`views/chat/` 相关的创建群组抽屉，应抽离为 `components/chat/CreateGroupDrawer.vue`。
- 组件之间全部通过 **Pinia Store** 共享数据，禁止组件间直接相互引用（父传子、子调父除外，但跨层级通信必须走 Store）。
- 公共基础组件（Avatar、ImagePreview 等）直接放在 `src/components/` 根目录。

### 2.6 聊天交互专项规范

- 每当有新消息加入（`messages` 数组长度增加）或切换好友时，必须利用 Vue 3 的 `nextTick` 将聊天内容区域的滚动条滚动至最底部（`containerEl.scrollTop = containerEl.scrollHeight`）。
- 使用 `watch` 深度监听 `chatStore.messages` 的变化来触发滚动行为（注意开启 `{ deep: true }`）。
- 消息列表渲染须区分左右气泡：自己的消息靠右，他人消息靠左，通过 `sender_id` 与当前登录用户 UUID 比对判断。
- 消息时间戳显示规则：当相邻两条消息的时间间隔超过 5 分钟时，在中间插入时间分隔线（`HH:mm` 格式）。

### 2.7 网络请求规范

- API 接口函数及网络请求逻辑必须集中在 `src/services/` 目录下管理，禁止散落在组件中。
- 一期使用 Supabase SDK (`@supabase/supabase-js`)；二期切换为 Go 后端时，使用 Axios + 原生 WebSocket。
- Go 后端 API 路径前缀：所有 HTTP 接口统一以 `/api` 开头（例如：`/api/login`, `/api/history`，**禁止**添加 `/v1` 等版本号）。
- WebSocket 路径：`ws://<server>:<port>/ws`，连接时携带 JWT Token 进行身份验证。

### 2.8 Vite 配置规范

- 在 `vite.config.ts` 中配置 `server.proxy` 将 `/api` 请求代理到后端，**禁止硬编码 `localhost`**，必须从环境变量读取。
- Tailwind CSS 通过 `@tailwindcss/vite` 插件加载。

```ts
// vite.config.ts 关键配置示例
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: import.meta.env.VITE_GO_API_BASE || 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
```

### 2.9 路由守卫与鉴权拦截

- 路由守卫必须统一在 `src/router/index.ts` 中通过 `router.beforeEach` 实现。
- 除 `/login` 外，所有路由必须在进入前检查登录状态（调用 `supabase.auth.getSession()`），未登录者强制跳转至 `/login`。
- 登录成功后，通过 `router.replace(route.query.redirect as string ?? '/chat')` 跳转至目标页。
- 路由守卫中禁止直接 import `src/stores/auth.ts`（造成循环依赖），应使用 Supabase 客户端实例直接检查 session。
- 路由懒加载：所有页面级组件均使用 `() => import()` 动态导入，实现代码分割。

```ts
// 路由守卫关键逻辑示例
router.beforeEach(async (to, _from, next) => {
  if (to.path === '/login') {
    const { data } = await supabase.auth.getSession()
    if (data.session) return next('/chat')
    return next()
  }
  const { data } = await supabase.auth.getSession()
  if (!data.session) return next('/login?redirect=' + to.path)
  next()
})
```

### 2.10 轻量级通知系统规范 (Phase 1)

由于一期不使用 Element Plus 等外部 UI 组件库，需要自行实现轻量级 Toast 通知系统：

- 在 `src/components/` 下创建 `Toast.vue` 通用通知组件，支持 `success | error | warning | info` 四种类型。
- 通知组件通过 **函数式调用**（命令式 API，而非声明式 `<Toast>` 标签）方式使用，类似 `Element Plus` 的 `ElMessage.success('xxx')`。
- 实现方式：在 `src/utils/` 下创建 `toast.ts`，内部创建一个 Vue 3 应用实例 (`createApp(Toast)`) 并挂载到 `document.body` 的临时 div 上，暴露 `showToast(message, type)` 方法。
- Store 层操作失败时（如发送消息失败、加载好友列表失败），必须调用 Toast 提示用户，不能静默失败。
- Toast 默认停留 3 秒后自动消失，支持 `duration` 参数自定义。
- 同时显示多个 Toast 时，按顺序从上到下堆叠（`top: 64px` 起，每个间隔 8px）。

### 2.11 Tauri 专项规范

- 目标平台：Windows 桌面端 (.exe / .msi)。
- Tauri 配置文件 `tauri.conf.json` 负责窗口大小、托盘图标、系统权限等。
  - 默认窗口尺寸：`width: 1200, height: 800`（最小 `900 × 600`）。
  - 窗口标题栏使用自定义样式（`decorations: false`），前端自行绘制标题栏（最大化、最小化、关闭按钮通过 Tauri API 调用）。
- Tauri 底层 Rust 源码负责快捷键、系统通知、托盘闪烁等原生交互。
  - 快捷键：`Ctrl+N` 新建聊天、`Ctrl+F` 搜索好友、`Escape` 取消当前操作。
  - 系统通知：收到新消息且窗口未聚焦时，通过 Tauri 通知 API 弹出 Windows 原生通知。
  - 托盘：程序最小化时缩至系统托盘，右键菜单包含"显示主窗口"和"退出"。
- 打包命令：`npm run tauri build`，产物为 .msi 安装包和 .exe 绿色版。
- 产物大小应控制在 10MB ~ 20MB。

---

## 3. 一期后端规范 (Supabase)

### 3.1 Supabase 客户端初始化

- **单例模式**：在 `src/utils/supabase.ts` 中创建并导出全局唯一的 Supabase 客户端实例。
- **配置来源**：`supabaseUrl` 和 `supabaseAnonKey` 必须从环境变量（`.env`）读取，禁止硬编码。
- 本地开发默认地址：`http://127.0.0.1:8000`（Kong API 网关）。
- 内网生产地址：`http://<内网服务器IP>:8000`。

### 3.2 用户认证 (Auth)

- 使用 Supabase Auth 的邮箱/密码注册登录 (`signUp` / `signInWithPassword`)。
- 内网环境关闭邮件验证：`GOTRUE_MAILER_AUTOCONFIRM=true`，注册即激活。
- 用户注册成功后，前端须**显式调用** Service 层方法在 `public.profiles` 表中插入用户公开资料（`id`, `nickname`, `employee_id`, `avatar_url`）。注册页面应提供员工号输入框，由用户在注册时填写 7 位工号。**禁止使用数据库触发器自动创建 profiles 记录**（保持业务逻辑在前端显式可控）。
- 登录状态持久化：Supabase SDK 自动在 localStorage 中缓存 session，应用启动时通过 `supabase.auth.getSession()` 恢复登录态。

### 3.3 实时消息 (Realtime)

- 在 `chatStore` 中通过 `initRealtimeListener` 方法订阅 `messages` 表的 `INSERT` 事件。
- 收到新消息后，仅当消息的 `sender_id` 或 `receiver_id` 与当前活跃聊天好友匹配时，才 push 到响应式 `messages` 数组中。
- **避免重复订阅**：`initRealtimeListener` 方法必须检查是否已有活跃订阅，防止多次调用产生重复消息。
- **必须**在 Supabase 后台 -> Database -> Replication 中，为 `messages` 表开启 Realtime 发布：
  ```sql
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  ```

### 3.4 文件存储 (Storage)

- 图片、文件、语音等多媒体消息，先上传到 Supabase Storage 的存储桶（如 `chat-files`），获得公开 URL。
- 将 URL 存入 `messages.content` 字段，`msg_type` 标记对应类型。
- 禁止在 `messages.content` 中直接存 Base64 编码的文件数据。
- 上传前须做客户端文件校验：图片单张不超过 10MB，文件不超过 50MB，语音不超过 5MB。

---

## 4. 二期后端规范 (Go + Gin + GORM + MySQL + Redis)

### 4.1 核心架构

- **Web/API 框架**：`Gin`（处理 HTTP 请求：注册、登录、好友列表、历史消息等）。
- **WebSocket 框架**：`Melody`（基于 gorilla/websocket 封装，负责实时消息长连接）。
- **ORM 框架**：`GORM`（操作 MySQL，使用 AutoMigrate 自动建表同步结构）。
- **缓存**：`Redis`（管理用户在线状态、WebSocket 连接映射、离线消息缓冲）。
- **鉴权**：JWT (JSON Web Token)，登录时发放，WebSocket 连接时校验。

### 4.2 API 路径规范

- 所有 HTTP 接口路径必须以 `/api` 开头（例如：`/api/login`, `/api/history`, `/api/friends`）。
- **禁止**添加 `/v1` 等版本号。
- WebSocket 路径统一为 `/ws`，连接时携带 JWT Token 进行身份验证。

### 4.3 统一响应格式 (Result)

所有 HTTP 接口必须返回统一泛型结构：

```json
{
  "code": 200,
  "message": "success",
  "data": { ... }
}
```

- `code`：业务状态码，200 表示成功，其他表示异常。
- `message`：提示信息。
- `data`：业务数据（可为 null）。

前端的 Axios 拦截器（二期时在 `src/utils/request.ts` 中）须识别 `code !== 200` 并统一通过 toast 提示，但放行特定业务错误码（如资源不存在的 404），交由页面自行处理。

### 4.4 长连接管理 (IM 核心)

- `im/manager.go` 为核心 Hub，内部维护：
  - `Clients map[string]*Client`：所有在线客户端，Key 为用户 ID
  - `Broadcast chan []byte`：广播通道
  - `Register / Unregister chan *Client`：上线/下线通道
- 利用 Go 的 `channel` 和 `select` 机制实现消息路由，不通过共享内存通信。
- 当用户建立 WebSocket 连接时，向 Redis 写入 `online:<用户ID> = 1`；断开时删除。
- 消息路由逻辑：
  1. 发送方通过 WebSocket 发送 JSON 消息
  2. 服务端反序列化，提取 `receiver_id`
  3. 查 Redis 判断接收方是否在线
  4. 在线：直接通过 WebSocket 推送给接收方，同时异步写入 MySQL
  5. 离线：消息标记为未读，存入 Redis 离线消息队列 + MySQL，等用户上线后批量推送

### 4.5 数据库使用 GORM

- 所有表结构通过 `model/` 目录下的 Go 结构体定义。
- 启动时调用 `db.AutoMigrate(&User{}, &Message{}, &Friendship{})` 自动建表/更新字段。
- `id` 字段统一使用 `string` 类型（对应 UUID），在 GORM Tag 中声明 `primaryKey;type:varchar(50)`。

### 4.6 Go 代码风格

- 遵循 Go 官方代码规范 (`gofmt`)。
- 每个 .go 文件职责单一，函数保持简短。
- 错误必须处理，禁止忽略 `err` 返回值。
- 使用 `context.Context` 传递请求上下文，支持超时控制。

---

## 5. 数据库规范

### 5.1 命名规范

- 表名使用小写 + 下划线命名（snake_case）。
- 主键统一命名为 `id`，类型使用 UUID (PostgreSQL 下默认 `gen_random_uuid()` 生成)。
- **所有实体表主键必须为 UUID**，禁止使用自增整数（包括 BIGSERIAL / BIGINT GENERATED BY DEFAULT AS IDENTITY）作为业务表主键。
- 时间审计字段：`created_at`（创建时间）、`updated_at`（更新时间），默认值为 `now()`。
- 所有字段和表必须带 COMMENT 注释。
- PostgreSQL 字符集使用 UTF8，排序规则默认。

### 5.2 核心业务表结构 (Supabase / PostgreSQL)

#### 5.2.1 用户资料表 (`profiles`)

```sql
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  nickname TEXT NOT NULL,
  employee_id TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.profiles IS '用户公开资料表';
COMMENT ON COLUMN public.profiles.id IS '用户 ID，关联 auth.users';
COMMENT ON COLUMN public.profiles.nickname IS '用户昵称（公开展示）';
COMMENT ON COLUMN public.profiles.employee_id IS '7 位工号，仅展示用，非唯一标识';
COMMENT ON COLUMN public.profiles.avatar_url IS '头像图片链接';
```

#### 5.2.2 好友关系表 (`friendships`)

```sql
CREATE TABLE public.friendships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'accepted',
  created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.friendships IS '好友关系表';
COMMENT ON COLUMN public.friendships.status IS '状态：pending (申请中) / accepted (已是好友)';
```

#### 5.2.3 聊天消息表 (`messages`)

```sql
CREATE TABLE public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  msg_type TEXT DEFAULT 'text' CHECK (msg_type IN ('text', 'image', 'file', 'voice')),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.messages IS '聊天消息表';
COMMENT ON COLUMN public.messages.msg_type IS '消息类型：text | image | file | voice';
COMMENT ON COLUMN public.messages.is_read IS '接收方是否已读';
COMMENT ON COLUMN public.messages.created_at IS '消息发送时间';
```

- `sender_id` / `receiver_id`：关联 `profiles.id`（UUID 类型）。
- `content`：文本消息存文字内容，文件/图片/语音消息存 Storage URL 链接。
- 查询历史消息时，使用 OR 条件匹配双向对话：
  ```sql
  WHERE (sender_id = 'A' AND receiver_id = 'B') OR (sender_id = 'B' AND receiver_id = 'A')
  ORDER BY created_at ASC LIMIT 100
  ```

### 5.3 Row Level Security (RLS) 策略

Supabase 默认开启 RLS，必须显式添加策略才能正常读写。以下为各表必须的最小策略集：

```sql
-- profiles: 用户可插入自己的资料（注册时写入）
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- profiles: 用户可更新自己的资料
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- profiles: 所有人可查看资料（公开信息）
CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  USING (true);

-- messages: 发送者可插入消息
CREATE POLICY "Users can insert own messages"
  ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

-- messages: 参与对话的双方可查看消息
CREATE POLICY "Users can view their conversations"
  ON public.messages FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- friendships: 用户可插入好友关系
CREATE POLICY "Users can insert own friendships"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- friendships: 用户可查看自己的好友关系
CREATE POLICY "Users can view own friendships"
  ON public.friendships FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);
```

### 5.4 Realtime 发布

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
```

---

## 6. 环境变量与配置规范

### 6.1 环境变量文件

- `.env.development`：本地开发环境，连接本地 Supabase (`http://127.0.0.1:8000`)
- `.env.production`：生产部署环境，连接内网服务器 IP

### 6.2 必须配置的变量

```env
# Supabase 连接
VITE_SUPABASE_URL=http://127.0.0.1:8000
VITE_SUPABASE_ANON_KEY=your-anon-key

# 后端类型切换 (一期: supabase, 二期: go-backend)
VITE_BACKEND_TYPE=supabase

# Go 后端地址 (二期启用)
VITE_GO_API_BASE=http://127.0.0.1:8080/api
VITE_GO_WS_URL=ws://127.0.0.1:8080/ws
```

- 所有敏感 Key 禁止硬编码在代码中，必须通过 `import.meta.env.VITE_*` 读取。
- `VITE_BACKEND_TYPE` 用于 Service 层适配器切换，取值为 `'supabase'` 或 `'go-backend'`。

---

## 7. 部署规范

### 7.1 一期 Supabase 部署

- 使用 Docker Compose 部署（官方 `supabase/docker` 目录）。
- 内网部署需提前在联网机器上 `docker save` 打包所有镜像，拷贝至内网服务器后 `docker load` 导入。
- 数据持久化：确保 `volumes/db/data` 挂载路径有写权限，防止重启丢失聊天记录。
- 修改 `.env` 关键配置：`JWT_SECRET`、`POSTGRES_PASSWORD`、`ANON_KEY`、`SERVICE_ROLE_KEY`。
- 关闭外网认证依赖：`ENABLE_PROVIDER_GITHUB=false` 等。
- 内网注册免邮件验证：`GOTRUE_MAILER_AUTOCONFIRM=true`。

### 7.2 二期 Go 后端部署

- Go 后端支持跨平台交叉编译：

```bash
# Windows 上编译 Linux 可执行文件
$env:GOOS="linux"; $env:GOARCH="amd64"; go build -ldflags "-s -w" -o go-chat-server main.go
```

- 服务器上使用 `systemd` 守护进程管理，配置开机自启。
- 或使用 Docker Compose 联合编排（MySQL + Redis + Go 后端），一键启动。

### 7.3 客户端打包

- 修改 `.env.production` 指向生产环境地址。
- 执行 `npm run tauri build` 打包为 .msi 安装包和 .exe 绿色版。

---

## 8. 专属规则与 AI 执行指令

1. **解耦检查**：如果发现 UI 层（`views/` 或 `components/`）直接调用 `supabase.from()` 或任何网络请求，必须立即将其抽离至 Service 层，通过 Store 间接调用。
2. **类型严格**：禁止在 TypeScript 中使用 `any`，所有数据对象必须在 `src/types/index.ts` 中定义 Interface。未知类型优先使用 `unknown` 配合类型守卫收窄。
3. **加载反馈**：所有网络请求期间必须配合 `v-loading` 指令或骨架屏（Skeleton）提供加载状态反馈，禁止页面空白等待。
4. **错误处理闭环**：Service 层的方法必须 try-catch 或返回 error 对象。Store 层消费时须做错误处理，通过 toast/notification 提示用户（一期使用轻量 toast 函数，二期统一使用 Element Plus 或自定义 toast 组件）。
5. **组件拆分**：单个 .vue 文件超过 300 行时，必须拆分为子组件。
6. **生成代码风格**：输出完整的 `.vue` 文件（Template + Script setup TS + Style scoped），使用 Tailwind CSS 类名，保持 Discord 暗黑风格。
7. **去 Mock 化**：识别页面中的静态假数据，在 `onMounted` 或 Store 的初始化方法中调用 Service 层获取真实数据替换。
8. **布局一致性**：修改聊天界面布局时，必须严格遵守 2.3 节定义的 CSS Grid 骨架，禁止随意增删网格列或修改列宽/行高。
9. **实时消息幂等**：在 Store 的 Realtime 回调中，push 新消息前须检查 `messages` 数组中是否已存在相同 `id` 的消息（通过 `Array.some()` 判断），防止重复插入。
10. **数据库修改**：一期通过 Supabase Dashboard 或 Migration 脚本修改表结构，二期通过 GORM AutoMigrate。禁止直接在数据库中手动执行非版本化的 DDL。