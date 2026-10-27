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

> 打包预算（**以 VISION §5.9 L344 为准**）：首屏 JS **gzip ≤ 200KB**（不含 3D 路由），
> `three` 必须落进独立 chunk 且 gzip ≤ 600KB。门禁：`npm run audit:budget`。
> 渲染器实现文件见 `src/sandbox/render/**`（各渲染器自己一个文件）。
>
> 早期这里写的是「主包 ≤ 175KB」，那是拍脑袋定的、且**没有任何门禁在量**。
> v2.0 实测首屏 145.8KB，看起来"达标"，但把 8 个页面全静态塞进了主包
> （其中 `ScaleRunPage` + `scales/data` 就占 55KB 源码）——再来两三个页面
> 就会越线，而所有测试仍然全绿。数字统一到 VISION，并且真的量起来。

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
- `npx vite build` 必须通过，且首屏 JS gzip ≤ 200KB（`three` 必须是独立 chunk）
- **`src/pages/SafetyPage.tsx` 必须保持静态导入**，不得改成路由懒加载
  （危机页不允许有加载延迟，见 VISION §5.6「≤2 次点击可达」）
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
>
> **2026-10 补记**：「首屏 JS」这一行原本写 `npx vite build 输出（实测 ~140KB）`。
> 但 `vite build` 只打印文件列表，**从不判定**，而且「主包」的定义模糊到
> 可以随便解释。结果就是：8 个页面全静态塞进主包，没人觉得有问题，
> 因为没人在看。现在有 `npm run audit:budget` 真的沿着静态 import 链
> 算一遍，并且带自测（`audit:budget:self-test`）证明它在该红时会红。

| 项 | 预算 | 验证方式 |
| --- | --- | --- |
| 首屏 JS gzip | ≤ 200KB（判失败线 210KB） | `npm run audit:budget`（实测 112.4KB；沿 index 的**静态** import 链累加，懒加载 chunk 不计） |
| `three` 不进主包 | 独立 chunk，首屏不请求 | `npm run audit:budget` + E2E 请求监听（双保险） |
| `three` chunk gzip | ≤ 600KB | `npm run audit:budget`（实测 130.8KB） |
| 危机页零延迟 | `SafetyPage` 不得被拆包 | `npm run audit:budget` 检查 dist 里没有 `SafetyPage-*.js` |
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

### 9.3 第五类幽灵：变换后的 `getBoundingClientRect()`

给沙盘加双指缩放/旋转（§5.7 P0）时，撞上第五种形态。它的特点是：
**API 没有说谎，是你对它的假设错了。**

`Element.getBoundingClientRect()` 返回的是**经过祖先 CSS `transform`
之后的包围盒**，不是布局尺寸。三种渲染器都用它来计算命中测试和
canvas 尺寸：

| 变换 | `getBoundingClientRect()` 的结果 | 危害 |
| --- | --- | --- |
| `translate` | 位置偏移，尺寸不变 | 归一化后抵消，**恰好无害** |
| `scale` | 尺寸按比例放大 | 分子分母同比，**归一化后仍正确** |
| `rotate(90deg)` | **宽高互换**（实测 802×601 → 601×802） | 除以了错误的边长，落点整体偏移 |

于是缩放"看起来完全正常"，只有旋转会坏 —— 而这正是最难排查的组合：
功能做了一半是对的，让你以为测量方式没问题。

**我在这里犯了第二个错误，更值得记。** 第一次修复时，我把**矩形**
逆变换回布局尺寸，然后拿屏幕点击点去和这个还原后的矩形做归一化。
在没有变换和纯旋转（中心附近）时全部正确。但纯缩放时：

> 放大 1.95 倍后，屏幕 75% 处的点，正确的沙盘坐标是 **0.628**，
> 而这个实现给出 **0.75**。

等于"缩放对命中测试毫无影响"。**中心点是变换的不动点**，所以只要测
中心附近的落点就永远是 0.5，什么也发现不了。

**正确做法：矩形和点必须映射到同一个坐标系。** 两者都用逆矩阵还原到
未变换空间，再在未变换空间里做归一化。且变换中心必须是**宿主**的中心
（`transform-origin: center` 的不动点），不是被测量元素自己的中心 ——
元素偏在宿主一侧时，用错中心会让逆映射整体平移。

**约定：在可能被 CSS `transform` 影响的祖先下测量几何时，一律用
`src/sandbox/view/measure.ts` 的 `measureSandboxGeometry()`，它同时给出
未变换 `rect` 和把屏幕点逆变换的 `pointer()`；**不要**单独拿
`measureSandboxElement().rect` 去和屏幕坐标做运算。** 目前
`dom2d` / `iso2d` / `three` / `SessionViewer` 四处均已改用它。

### 9.4 这一类的共性，以及为什么"自测"不够

第三、四、五类幽灵有同一个结构：**被测对象在门禁的视角之外。**

- 第三类（setter 没人调）：测的是组件，不是"谁调它"
- 第四类（CSS var 未定义）：测的是 DOM 树，不是"浏览器算出了什么"
- 第五类（变换后 rect）：测的是数学，不是"真实浏览器返回了什么"

第五类还额外教了一课：**测试里的期望值不能自己重算一遍。** 我第一版
`measure.test.ts` 复刻了一遍逆变换来算期望值，于是测的是"我复刻的那段
数学"。变异验证当场戳穿 —— 把产品代码的归一化改成忘记逆变换点，
**54 个测试全绿**。

改法是用假 `Element` / `window.getComputedStyle` 注入最小 DOM，
直接调用产品函数断言其返回值。同样一个变异，现在有 3 个用例变红。

> **如果一条断言在删掉被测代码后仍然通过，它就不是门禁，是护身符。**

配套验证手法：`tmp/mutate-view*.mjs` 是变异脚本模板 ——
故意改坏产品代码，确认对应断言**变红**，再还原。
新增门禁时至少做一次，否则无法区分"通过"和"恒真"。

### 9.5 第六类幽灵：写得很完整的死组件，和"差不多就行"的选取逻辑

v2.0 收尾做了一次「导出即功能」的对账，扫出一批**从来没有被渲染过**的组件。
它们有完整实现、有单测、被 `index.ts` 导出，所以在文件列表里看起来
就是已完成的功能。

判据（脚本 `tmp/find-dead-components.mjs`）：一个导出的组件名，若在
`src/` 下的**非测试**文件里只出现在 export 语句中，就是死组件。

一次扫出 7 个，处理分三类：

| 组件 | 判断 | 处理 |
| --- | --- | --- |
| `PromptPanel` + `prompts.ts` | 与 `symbols.ts` 的 `PROMPT_GROUPS` 是**两套并存**的引导语实现 | 删除重复的一套 |
| `AffectPicker` | 与 `SidePanels.tsx` 的 `SandboxAffect` 功能重复（后者是产品在用的） | 删多余的那个 |
| `SandboxCanvas` | 早期画布原型，已被 `render/` 三个渲染器取代 | 删除 |
| `PageHero` / `CardLink` | UI 库迁移后遗留，零引用 | 删除 |
| `PackManager` | v3.0 生态层的提前实现，是 `packs.ts` 的**唯一**产品调用方 | 保留 + 注释「未接入」 |
| `SurfaceWorkbenchExample` | 文件名就是 `usage.example` | 保留（示例非死码） |

**关键判断：同一功能有两套实现时，删"更好但不用的"而不是"更糙但在用的"。**
`AffectPicker`（113 行，受控、有 `readOnly` / `max` / `aria-pressed`）
明显比 `SandboxAffect`（27 行）完善，但产品用的是后者。
这时正确的做法是删掉前者 —— 保留两套并行实现，日后必然有人改错一边。
"删掉好的"听起来浪费，但两套实现同时存在的维护成本更高。

同一次对账还揪出一个**真 bug，和一个「差不多就行」的实现**：

`pickPrompts` 的取法原为 `pool[(seed*7 + i*3 + i) % total]`，
而 `i*3 + i` 就是 `i*4`。`after` 组 8 条，4 与 8 不互质，于是
i=0 与 i=2 命中同一下标：

```
seed 0 → 下标 [0, 4, 0] → 去重后只剩 2 条
```

用户视角是「结束后」这一档点「换一批」**永远只有 2 句话**。不报错、
不是空数组、页面完全正常。

更要紧的是它为什么能活这么久：**没有一条断言在看 `pickPrompts`。**
那条 `pool.length >= 5` 只能证明"池子里有 5 条"，不能证明"每次取得到 3 条"。
**数据充足 ≠ 行为正确，两者必须分开断言。**

修法：步长取与 `total` **互质**的数（互质则 `i ↦ 偏移 + i*步长` 在
`i < total` 时两两不同，去重永不丢条目）。补 `src/sandbox/prompts.test.ts`
12 条，其中「任何档位、任何种子都能取满 3 条」对旧实现有 **4 条**变红。

> **这一类的教训：文件存在、有测试、被导出，都不等于功能可用。**
> 只有"从用户入口能走到"才算。

### 9.6 第七类幽灵：恒真等待，和没人量的预算

这两条是同一天发现的，成因却完全相反 —— 一个**太像门禁**，一个**根本不像**。

#### 9.6.1 恒真等待：等一个永远存在的元素

v2.0 为了首屏体积把 8 个页面改成路由懒加载后，E2E 立刻红了 5 条：

```
✗ 语言切换按钮存在 — zh=false en=false
✗ 说明页说明计分口径 — 未找到计分说明
✗ 存在「开始作答」按钮 — 索引 -1
```

原因不是产品坏了，而是**等待写错了**：

```ts
await page.goto(`${BASE}/about`);
await waitAny(page, ['main', 'h1']);          // ← 立刻返回
const btn = await page.$('[data-testid="locale-zh"]');  // ← null
```

`AppShell` 自己渲染 `<main id="main">`（L114），所以**任何页面**一挂载
`main` 就为真。`waitAny` 等的是一个恒真条件 —— 等于**没等**，
断言时序全靠「chunk 下载得快不快」。

这类错误的危险在于它是**双向**的：

- 平时 chunk 快，测试绿 —— 于是没人发现等待是假的。
- CI 稍慢或网络抖动，测试红 —— 于是被当成产品 bug 去查，浪费一天。

而且它跟 §9.3、§9.5 一样，**删掉被测对象后门禁依然绿**：
把 `/about` 的语言按钮整个删掉，`waitAny(['main','h1'])` 照样通过。

**修法**：让「加载中」这个状态本身可观测。`RouteFallback` 加
`data-testid="route-loading"`，等待判据改成「这个标记消失了没」：

```ts
await page.waitForFunction(
  () => document.querySelector('[data-testid="route-loading"]') === null,
);
```

为什么不直接等目标按钮？因为那是**两件事**：等懒加载完成（通用）
和等页面内容正确（各页面自己的断言）。混在一起时，"按钮没出来"
无法区分是加载慢还是功能坏了。

**变异验证（这一步不能省）**：把 `lazyEl` 改成永远渲染骨架，
模拟懒加载卡死 —— 结果 **45 项失败、4 个场景崩溃**。
如果这时 E2E 还是绿的，说明等待机制根本没生效。

#### 9.6.2 没人量的预算

`docs/VISION.md` L344 写着「首屏 JS ≤ 200KB gzip」，
`docs/CONTRACT.md` §7 写着「主包 gzip ≤ 175KB」，
两处数字都不一致，而**没有任何命令在量**。§7 表格的"验证方式"一列
写的是 `npx vite build 输出（实测 ~140KB）` —— `vite build` 只打印文件
列表，从不判定，更不会因为超了而失败。

结果是：8 个页面全静态塞进主包，其中 `ScaleRunPage` + `scales/data`
就占 55KB 源码。实测首屏 145.8KB，**"离 175KB 还有 30KB，看起来挺安全"**
—— 其实再塞两个页面就越线，而所有测试仍然全绿。

更隐蔽的是「主包」这个词本身可以随便解释：只算 `index-*.js` 是
142.5KB，算上静态依赖链的 `jsx-runtime` 是 145.8KB，
把所有 chunk 相加是 211KB。**一个定义模糊的指标等于没有指标。**

**修法**：

1. 口径写死：**首屏 JS = 沿 `index` 静态 import 链能走到的所有 chunk
   的 gzip 之和**。`import("./x.js")` / `__vitePreload` 是动态加载，不算。
2. 加 `scripts/audit/bundle-budget.mjs`，四条判据：首屏 ≤ 200KB、
   three ≤ 600KB、three 不在主包、**`SafetyPage` 不得被拆包**。
   判失败线放到 210KB（留 5% 抖动），因为卡在 200.0KB 会让无关的
   依赖升级打红门禁，而真正要拦的是「又塞了一个页面」这种几十 KB 的量级。
3. 加 `audit:budget:self-test`：在临时目录造假的 dist，验证
   **超线时会红**。这条自测自己就抓到三个 bug（见脚本注释）：
   相对路径写死、压缩率估错两次、LCG 溢出退化成短周期。

> **这一类的教训：写在文档里但没人量的预算，不是预算，是愿望。**
> 而且判断一个指标有没有用，先看它**能不能红**；
> 不能红的指标，绿得再久也不说明任何事。

#### 9.6.3 顺带守住的一条线

拆分时很容易顺手把所有页面都懒加载 —— 那时体积数字更好看。
但 `/safety` 是危机页，CONTRACT §5 要求「任何页面 ≤2 次点击可达」。
给它加一层网络往返，等于在**最需要它的时刻**让它变慢甚至失败
（弱网/离线）。

所以 `audit:budget` 里有一条看起来跟体积无关的判据：
**`SafetyPage` 不得被拆包**。变异验证过：把它改成懒加载，
首屏从 112.4KB 降到 105.8KB（数字更好看），但门禁红。

> **体积预算不是最高优先级。安全红线不能拿性能指标交换。**

### 9.7 第八类幽灵：文档里的数字

前七类都在代码里，都能用同一招发现：**把被测对象拿掉，看门禁还绿不绿**。
这一类不行 —— 它在文档里。

`docs/VISION.md` §1.2 的评分卡自述是「本文的核心工具」，里面写着一串
具体数字：327 个沙具 / 24 个子类 / 6 大类 / 7 种笔刷 / 19 种事件。
这些是「v2.0 达成」这个结论的**全部支撑**。

但没有任何机制保证它们和代码一致：

- 删掉 50 个沙具 → VISION 依然写着 327
- 改成 6 种笔刷 → 评分卡依然写 7
- **所有测试仍然绿**，因为测试测代码，不测文档

它比前七类更危险，因为前七类至少有一个"东西"可以被删掉看看反应，
而文档层的错误**没有任何运行时痕迹**。一份写着"已达成"但实际没做的
评分表，比没有评分表更糟：它会让后来的人基于错误前提做决定。

**修法**：`scripts/audit/docs-numbers.mjs`（`npm run audit:docs`）。
从代码里数，和文档里写的比，不一致就红。

设计上有两个刻意的选择：

1. **不解析 Markdown 表格**。表格结构太脆，多一个空格、调一下列宽
   就失效，最后会退化成"解析失败就跳过"。改为把文档声称的数字
   作为**显式常量**写在脚本里，并注明出处行号。这样两边互相钉住：
   代码变了脚本红，想把脚本改绿就必须看一眼文档；文档变了脚本也得改，
   改的时候必须看一眼代码。
2. **自测用真仓库 + 定向变异**，不造假仓库（复制整个 `src` 太慢）。
   删一个沙具 → 必须红且报出 326；加一种事件 → 必须红且报出 20；
   还原 → 必须重新绿。

写这个脚本时踩到一个坑，正好也说明"数得对"比"数得到"更重要：
事件种类第一版用 `EventPayload = ([\s\S]{0,2000}?);` 匹配，
但联合类型第一个成员内部就有分号（`{ kind: 'item.add'; item: SandboxItem }`），
非贪婪匹配在那里就截断了 —— **只数到 1 个**，然后报出
「文档 19，代码 1」。如果我当时信了这个数字去改文档，就会把 19 改成 1。

> **这一类的教训：能被审计的才叫事实，否则只是叙述。**
> 而且当一个审计器给出反直觉的数字时，先怀疑审计器。
