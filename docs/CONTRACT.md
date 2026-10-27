# 心屿 · 前端共享契约（v2）

> 本文档是并行开发的**唯一事实来源**。任何模块都不得修改本文件列出的「公共层」文件；
> 公共层由 Lead 维护。模块只能在自己的写入范围内新增/修改文件。
>
> 版本：v2.0（2026-10）｜配套愿景：[`docs/VISION.md`](./VISION.md)｜格式规范：[`docs/FORMAT.md`](./FORMAT.md)

---

## 1. 技术栈与硬性约定

- Vite 8 + React 19 + TypeScript（strict）+ react-router-dom 7（`BrowserRouter`）
- **无后端、无网络**。所有数据写本地：`localStorage`（经 `src/lib/storage.ts`）与
  `IndexedDB`（经 `src/lib/idb.ts` / `src/lib/sessionStore.tsx`）
- **依赖白名单**（VISION.md §7.2 修订后）。除此之外不得新增依赖：

  | 依赖 | 版本 | 用途 | 是否必需 |
  | --- | --- | --- | --- |
  | `react` / `react-dom` / `react-router-dom` | 现有 | 基础 | 必需 |
  | `three` | ^0.186 | 可选 3D 渲染器（必须动态 `import()`） | 可选渲染器 |
  | `vitest` | ^5 | 单元测试 | 开发期 |
  | `puppeteer-core` | ^24 | E2E / 截图回归（用本机 Chrome） | 开发期 |

  > 新增依赖需同时更新本表与 `THIRD_PARTY_NOTICES.md`，并在 PR 说明中给出体积预算。
- 样式：`src/styles/global.css` 中的设计系统类 + 每个模块自己的 `.css` 文件。
  **禁止 Tailwind / CSS-in-JS / 内联大段样式**
- 中文排版：正文用 `var(--font-body)`，标题用 `var(--font-display)`
- 所有对外文案使用简体中文（英文版见 §9 i18n），语气温和、不说教、不诊断
- 每个页面必须有 `@media (max-width: 640px)` 下的可用布局
- 类型导入必须用 `import type`
- 未使用变量会报错（`noUnusedLocals` / `noUnusedParameters` 已开启）

## 2. 路径别名

`@/` → `src/`

## 3. 公共层（只读，禁止修改，Lead 维护）

| 文件 | 作用 |
| --- | --- |
| `src/lib/types.ts` | 全部领域类型（v2 含 `SandSession` / `SandboxEvent` / `SandSurface`） |
| `src/lib/storage.ts` | localStorage 集合封装 + React 订阅钩子 |
| `src/lib/idb.ts` | IndexedDB 封装（会话 / 档案 / 资源），自动降级 |
| `src/lib/sessionStore.tsx` | 会话与档案的读写、归档、保留期、迁移（**业务只调这里**） |
| `src/lib/date.ts` | 日期格式化 |
| `src/lib/id.ts` | `createId`、`seededRandom` |
| `src/lib/utils.ts` | `cx`、`clamp`、`percent` |
| `src/lib/toast.ts` | `useToast()` |
| `src/components/ui/Button.tsx` | `Button`、`ButtonLink` |
| `src/components/ui/Card.tsx` | `Card`、`CardLink`、`SectionHead`、`PageHeader` |
| `src/components/ui/Primitives.tsx` | `Tag`、`Progress`、`Notice`、`Empty`、`Stat`、`TONE_LABEL` |
| `src/components/layout/AppShell.tsx` | 页头/导航/页脚 |
| `src/styles/global.css` | 设计系统（含触摸目标尺寸令牌） |
| `src/styles/app.css` | 外壳样式 |
| `src/App.tsx` | 路由表 |
| `src/sandbox/events.ts` | 事件流引擎（纯函数，可测试） |
| `src/sandbox/surfaceCodec.ts` | 高度场 RLE+Base64 编解码 |
| `src/sandbox/surfaceState.ts` | 运行时沙面 <-> 持久化沙面 |
| `src/sandbox/surfaceOps.ts` | 笔刷引擎（纯函数） |
| `src/sandbox/useSandboxSession.ts` | 沙盘状态机 Hook（唯一状态来源） |
| `src/sandbox/symbols.ts` | 327 个沙具 / 6 大类 / 24 子类 / 检索 / 引导语 |
| `src/sandbox/scenes.ts` | 5 个场景主题 |
| `src/format/sandplay.ts` | `sandplay-session/v1` 格式定义与校验器 |
| `src/format/migrate.ts` | v1 快照 -> v2 会话迁移 |
| `src/sandbox/render/types.ts` | 渲染器适配层接口 |
| `src/i18n/**` | 文案表与 `useI18n()` |

### 3.1 路由表（v2）

```
/                          HomePage
/scales                    ScalesPage
/scales/:scaleId           ScaleRunPage
/sandbox                   SandboxPage（工作台：自助 / 咨询双模式）
/sandbox/session/:id       SessionReplayPage（回放 + 时间轴 + 统计 + 标注）
/sandbox/session/:id/report SessionReportPage（记录单 · 可打印为 PDF）
/sandbox/compare           ComparePage（多会话纵向对比）
/sandbox/clients           ClientsPage（本地档案列表）
/sandbox/clients/:id       ClientProfilePage（单档案：会话列表 + 时间线 + 报告入口）
/toolbox                   ToolboxPage
/toolbox/:toolId           ToolRunPage
/resources                 ResourcesPage
/records                   RecordsPage
/safety                    SafetyPage
/about                     AboutPage
*                          NotFoundPage
```

> 路由在 `src/App.tsx` 集中注册（Lead 维护）。新增页面请先向 Lead 申请路由，
> 不要自己改 `App.tsx`。页面组件文件位置：
> `src/pages/**`，但**沙盘子路由页面放在 `src/sandbox/pages/**`**，
> 这样沙盘模块的写入范围是 `src/sandbox/**`（见 §4）。

### 3.2 存储层用法（不变部分）

```ts
import { moodStore, scaleResultStore, toolSessionStore, journalStore,
         useCollection, usePreferences, setPreferences, STORAGE_KEYS } from '@/lib/storage';

moodStore.add({ id: createId('mood'), at: nowISO(), mood: 4, energy: 3, tags: ['平静'] });
const moods = useCollection<MoodEntry>(STORAGE_KEYS.moods); // 已按时间倒序
```

`useCollection` 返回的是**已缓存的不可变快照**，不要原地修改数组元素，统一用
`add` / `upsert` / `update` / `remove`。

| key | 类型 |
| --- | --- |
| `STORAGE_KEYS.moods` | `MoodEntry` |
| `STORAGE_KEYS.scaleResults` | `ScaleResult` |
| `STORAGE_KEYS.sessions` | `SandSession`（v2 主存储） |
| `STORAGE_KEYS.sandbox` | `SandboxSnapshot`（v1 兼容，只读；启动时迁移） |
| `STORAGE_KEYS.clients` | `LocalClient` |
| `STORAGE_KEYS.toolSessions` | `ToolSession` |
| `STORAGE_KEYS.journal` | `JournalEntry` |

### 3.3 会话层用法（v2 新增，沙盘模块必读）

```ts
import {
  useSessions, saveSession, removeSession, archiveSession, unarchiveSession,
  getSession, purgeExpired, useClients, saveClient, removeClient,
} from '@/lib/sessionStore';

const sessions = useSessions();               // 已迁移、已按时间倒序
saveSession(session);                          // 写 localStorage 镜像 + 异步 IndexedDB
```

**规则：任何组件都不得自己 import `sandboxStore` 或直接读写
`STORAGE_KEYS.sessions`。** 统一走 `sessionStore`。

### 3.4 沙盘状态机用法（v2 新增，沙盘模块必读）

```ts
import { useSandboxSession } from '@/sandbox/useSandboxSession';

const api = useSandboxSession({ initialSceneId: 'beach' });
api.state.items          // 当前摆件（= 事件重放结果）
api.state.sceneId        // 当前场景
api.surface              // 沙面运行时状态（Uint8Array 高度场）
api.addItem('tree')      // 所有变更都走 api，禁止自己 setState items
api.commitMove(id, from, to)   // 拖动结束时调用（内部做 220ms 合并）
api.strokeSurface('dig', points, radius, strength)  // 一次笔画 = 一条事件
api.undo() / api.redo() / api.seek(n)
api.lock()               // 封盘，之后所有变更被拒绝
api.toSession()          // 导出为 SandSession
```

**硬约束**：`api.state.items` 必须始终等于 `replay(api.events, api.cursor)`。
任何绕过 `api` 直接改摆件的写法都会破坏回放与统计。

### 3.5 渲染器适配层（v2 新增）

```ts
import type { SandRendererProps, SandRendererHandle } from '@/sandbox/render/types';
```

三种实现，页面通过 `renderer` prop 选择：

| id | 实现 | 何时用 |
| --- | --- | --- |
| `dom2d` | 现有 DOM 绝对定位（无障碍基线） | `prefers-reduced-motion`、低端设备、键盘操作 |
| `iso2d` | Canvas 2.5D 轴测（**默认**） | 常规 |
| `three` | three.js 正交相机（**动态 import**） | 用户显式选择 |

> 打包预算：`three` 必须落进独立 chunk，主包 **gzip ≤ 175KB**。
> 渲染器实现文件见 `src/sandbox/render/**`（各渲染器自己一个文件）。

### 3.6 可用 CSS 类（摘要）

布局：`.page` `.page--wide` `.page-header` `.page-title` `.page-subtitle` `.eyebrow`
`.stack` `.stack-sm` `.stack-lg` `.row` `.row-between` `.grid.grid--2/3/4` `.divider`
容器：`.card` `.card--flat` `.card--pad-sm` `.card--sunken` `.card--link` `.card-title` `.card-desc`
`.section-title` `.section-head`
按钮：`.btn` `.btn--ghost` `.btn--quiet` `.btn--danger` `.btn--sm` `.btn--lg` `.btn--block` `.btn-group`
标签：`.tag` `.tag--teal` `.tag--clay` `.tag--good/watch/warn/alert` `.tag--outline`
`.tag--selectable` `.tag--selected`
表单：`.field` `.field-label` `.field-hint` `.input` `.textarea` `.select` `.range`
`.option-row` `.option-row--active` `.option-dot`
其他：`.progress` `.progress__bar` `.notice` `.notice--teal/good/watch/warn/alert`
`.empty` `.stat` `.list-item` `.spinner` `.fade-up` `.muted` `.small` `.mono` `.center` `.sr-only`
间距：`.mt-2..6` `.mb-2..5` `.flex-1`

设计令牌（CSS 变量）：`--sand-* --teal-* --clay-* --good/watch/warn/alert-* --ink-*`
`--surface --border --r-sm/md/lg/xl/full --shadow-xs/sm/md/lg --sp-1..8 --ease`

### 3.7 文档与格式 API

```ts
import { toSandplayFile, fromSandplayFile, validateSandplayFile,
         parseSandplayFile, SANDPAY_FORMAT } from '@/format/sandplay';
import { coerceSession, migrateSnapshot } from '@/format/migrate';
```

- 导出文件扩展名：`.sandplay.json`
- 校验器 CLI：`node --experimental-strip-types scripts/validate-session.ts <file...>`
- 规范正文：`docs/FORMAT.md`；JSON Schema：`public/schema/sandplay-session-v1.schema.json`

## 4. 模块写入范围（互不重叠）

| 模块 | 负责人 | 写入范围 |
| --- | --- | --- |
| 量表 | Lead | `src/scales/**`、`src/pages/ScalesPage.tsx`、`src/pages/ScaleRunPage.tsx`、`src/styles/scales.css` |
| 沙盘 · 介质（沙面/渲染器） | `surface-dev` | `src/sandbox/surface/**`、`src/sandbox/render/**`、`src/styles/sandbox-surface.css` |
| 沙盘 · 沙具库与检索 | `symbol-dev` | `src/sandbox/library/**`、`src/styles/sandbox-library.css`、`public/symbol-packs/**` |
| 沙盘 · 回放/统计/标注 | `replay-dev` | `src/sandbox/pages/**`、`src/sandbox/replay/**`、`src/styles/sandbox-replay.css` |
| 沙盘 · 档案/报告 | `archive-dev` | `src/sandbox/archive/**`、`src/sandbox/pages/**`（与 replay-dev 按文件切分，见任务单）、`src/styles/sandbox-archive.css` |
| 沙盘 · 工作台集成 | Lead | `src/pages/SandboxPage.tsx`、`src/sandbox/workbench/**`、`src/styles/sandbox.css` |
| 沙盘 · 公共层 | Lead | `src/sandbox/{events,symbols,scenes,surfaceCodec,surfaceState,surfaceOps,useSandboxSession}.ts`、`src/sandbox/render/types.ts` |
| 工具箱 | Lead | `src/toolbox/**`、`src/pages/ToolboxPage.tsx`、`src/pages/ToolRunPage.tsx`、`src/styles/toolbox.css` |
| 资源与安全 | Lead | `src/resources/**`、`src/pages/ResourcesPage.tsx`、`src/pages/SafetyPage.tsx`、`src/styles/resources.css` |
| 首页与记录 | Lead | `src/pages/HomePage.tsx`、`src/pages/RecordsPage.tsx`、`src/pages/AboutPage.tsx`、`src/pages/NotFoundPage.tsx`、`src/styles/home.css` |
| 格式/迁移/校验器 | Lead | `src/format/**`、`scripts/validate-session.ts`、`public/schema/**` |
| 生态文档 | `docs-dev` | `README.md`、`LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md`、`CONTRIBUTING.md`、`docs/**`（除 CONTRACT.md 与 VISION.md） |
| 测试 | `qa-dev` | `src/**/*.test.ts`（只增不改别人的）、`scripts/e2e/**`、`scripts/audit/**` |

模块自己的 CSS 通过 `import '@/styles/xxx.css'` 在模块入口组件中引入（页面文件顶部）。

## 5. 安全与伦理红线（必须遵守）

1. **不做诊断**。量表结果只能表达为「分数区间 + 自我了解」，禁止出现「你有抑郁症」这类表述；
   必须出现「这不是诊断」的说明。
2. **不替代专业帮助**。结果页要有引导到 `/safety` 的入口。
3. **危机识别**。任何量表若出现高危分级（`tone === 'alert'`，或 PHQ-9 第 9 题 > 0），
   结果区必须显著展示求助入口 + 24 小时热线。
4. **数据不出本地**。禁止 `fetch`/`XMLHttpRequest`/`navigator.sendBeacon` 上报任何用户输入。
   唯一允许的 `fetch` 是用户主动点击的外链跳转（用 `<a target="_blank" rel="noopener noreferrer">`）。
5. 不收集姓名、手机号、身份证等可识别身份的信息。档案只用**化名**。
6. **不解释沙盘**。任何 UI 不得输出「你这样摆说明你……」式的解读，只提供开放式提问
   与客观统计（数量、时长、比例）。
7. **未成年人**：沙盘会话若填写了档案，导出/删除前必须有二次确认；
   `Preferences.acknowledgedAge` 未通过时，沙盘页需显示监护人提示。
   -*状态（v2.0 追加）*：二次确认早已实现（`window.confirm`）；年龄门此前
   **只有字段、没有实现**（零处消费），现已补齐：沙盘页顶部提示，
   「已满 18」与「未满 18，会和监护人一起用」**两条路都能关闭提示**，
   选择写入 `localStorage`、不上传。定位是**知情确认而不是拦截** ——
   提示显示时舞台仍然可用，E2E 有专门一条断言钉这个区别
   （`scripts/e2e/smoke.ts` 沙盘交互场景）。
8. **数据可带走**：`/records` 与每个会话详情都必须提供 `.sandplay.json` 导出与完整删除入口。

## 6. 交付要求

- `npx tsc -b --noEmit` 必须零错误
- `npx vitest run` 必须全绿
- `npx vite build` 必须通过，且主包 gzip ≤ 175KB（`three` 必须是独立 chunk）
- 不修改 `src/App.tsx`、`src/lib/**`、`src/components/**`、`src/styles/global.css`、
  `src/styles/app.css`、`src/sandbox/{events,useSandboxSession,symbols,surfaceCodec,surfaceState,surfaceOps}.ts`、
  `src/format/**`（除非任务单明确授权）
- 完成后在完成消息中列出：新增文件、写入的 localStorage 集合、依赖的公共 API、已知限制

## 7. 性能与可访问性预算

> **表格里的「验证方式」必须真的能跑。** 这一列曾经有一行写着
> `scripts/audit/perf.ts`，而那个文件从来没被创建过 —— `npm run perf`
> 一直抛 `MODULE_NOT_FOUND`，几个月无人发现，因为没人跑它。
> 现在 `npm run check` 会把下面每一条都串起来跑一遍。
> 新增一行预算时，请同时确认对应的命令存在、且**能失败**（改坏阈值应该红）。

| 项 | 预算 | 验证方式 |
| --- | --- | --- |
| 主包 gzip | ≤ 175KB | `npx vite build` 输出（实测 ~140KB） |
| `three` 不进主包 | 独立 chunk，首屏不请求 | E2E 请求监听 |
| 沙盘首屏可交互 | ≤ 1.5s（本地） | `npm run perf`（实测常态 408–456ms；**判失败线 2× 预算 = 3000ms**，超预算但未达失败线会打 `⚠` 告警） |
| 单次笔刷（128×96） | ≤ 4ms | 单元测试里 `performance.now()` 断言 |
| 单次 `surface.stroke` 编码载荷 | ≤ 8KB | 单元测试（实测 ~430–750B） |
| 会话级 `session.surface` 体积 | ≤ 40KB | 单元测试（约 90 笔；实测 50 笔 19.4KB） |
| `replayAll` 4000 事件 | ≤ 60ms | 单元测试（实测 1.3ms） |
| `computeSessionStats` 4000 事件 | ≤ 30ms | 单元测试（实测 1.3ms） |
| 触摸目标 | ≥ 44×44px | `scripts/audit/a11y.ts` |
| 键盘可达 | 沙盘全部操作可用键盘 | **大部分自动化，有一处真实缺口**：`a11y.ts` 的 `keyboard-unreachable` 覆盖 15 条路由（检查交互元素是否在 Tab 序内，有变异证据）；`smoke.ts` 的 `keyboard-flow` 场景（12 断言）覆盖完整键盘流程：聚焦沙具库 → 方向键换格 → Enter 放入 → 方向键调整摆件位置 → 事件流写入。变异证据见 `scripts/audit/keyboard-self-test.mjs`。**缺口**：该流程只在 `dom2d` 渲染器下成立；默认的 `iso2d` 把摆件画在 `<canvas>` 上，仅提供 `sr-only` 只读清单，**键盘无法调整已放置摆件的位置**（`three` 同理）。即：键盘能完成全流程，但需先主动切换渲染器。 |
| 对比度 | 正文 ≥ 4.5:1 | `scripts/audit/a11y.ts` |


**关于沙面体积预算的历史**：初版只写了「沙面编码 ≤ 8KB」，但沙面 payload
随笔画数线性增长（约 +430B/笔），20 笔即 8588B 超限。RLE 只能压「连续同值」，
而笔刷留下的是平滑梯度，几乎没有连续段，所以压缩率天然很低。
现在拆成两条：**单次事件的增量**（8KB，余量极大）与**会话级总量**（40KB，
在 localStorage 5MB 里占 0.8%）。不引入量化或 zlib，因为那会破坏已导出的
`.sandplay.json` 兼容性，而收益不抵成本。

**关于 44px 的正确理解（踩过的坑）**：审计量的是元素**自身盒子的
`getBoundingClientRect()`**，不是「视觉上能点到多大」。因此**不能用伪元素
扩大命中区来达标** —— `::after { inset: -6px }` 的溢出部分不进那个矩形，
审计数字一点都不会降。正确做法是抬高元素盒子本身
（`min-height: 44px` + `display: inline-flex; align-items: center`），
而且**不要加大横向 padding**（会撑破已调好的排版）；宽度不足时用
`min-width: 44px` 单独补。

**两条实测补充（v2.0 收藏功能时踩到的）**：

其一，**`min-height` 只做了一半**。`44×44` 是两个方向，只写 `min-height`
时中文短标签（11.5px 字号下「换一组」四个字 = 42.5px）宽度差 1.5px，
移动端每次报 `button(43×44)`。`display: inline-flex` + `justify-content: center`
+ `min-width: 44px` 才是完整的写法。

其二，**`clip-path` 不缩命中区**。曾把收藏星标做成盖在 56px 格子上的
44×44 绝对定位按钮，再用 `clip-path` 只想留一个小三角可点 —— 剪裁只影响
**绘制**，元素的可点矩形仍是 44×44，把格子中心全吃了，点沙具再也摆不进。
结论：**网格里塞不下两个 44px 目标**，第二个操作必须换位置（本项目最终
放进长按/右键唤出的预览条），而不是想办法把两个叠在一起。

**关于审计脚本里的阈值**：`scripts/audit/a11y.ts` 的 `page.evaluate` 回调
是**序列化后在浏览器里执行**的，拿不到 Node 侧常量。曾经有改动在回调里
直接引用 `MIN_TARGET`，导致 `ReferenceError` —— 审计在**零违规时也 exit 1**，
而报错很容易被误读成「审计没通过」。回调内必须用本地字面量，文件里另有
一对 `BROWSER_*` 副本与编译期一致性守卫防止两边漂移。

## 8. 测试与验收

```bash
npx vitest run                    # 单元测试
npx tsc -b --noEmit               # 类型
npx vite build                    # 构建 + 体积

# E2E 与审计（脚本是 .ts，Node 22 需要 --experimental-strip-types；
# 需先 npx vite build；脚本会自起 vite preview）
node --experimental-strip-types --no-warnings scripts/audit/perf.ts    # 首屏预算
node --experimental-strip-types --no-warnings scripts/e2e/smoke.ts     # E2E 冒烟
node --experimental-strip-types --no-warnings scripts/audit/a11y.ts    # 可访问性

# 格式校验器（Node 22 需要 strip-types 才能直接跑 .ts）
node --experimental-strip-types --no-warnings scripts/validate-session.ts samples/*.sandplay.json

# 或者直接用 npm script（已封装好上述参数）
npm run check
```

> ⚠️ 这段命令曾经是**照抄必失败**的：写成 `node scripts/audit/perf.ts`（漏了
> `--experimental-strip-types`），并且注释里还标着「.mjs」——文件其实是 `.ts`。
> 逐字执行是：
>
> ```
> node scripts/audit/perf.ts
> → throw new ERR_UNKNOWN_FILE_EXTENSION(ext, filepath);   EXIT=1
> ```
>
> 文档里的命令**必须亲手跑一遍**再写进去。复制粘贴是文档最主要的用法，
> 一条必然失败的命令会让读者怀疑整个文档的可靠性。
```

**开发期浏览器核查**（Lead 维护，`.mjs`）：

> ⚠️ **进程清理情况**：`scripts/dev/check-routes.mjs` 会干净地清理自己起的
> `vite preview`（用 `spawn(process.execPath, [viteBin])` 绕过 `cmd.exe`，
> 所以 `kill()` 杀的就是真进程）。**其余探针脚本此前会残留孤儿 preview 进程占住端口**，
> 已单独修复；若你再新增探针，请照抄 `check-routes.mjs` 的 `startPreview`。
> 排查残留：`Get-NetTCPConnection -LocalPort <port> -State Listen`。

```bash
node scripts/dev/check-routes.mjs        # 12 条路由 + 深链刷新 + 移动端溢出
node scripts/dev/check-sandbox-flow.mjs  # 沙盘完整交互流程
node scripts/dev/browse.mjs /sandbox --shot=out.png
```

## 9. i18n 约定

- 文案表：`src/i18n/zh-CN.ts`、`src/i18n/en.ts`，键为扁平字符串，两表键集必须完全一致
- 使用：`const { t } = useI18n(); t('sandbox.tool.dig')`
- v2.0 要求：**沙盘模块全部文案在表内**；其余模块可留在代码里（v2.5 迁移）
- 沙具名称通过 `symbol.labelEn` 提供，缺失时回退中文

### 9.1 每条约定背后的两次事故

**一、字典里不许有没人用的键。**
`npm run audit:i18n`（在 `check` 里）会扫出所有零引用的键。
这条门禁是补上的，不是预防性的 —— 曾有 42 个键从未被 `t()` 引用，
其中 20 个是「文案齐备但功能根本不存在」的证据（录音、"另存为新会话"）。
**完整的文案会让人相信功能存在**，危害与幽灵字段完全相同。

处理原则不是「见到就删」：如果功能存在、只是标签写死在代码里，
就该把键接上去（`settings.renderer.*`、`settings.retention.*` 是这么办的）；
如果实际文案比键更具体（`toast.copied`「已复制」vs 实际「已复制号码 12356」），
接上反而是**降级**，应该删键。

**二、导出了 setter 不等于用户能用。**
`useI18n()` 一直导出 `setLocale()`，`App` 一直读 `locale` 切字典，
两套字典各 162 键 —— 但 `setLocale()` **零处调用**，
所以 `en.ts` 在运行时是死代码，用户永远只能看中文。

这类「第三阶幽灵」静态扫字段名查不出来：字段有读有写，hook 也导出了
setter，只有顺着调用链往上走一步才发现 setter 本身没人调。

因此 E2E 里那条语言断言是**跨页面**的：切到英文后回 `/sandbox`，
断言渲染器下拉框真的显示 "Layered tray (recommended)"。
只断言按钮 `aria-pressed` 的话，一个什么都不做的假实现也能过。

### 9.2 第四类幽灵：CSS 自定义属性

同一套「幽灵」（实现了但实际不起作用 / 声明了但没人用）的第四种形态，
在样式层。

`var(--x)` 指向一个从未定义的 token 时，浏览器**不报错、不进控制台、
不写 lint** —— 它把**整条**声明静默丢弃。于是：

- `tsc` 干净（CSS 不在类型系统里）
- 单测干净（jsdom 不算样式）
- E2E 干净（元素存在、可点、有文本）
- a11y 干净（对比度看的是最终计算值，恰好退回默认色仍达标）
- 人工看页面也干净 —— 因为退回默认值的样子不难看

v2.0 收尾对账，81 处引用、27 个未定义 token，包括**整条字号阶梯**
（`--fs-*`）、全部卡片阴影（`--shadow-1/2/3`）、胶囊圆角（`--r-pill`）。
沙盘工作台的圆角、阴影、字号从写下那天起就没生效过。

**约定：新增 `var(--x)` 前先确认 `--x` 已定义；确实需要可选时写 fallback
（`var(--x, 14px)`），检测器会放行。** `npm run audit:css` 在 `check` 里，
配 7 个用例的自检（`scripts/audit/css-tokens-self-test.mjs`）。

这条也补上了第二节「检测器自己也是门禁」的教训：检测器第一版只把
`global.css` 当定义源，把页面级局部变量全判成未定义。**假阳性和漏报
一样有害** —— 前者教人忽略告警，后者让人盲目放心。定义表必须全文件合并。
