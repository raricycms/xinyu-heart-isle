# 心屿 · 前端共享契约

> 本文档是并行开发的**唯一事实来源**。任何模块都不得修改本文件列出的「公共层」文件；
> 公共层由 Lead 维护。模块只能在自己的写入范围内新增/修改文件。

## 1. 技术栈与硬性约定

- Vite 8 + React 19 + TypeScript（strict）+ react-router-dom 7（`BrowserRouter`）
- **无后端**。所有数据写 `localStorage`，必须经过 `src/lib/storage.ts`
- **不引入任何新的 npm 依赖**（不装图表库、不装 UI 库、不装状态管理）
- 样式：`src/styles/global.css` 中的设计系统类 + 每个模块自己的 `.css` 文件。
  **禁止 Tailwind / CSS-in-JS / 内联大段样式**
- 中文排版：正文用 `var(--font-body)`，标题用 `var(--font-display)`
- 所有对外文案使用简体中文，语气温和、不说教、不诊断
- 每个页面必须有 `@media (max-width: 640px)` 下的可用布局
- 类型导入必须用 `import type`
- 未使用变量会报错（`noUnusedLocals` / `noUnusedParameters` 已开启）

## 2. 路径别名

`@/` → `src/`

## 3. 公共层（只读，禁止修改）

| 文件 | 作用 |
| --- | --- |
| `src/lib/types.ts` | 全部领域类型 |
| `src/lib/storage.ts` | localStorage 集合封装 + React 订阅钩子 |
| `src/lib/date.ts` | 日期格式化 |
| `src/lib/id.ts` | `createId`、`seededRandom` |
| `src/lib/utils.ts` | `cx`、`clamp`、`percent` |
| `src/lib/toast.ts` | `useToast()` |
| `src/components/ui/Button.tsx` | `Button`、`ButtonLink` |
| `src/components/ui/Card.tsx` | `Card`、`CardLink`、`SectionHead`、`PageHeader` |
| `src/components/ui/Primitives.tsx` | `Tag`、`Progress`、`Notice`、`Empty`、`Stat`、`TONE_LABEL` |
| `src/components/layout/AppShell.tsx` | 页头/导航/页脚 |
| `src/styles/global.css` | 设计系统 |
| `src/styles/app.css` | 外壳样式 |
| `src/App.tsx` | 路由表（**已固定，不可改**） |

### 3.1 路由表（已固定）

```
/                  HomePage
/scales            ScalesPage
/scales/:scaleId   ScaleRunPage
/sandbox           SandboxPage
/toolbox           ToolboxPage
/toolbox/:toolId   ToolRunPage
/resources         ResourcesPage
/records           RecordsPage
/safety            SafetyPage
/about             AboutPage
*                  NotFoundPage
```

### 3.2 存储层用法

```ts
import { moodStore, scaleResultStore, sandboxStore, toolSessionStore, journalStore,
         useCollection, usePreferences, setPreferences, STORAGE_KEYS } from '@/lib/storage';

// 写入（会自动通知所有订阅者）
moodStore.add({ id: createId('mood'), at: nowISO(), mood: 4, energy: 3, tags: ['平静'] });

// 读取（会自动重渲染）
const moods = useCollection<MoodEntry>(STORAGE_KEYS.moods); // 已按时间倒序
```

`useCollection` 返回的是**已缓存的不可变快照**，不要原地修改数组元素，统一用
`add` / `upsert` / `update` / `remove`。

> 注意：`useCollection<T>(key)` 的 `T` 必须与 `key` 对应的集合类型匹配，
> 否则会拿到错误结构。可参考下表：
>
> | key | 类型 |
> | --- | --- |
> | `STORAGE_KEYS.moods` | `MoodEntry` |
> | `STORAGE_KEYS.scaleResults` | `ScaleResult` |
> | `STORAGE_KEYS.sandbox` | `SandboxSnapshot` |
> | `STORAGE_KEYS.toolSessions` | `ToolSession` |
> | `STORAGE_KEYS.journal` | `JournalEntry` |

### 3.3 可用 CSS 类（摘要）

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

## 4. 模块写入范围（互不重叠）

| 模块 | 写入范围 |
| --- | --- |
| 量表 | `src/scales/**`、`src/pages/ScalesPage.tsx`、`src/pages/ScaleRunPage.tsx`、`src/styles/scales.css` |
| 沙盘 | `src/sandbox/**`、`src/pages/SandboxPage.tsx`、`src/styles/sandbox.css` |
| 工具箱 | `src/toolbox/**`、`src/pages/ToolboxPage.tsx`、`src/pages/ToolRunPage.tsx`、`src/styles/toolbox.css` |
| 资源与安全 | `src/resources/**`、`src/pages/ResourcesPage.tsx`、`src/pages/SafetyPage.tsx`、`src/styles/resources.css` |
| 首页与记录 | `src/pages/HomePage.tsx`、`src/pages/RecordsPage.tsx`、`src/pages/AboutPage.tsx`、`src/pages/NotFoundPage.tsx`、`src/styles/home.css` |

模块自己的 CSS 通过 `import '@/styles/xxx.css'` 在模块入口组件中引入（页面文件顶部）。

## 5. 安全与伦理红线（必须遵守）

1. **不做诊断**。量表结果只能表达为「分数区间 + 自我了解」，禁止出现「你有抑郁症」这类表述；
   必须出现「这不是诊断」的说明。
2. **不替代专业帮助**。结果页要有引导到 `/safety` 的入口。
3. **危机识别**。任何量表若出现高危分级（`tone === 'alert'`，或 PHQ-9 第 9 题 > 0），
   结果区必须显著展示求助入口 + 24 小时热线。
4. **数据不出本地**。禁止 `fetch`/`XMLHttpRequest`/`navigator.sendBeacon` 上报任何用户输入。
   唯一允许的 `fetch` 是用户主动点击的外链跳转（用 `<a target="_blank" rel="noopener noreferrer">`）。
5. 不收集姓名、手机号、身份证等可识别身份的信息。

## 6. 交付要求

- `npx tsc -b --noEmit` 必须零错误
- 不修改 `src/App.tsx`、`src/lib/**`、`src/components/**`、`src/styles/global.css`、`src/styles/app.css`、
  `package.json`
- 完成后在完成消息中列出：新增文件、写入的 localStorage 集合、依赖的公共 API
