# 测试与质量保障

> 面向：想加测试的人、要改 CI 的人、以及三个月后回来接手的人。
>
> 最后校准：2026-10，对应 v2.0。所有数字都是**实测**，不是目标值。
> 数字会随代码变化，发现对不上时请顺手更新本文件 —— 过期的文档比没有文档更糟。

---

## 1. 为什么这样分层

心屿没有后端，所有风险都在**客户端**。历史上「三绿但白屏」的事故都不是逻辑错，
而是引用稳定性、路径前缀、chunk 加载这类**只有真的跑起来才看得见**的问题
（见 `HANDOVER.md` §4 坑位清单）。

所以测试按「能在哪一层最早发现」来分层，而不是按「代码在哪个目录」：

| 层 | 工具 | 跑多久 | 抓什么 | 抓不到什么 |
|---|---|---|---|---|
| 单元 | Vitest（`environment: 'node'`） | ~5s | 计分、阈值、编码、迁移、纯函数边界 | DOM、样式、路由、真实渲染 |
| 性能 | Vitest（`performance.now()`） | 含在上面 | 笔刷复杂度、重放标度、编码体积 | 真实 FPS、绘制耗时 |
| E2E | puppeteer-core + 真实 Chrome | ~40s | 白屏、路由、SPA fallback、交互流程 | 视觉细节、跨浏览器 |
| a11y | puppeteer-core + 自实现对比度 | ~30s | 可访问名、标签、触摸目标、对比度 | 读屏实际体验、动效流畅度 |

**关键取舍**：单元测试环境是 `node`，**没有装 jsdom / happy-dom**。
因此 React 组件挂载、`useSyncExternalStore` 的引用稳定性这些事**不在这层测**，
而是在 E2E 层用真实浏览器兜住。不要为了测 hook 去装 jsdom —— 那会引入
一个和真实浏览器行为不一致的模拟层，反而给出虚假信心。

---

## 2. 怎么跑

### 全部

```bash
npx vitest run                    # 单元 + 性能
npx tsc -b --noEmit               # 类型
npx vite build                    # 构建 + 体积
node --experimental-strip-types --no-warnings scripts/e2e/smoke.ts
node scripts/visual-regression.mjs                # 视觉回归（见 §4.8）
node --experimental-strip-types --no-warnings scripts/audit/a11y.ts
```

> ⚠️ 这里曾经写「`npx tsc -b` **必须带 `--force`**」，理由是「增量缓存会在
> 只改测试文件时误判为无变化」。**这个说法经实测是错的**：
>
> ```
> 注入一个 TS6133 到 src/scales/scoring.test.ts
> npx tsc -b --noEmit          → error TS6133,  EXIT=2   ← 不带 --force 也能发现
> npx tsc -b --noEmit --force  → error TS6133,  EXIT=2
> ```
>
> 也就是说 `--force` 是多余的。而且 `package.json` 里 **没有任何 script 带
> `--force`**（`typecheck` / `typecheck:all` / `build` 都是普通 `tsc -b`），
> 所以这条文档和实际门禁**一直不一致**——按文档做反而和 CI 不一样。
>
> 教训：文档里凡是「必须/务必」的断言，都要亲手验证一次；
> 尤其是那种「不做会出隐蔽问题」的说法，它天然难以被证伪，
> 容易一代代传下去。

E2E、视觉、a11y、perf 依赖 `dist/`，必须先 `npx vite build`。四个脚本都会自己检查，
缺失时以退出码 2 明确报错，而不是静默跳过。

### 单个文件 / 单个用例

```bash
npx vitest run src/scales/scoring.test.ts
npx vitest run -t "危机判定"
npx vitest watch src/lib/storage.test.ts
```

### E2E 只跑部分场景

```bash
node --experimental-strip-types --no-warnings scripts/e2e/smoke.ts sandbox
node --experimental-strip-types --no-warnings scripts/e2e/smoke.ts --headed   # 看得到窗口
node --experimental-strip-types --no-warnings scripts/e2e/smoke.ts --keep     # 失败也留截图
```

### a11y 的几种模式

```bash
# 默认：棘轮模式，只有「基线之外的新问题」才失败
node --experimental-strip-types --no-warnings scripts/audit/a11y.ts

# 只看报告，不判定失败（了解全貌用）
node --experimental-strip-types --no-warnings scripts/audit/a11y.ts --report-only

# 零容忍模式：任何新增 critical 或 warning 都判失败
node --experimental-strip-types --no-warnings scripts/audit/a11y.ts --strict

# 修掉存量问题后收窄基线
node --experimental-strip-types --no-warnings scripts/audit/a11y.ts --update-baseline
```

> **为什么要 `--experimental-strip-types`**：Node 22 原生不支持直接运行 `.ts`
> （`ERR_UNKNOWN_FILE_EXTENSION`）。`--no-warnings` 只是压掉实验性警告，
> 不影响行为。之所以坚持写 `.ts` 而不是 `.mjs`：这两个脚本有 200+ 行选择器
> 与页面求值逻辑，类型错一次要跑 3 分钟才暴露；`.mjs` 拿不到任何检查。

---

## 3. 当前覆盖（实测）

### 单元 + 性能：17 个文件，547 passed（0 failed）

> ⚠️ **以 `npx vitest run` 的实际输出为准。** 这一行曾经写死「11 个文件，430 passed |
> 4 expected fail（434 个用例）」，并在下面补了一句「最后一轮已到 502 个」——
> 三次数字互相对不上，而当时实测是 **17 文件 / 547 用例 / 0 failed**。
> 硬编码的用例数每加一条测试就过期一次，是天然的假信息源；
> 保留它只会让人以为文档在骗人。**只有「0 failed」是必须守住的**，
> 文件数/用例数以命令输出为准。

| 文件 | 用例 | 说明 |
|---|---|---|
| `src/scales/scoring.test.ts` | 65 | **P0 债已清**。量程/反向计分/阈值边界/危机判定/文案红线 |
| `src/format/format.test.ts` | 69 | 校验器接受与拒绝、隐私红线（含深度扫描）、往返等价、v1 迁移 |
| `src/lib/storage.test.ts` | 46 | 损坏数据、配额溢出、快照稳定性、跨标签页、导入导出 |
| `src/lib/sessionStore-write.test.ts` | 9 | `saveSession`/`saveClient` 返回值真实（不静默丢数据） |
| `src/__tests__/perf.test.ts` | 41 | 笔刷、编码体积、重放、统计、dist 体积守卫 |
| `src/sandbox/events.test.ts` | 15 | 既有，未改 |
| `src/sandbox/surface.test.ts` | 26 | 既有，未改 |
| `src/sandbox/replay/replay.test.ts` | 54 | 回放 |
| `src/sandbox/library/*.test.*` | 60 | 沙具库检索 + 渲染 |
| `src/sandbox/archive/archive.test.ts` | 56 | 归档 |
| `src/sandbox/perf-scale.test.ts` | 5 | 重放标度回归守卫 |
| `src/sandbox/surface-*.test.ts` | 其他 | 笔刷交互、逐格着色、UI |

`it.fails` 已**全部清零**（曾 4 条，对应 4 个已确认缺陷，全部修复后转正）。

### E2E：12 场景 / 153 断言

> 断言数以 `npm run e2e` 输出的「合计：12 个场景，N 项断言」为准。
> 随着补齐覆盖，这个数字改过几次（107 → 108 → 120 → 141 → 153）：
> 先是补全「全路由扫一遍」的动态路由（`/sandbox/session/:id`、
> `/sandbox/session/:id/report`、`/sandbox/clients/:id`、`/toolbox/:toolId`），
> 覆盖 16 条路由；后又新增**移动端 390px** 场景（21 项）与
> **键盘全流程**场景（12 项）。
> 那个场景原名叫「每个路由都能渲染」但只列了 12 条，而 `App.tsx` 有 15 条——
> 三条动态路由从没被验证过。**场景名里的「每个」是要能兑现的**。

| 场景 | 断言 | 关键点 |
|---|---|---|
| 首页 | 12 | 标题含「心屿」、正文 > 100 字、**首屏不加载 three**、知情同意条可关闭且持久化、**语言切换真的换掉界面语言** |
| 量表列表 | 9 | 5 个量表 slug 逐个查、筛选组有无障碍名 |
| 量表作答 | 14 | 深链接直开、说明页免责与计分口径、开始作答、键盘 1–4 |
| 沙盘渲染 | 13 | stage/toolbar/7 个工具/沙具库/canvas、**未加载 three** |
| 沙盘交互 | **23** | 点沙具计数 +1、脏标记、撤销/重做、事件流增长、**年龄门**、**沙声开关**、**减少动效 / 轮廓模式真的作用到 DOM**、**沙具收藏写进 Preferences（读 localStorage 验证，不只信 ARIA）** |
| 沙面工具 | 8 | 7 个工具逐个点击 + 拖动，无 console 错误 |
| 记录页 | 3 | 渲染 |
| 安全页 | 5 | `tel:` 链接、12356、号码格式干净 |
| **移动端 390px** | **21** | 5 条路由 × (无横向滚动 + 无越界元素 + 触摸目标 ≥44px) |
| **键盘全流程** | **12** | 聚焦沙具 → 方向键换格 → Enter 放入 → 方向键移动摆件 → 事件流增长 |
| 深链接刷新 | 5 | `/sandbox/compare` 刷新后仍渲染、无 4xx 静态资源 |
| 全路由扫描 | 36 | 16 条路由，**每条都验证不是 404 兜底页** |

> **合计 178 项**。数字别再照着这里抄 —— 跑 `npm run e2e` 看实际值，
> 这份表的意义是「每个场景守什么」，不是「总数是多少」。
> 总数已经因为文档滞后错过四次（141 → 153 → 156 → 160 → 169 → 173）。

#### 键盘全流程：它抓到的真 bug，tsc 和单测都放行

`SandboxPage` 原来这么传 `onItemCommit`：

```tsx
onItemCommit={(id) => {
  const item = items.find((entry) => entry.id === id);
  if (item) api.commitMove(id, { x: item.x, y: item.y }, { x: item.x, y: item.y });
}}
```

只用 `id`，`from` / `to` 都填**当前坐标** → 「移动」被提交成原地不动。
`dom2d` 的 `handleKeyDown` 明明算好了新坐标（方向键 0.02 / Shift 0.1），
但唯一能落地的出口把它丢了。

为什么长期没被发现：

- **拖动路径掩盖了它** —— 拖动时 `onItemDrag` 实时改坐标，视觉上有反应；
- **`tsc` 放行** —— 少写参数在 TypeScript 里合法，不报错；
- **547 条单测放行** —— 单测测的是 `commitMove(id, from, to)` 这个函数本身，
  它是对的，错的是调用点；
- 只有键盘路径**没有中间态**，按了必须靠 `onItemCommit` 生效，于是完全失效。

> 这是「单元测试全绿但功能是坏的」的典型案例：测了函数、没测接线。
> 把原写法改回去，`npx tsc -b --noEmit` 依然 exit 0，而 E2E 立刻红：
> `✗ 方向键移动了摆件（style.left 变了） — 之前 "left: 45%…"，之后 "left: 45%…"`。
> 变异证据固化为 `scripts/audit/keyboard-self-test.mjs`。

#### 键盘全流程的能力边界（别当成全覆盖）

这条场景必须**先切到 `dom2d` 渲染器**才能走完，原因是一个真实缺口：

| 渲染器 | 摆件形态 | 键盘能否移动已放置摆件 |
|---|---|---|
| `dom2d` | 真实 `<button>`，`tabIndex=0` | ✅ 方向键 0.02 / Shift 0.1 |
| `iso2d`（默认） | `<canvas>` + `sr-only` 只读清单 | ❌ 无操作入口 |
| `three` | WebGL canvas + 降级清单 | ❌ 无操作入口 |

所以现状是：**键盘用户能做完整流程，但要先主动把渲染器切成「简洁平面」。**
默认视图下只能用键盘放入摆件、无法调整位置。这个缺口已记入
`CONTRACT.md` §7 的「部分自动化」一栏，不假装已覆盖。

#### 移动端场景：断言写错的那个坑

这个场景第一次跑出 6 项失败，其中 **5 项是我的判据错了，只有 0 项是产品缺陷**：

- `/sandbox` 报「`.ss-toolbar__group` 溢出视口」→ 但 `.ss-toolbar` 是
  `overflow-x: auto` 的**横向滚动**工具条，子元素本来就该排在视口外。判据必须
  排除「在自己的滚动容器里」的元素。
- 5 个页面报「触摸目标过小」→ 我的选择器比 `a11y.ts` 粗（把 `input` 文本框、
  行内文字链接、1×1 隐藏 file input 都算进去了）。**两套标准 = 一个红一个绿**，
  是最消耗信任的分裂。对齐 `a11y.ts` 的豁免规则后归零。

更要紧的是**变异测试抓到了断言本身的 bug**：第一版用
`documentElement.scrollWidth > window.innerWidth` 判横向溢出。注入一个
500px 宽的 `div` 后：

```
window.innerWidth:      501   ← 被溢出内容撑大了（isMobile 的布局视口语义）
documentElement.scrollWidth: 501   ← 与上一行恒等
注入元素的 right:        500   ← 实际超出 390 屏幕 110px
```

基准会跟着被测对象一起变大，所以**这条断言永远不会红**。
改成写死 `TARGET_WIDTH = 390` 之后，同一变异立刻被抓到：

```bash
node scripts/audit/e2e-self-test.mjs
# M1 宽 500px 元素   → 命中「无横向滚动」=true exit=1 ✓
# M2 8×8px 按钮      → 命中「触摸目标」=true   exit=1 ✓
# 收尾（副本复原）    → exit=0 ✓
```

> 教训：**基准不能是被测对象自己的属性。** 这和「拿被测函数算出的期望值去断言它自己」
> 是同一类错误，只是发生在布局层，肉眼看不出来。

### a11y：15 个路由，**全部清零**

覆盖从 5 条扩到 **15 条**（对齐 `src/App.tsx` 的真实路由表）。此前只测 5 条，
所有动态路由（`:scaleId` / `:toolId` / `:id` / `:id/report`）**零覆盖** ——
补齐后立刻暴露出 4 个此前从未被量过的真实缺陷。

| 规则 | 数量 | 说明 |
|---|---|---|
| `target-size` | **0** | 曾 163/152 项；补齐路由后又发现 4 处（详见下表） |
| `color-contrast` | **0** | 曾 122 项；`--ink-400` 由 `#8b9497`(2.79:1) 改 `#515556`(5.5:1) |
| `form-label` | **0** | 两处缺 label 已补（`SandboxPage` textarea、`RecordsPage` file input） |
| `keyboard-unreachable` | **0** | 判据曾形同虚设，见下方「三条判据的变异证据」 |
| `heading-order` | **0** | 曾 1 项：两个呼吸工具 h1→h3 跳级 |

**补齐路由覆盖后暴露并修复的 4 个真实缺陷**（都在 `src/styles/**`）：

| 路由 | 缺陷 | 修法 |
|---|---|---|
| `/scales/phq-9` | 返回链接 62×**30.9px** | `.scale-run__back` 加 `min-height: 44px` + `margin-left: -8px` 抵消 padding |
| `/sandbox/clients` | 保留期 `<select>` 307×**41px** | `.archive-retention .select { min-height: 44px }` |
| `/toolbox/breathing-478` | 返回链接 78.7×**21.3px** | `.tool-back` 改 inline-flex + min-height |
| `/resources` | 外链 97×**23.9px** | `.res-link` 加 `min-height: 44px` |

以及 `/toolbox/breathing-478` 的标题跳级：`Breathing478.tsx` / `BoxBreathing.tsx`
的 `<h3>` 改 `<h2>`（它们直接跟在 `ToolShell` 的 `<h1>` 后面，用 h3 就是跳级），
`toolbox.css` 用 `.tool-explain h2, .tool-explain h3` 共享同一套视觉规格。

**基线已收窄到 `entries: []`（0 条），现在 `--strict` 也通过。**
这意味着门禁从「棘轮模式」升级为「零容忍模式」—— 任何新增 a11y 问题都会直接失败。

`prefers-reduced-motion` **已完全正常**，15 个路由在 reduce 模式下动效元素全部降为 0
（`53→0`、`34→0`、**`68`→0**、`28→0`、`60→0`、`95→0`、`19→0` …）。

#### 三条判据的变异证据（没有变异证据的规则等于没有规则）

三条判据都曾**恒真**——它们从来没红过，所以从来没有人知道它们在检查什么。
修完后每条都用「注入缺陷 → 必须红 → 还原 → 必须绿」验证过：

| 判据 | 变异 | 改前 | 改后 |
|---|---|---|---|
| `keyboard-unreachable` | `Button.tsx` 的 `<button>` 加 `tabIndex={-1}`（全站按钮 Tab 不到） | **EXIT 0 假绿** | EXIT 1，8 个 critical 并指名元素 |
| `reduced-motion` | `global.css` 的 reduce 媒体查询只让 `.btn` 响应 | **EXIT 0**（60→43 算"已响应"） | EXIT 1（43 > allowed 12） |
| 路由覆盖 5→15 | 撤掉 `.res-link` 的 `min-height` | 5 条路由下 **EXIT 0**（看不到） | 15 条路由下 EXIT 1（`97×23.9px`） |

这三条现在由 `scripts/audit/meta-self-test.mjs` 自动回归（6 条变异，
含一条**反向**验证：合法的 roving tabindex 组不得被误报）：

```bash
node scripts/audit/meta-self-test.mjs
```

它把 `dist` 复制到 `tmp/mut-dist/` 再注入，**全程不碰工作区的 `dist/`**。
这一点是踩坑换来的：最初直接改 `dist/index.html` 再恢复，恢复操作与并发的
`vite build` 撞车，读到过期 bundle，假报了 7 个根本不存在的
`keyboard-unreachable`。**变异测试必须跑在副本上，否则它会污染被测对象本身。**

#### roving tabindex：豁免必须做窄，否则规则又会变回橡皮图章

沙具库 327 个格子用的是标准 roving tabindex（整组一个 Tab 停点，组内方向键移动），
把每个 `tabindex="-1"` 都判违规会误报 327 个。但豁免写松了同样致命：

- ✗ **第一版**：向上找 6 层祖先，只要有 ≥2 个交互兄弟就豁免
  → 规则**再次恒真**，因为页面导航栏永远能凑出"组"。实测变异 M1 仍然 EXIT 0。
- ✓ **最终版**：向上最多 2 层找**直接兄弟**，且组内每个同类兄弟都**显式声明过
  `tabindex`**（= 由 JS 统一管理），才认定为合法 roving 组。

**已知边界**（写在代码注释里，不假装修好）：`role="application"` 内靠方向键/
程序化聚焦的可达性静态审不出来；roving 组内「只有一项坏、其余正常」的局部损坏
会漏掉（组内有一个 `tabindex >= 0` 即整组豁免）。这两条保留 `CONTRACT.md` §7 的手工核查。

**审计结果必须可复现**，否则基线毫无意义。这一点踩过坑，见 §8 第 7 条。

---

## 4. 怎么加测试

### 4.1 加单元测试

文件放被测模块旁边：`src/scales/scoring.test.ts`、`src/lib/storage.test.ts`。
`vitest.config.ts` 的 `include` 是 `src/**/*.test.ts(x)`。

**必须显式 import**，`globals` 没开：

```ts
import { describe, expect, it, vi } from 'vitest';
```

**用 `@/` alias**，不要写 `../../`：

```ts
import { scoreScale } from '@/scales/scoring';
```

### 4.2 一个测试要「可证伪」

这是本仓库对测试的**唯一硬要求**。反面教材：

```ts
// ✗ 凑数：断言了等于没断言
expect(typeof result).toBe('object');
expect(true).toBe(true);
expect(items.length).toBeGreaterThan(0);   // 空数组也能过？
```

正面写法 —— 先建立前提，再断言结论，让失败信息能定位问题：

```ts
// ✓ 先证明「总分低、分级是 good」这个前提成立，再断言危机仍然触发
const answers = { ...fillAll(phq9, 0), 'phq9-9': 3 };
const result = scoreScale(phq9, answers);
expect(result.total).toBe(3);                    // 前提
expect(result.levelId).toBe('phq9-none');        // 前提：分级是「无」
expect(result.tone).toBe('good');                // 前提：档位 tone 是 good
expect(detectCrisis(phq9, answers)).toBe(true);  // 结论：危机独立于总分
```

失败信息要带上下文，否则 CI 上只看到 `expected true to be false`：

```ts
expect(ms, `replayAll(4000) 耗时 ${ms.toFixed(2)}ms，超出 60ms 预算`).toBeLessThan(60);
```

### 4.3 加性能断言：三层策略

绝对耗时在 CI / 开发机 / 杀毒软件扫描下抖动可达数倍。卡死预算值会制造假失败，
最后所有人都会 skip 它 —— 那等于没有测试。所以用三层：

1. **量级断言**：留足余量（笔刷预算 4ms，断言 12ms）。
2. **标度断言**（最重要）：比较「小输入 / 大输入」的耗时比例，验证**算法复杂度**
   而不是机器速度。这类断言与硬件无关，不会 flake。
3. **契约守卫**：直接量字节数（gzip 体积、编码长度），完全确定、零抖动。

**标度断言的规模差要足够大**，这是踩过的坑。修复后重放耗时降到 0.14–1.27ms，
此时用「相邻翻倍 < 2.8」会得到 ×3.37 的假失败 —— 噪声主导。

正确做法是**跨 8 倍规模比较**（500 → 4000）：线性得 ~8 倍，O(n²) 得 ~64 倍，
差一个数量级，噪声淹没不了。阈值取 24（= 线性的 3 倍）。实测稳定在
×6.1–9.8，全量并行连跑 6 次无一次失败。

#### 采样器：预算断言用「最小值」，标度断言用「中位数」

这个区分不是风格偏好，是有原因的：

- **预算断言用最小值**（`bestMs`）。并行跑十几个测试文件时 CPU 被打满，
  任何一次采样都可能被调度抢占或 GC 打断 —— **干扰只会让耗时变长，
  永远不会变短**。所以最小值是对「这段代码本身多快」的无偏估计。
- **标度断言用中位数**。它比较的是两档的**相对**关系，用最小值会让分母
  贴近 0，比值反而失真。

实测教训：中位数版本跑 `computeSessionStats` 曾在并行负载下读到
**29.07ms / 预算 30ms**，只是运气好没红；最小值版本同机稳定在个位数。
把阈值放宽到 120ms 也能「修好」，但那等于把预算变成装饰 ——
问题从来不是代码慢，是采样把干扰算进去了。

同理，**不要用 `--no-file-parallelism` 解决 flake**：实测全量耗时从 ~5s
涨到 8.7–28.6s（波动 3 倍），用 3 倍不确定的耗时换一个假失败并不划算。

### 4.4 加 E2E 场景

在 `scripts/e2e/smoke.ts` 的 `scenarios` 数组里追加：

```ts
{
  id: 'my-scene',                    // 用于 CLI 筛选
  name: '人话描述这个场景测什么',
  run: async (page, errors, requests) => {
    await page.goto(`${BASE}/some/path`, { waitUntil: 'domcontentloaded' });
    await waitAny(page, ['[data-testid="something"]']);
    expectTrue('断言名（失败时会直接显示）', condition, `实际：${actual}`);
    expectTrue('无 console.error', errors.length === 0, errors.join(' | '));
  },
}
```

**选择器规矩（重要）**：只用三类稳定锚点。

| 可以 | 不可以 |
|---|---|
| `data-testid` | CSS class（`.scale-card` 等，会被重构掉） |
| `aria-label`、`[role=...]`、`a[href^="tel:"]` | DOM 层级（`div > div:nth-child(2)`） |
| 面向用户的中文文案（产品语言） | 内部变量名、i18n key |

懒加载页面**必须显式等 testid**，不能只等 `networkidle2`：

```ts
await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 20_000 });
```

> **`data-testid` 是跨模块契约。** 改名等于破坏性变更 —— 曾发生过
> `sandbox-lib-item` 被改成 `lib-item` 而使用方不知情，E2E 直接红。
> 改名之前先 grep 全仓，见 §8 第 11 条。

### 4.5 加 a11y 检查

规则写在 `judge()` 里，把「拿到原始数据」和「如何判定」分开：

- `auditPage()` 在页面内跑，只负责**采集**（尺寸、颜色、名字），返回原始数据；
- `judge()` 在 Node 侧，负责**判定**，阈值是可读的常量。

这样阈值可调、可读、可单独推理，也不会因为把逻辑塞进 `page.evaluate`
而踩到序列化边界（见 §8 第 10 条）。

汇报时按**根因聚类**，而不是把 152 条平铺出来：对比度按「前景 on 背景」聚合、
触摸目标按高度聚合。一屏能看完的 5 组，比 152 行更容易派活。
### 4.6 验证测试本身有效：变异测试

**测试全绿不等于测试有效。** 把源码改坏、测试还不红，那测试就是装饰。
`it.fails` 转正时我做了 5 次变异实验，都在改完后立即还原（`git diff` 确认无残留）。

做法：**只变异成「最可能被人改成的那个错误实现」**，而不是随便乱改。
乱改只能证明「测试会红」，而变异成真实错误才能证明「测试会拦住这个错误」。

#### 实验 1：`detectCrisis` 恒返回 `false`（危机检测完全失效）

```diff
- return typeof raw === 'number' && raw > 0;
+ return false;
```

结果：**4 条红**

```
× PHQ-9 第 9 题 = 1（最低阳性档）时返回 true
× PHQ-9 第 9 题 2 / 3 分时都返回 true
× 总分很低（3 分，落在 good 区间）但第 9 题 > 0 时，界面色调必须是 alert
× Infinity 被判为阳性（宁可误报不可漏报的保守方向）
```

#### 实验 2：按总分判危机（`HANDOVER §4.3` 明令禁止的写法）

```diff
- return typeof raw === 'number' && raw > 0;
+ const total = computeScore(scale, answers).total;
+ return total >= 20;
```

结果：**8 条红**

```
× PHQ-9 第 9 题 = 0 时返回 false
× PHQ-9 第 9 题 = 1（最低阳性档）时返回 true
× PHQ-9 第 9 题 2 / 3 分时都返回 true
× 总分很低（3 分，落在 good 区间）但第 9 题 > 0 时，界面色调必须是 alert   ← 关键
× 总分很高但第 9 题为 0 时不应触发条目级危机
× 缺答 / 非数字作答不会误判为危机
```

**这是最重要的一个实验**：它变异成「最可能被人改成的那个错误实现」，
而红线测试**两个方向都锁住了** —— 该报必报（总分低但第 9 题 > 0），
不该报不许误报（总分高但第 9 题 = 0）。只锁一个方向的测试是半个测试。

#### 实验 3：`saveSession` 无条件 `return true`（静默丢数据）

```diff
- return sessionStore.upsert(session);
+ sessionStore.upsert(session);
+ return true;
```

结果：`sessionStore-write.test.ts` 全红（9 条）。这个缺陷的真实后果是：
配额满 / 隐私模式时数据没写进去，但页面弹「沙盘已保存在这台设备上」，
用户关掉页面就永久丢了，**而且他不知道自己该重试**。

#### 实验 4：把统计里的「倒查最后一条 stroke」改回 `replayAll`（还原缺陷 B）

```diff
- : deserializeSurface(lastSurfaceEvent(events)?.payload?.after as SandSurface);
+ : replayAll(events).surface;
```

结果：`perf.test.ts` 的「统计耗时随事件数线性增长」**1 条红**。

#### 实验 5：修一条**形同虚设**的标度断言

这一条不是验证别人，是验证我自己写错的测试。

原断言 `fullMs < halfMs * 8 + 5`，实测 halfMs ≈ 1.67ms、fullMs ≈ 3.0ms：

```
阈值 = 1.67 * 8 + 5 = 18.4ms
线性实测            3.0ms
即使退化成 O(n²)    6.7ms   ← 仍然通过！
```

**它无法为它声称的目的失败。** 病根是「绝对余量 `+5` 在毫秒量级上豁免了一个数量级」。
修法：去掉 `+5`、两侧改 `bestMs`、阈值 3.5（2 倍输入下线性 ≈2、O(n²) ≈4）。
实测比值 1.48–2.37，稳。

修的过程中还发现兄弟断言有更深的错 —— 详见下面「测错维度」那段。

#### 从变异测试学到的三条

1. **`+5` 这类绝对余量是小规模计时的毒药。** 毫秒级断言里加常数余量，
   等于把阈值抬高一个数量级，必然失效。要么不带常数，要么用相对倍数。
2. **标度断言必须沿「真正驱动开销的那个维度」放大。** 我一开始把
   `computeSessionStats` 按**摆件数** 50→400 放大，结果耗时
   0.593 / 0.545 / 0.608 / 0.659ms —— **几乎完全平坦**，因为开销由 4000 条
   **事件**主导，摆件只是零头。改测事件数 500→4000 后信号才出来。
   判定方法：**先打表看单调性**，不单调的维度不能用来做标度断言。
3. **改完源码要立刻还原并 `git diff` 确认。** 变异测试的危险在于「忘了改回来」。

---

### 4.7 幽灵门禁：声称存在、实际不存在的验证

比「假测试」更严重的一类问题：**文档说「由 XXX 验证」，而 XXX 根本不存在。**

**案例**：`docs/CONTRACT.md` §7 的预算表里有一行

| 沙盘首屏可交互 | ≤ 1.5s（本地） | `scripts/audit/perf.ts` |

而 `scripts/audit/perf.ts` **从来没被创建过**。`npm run perf` 一直抛：

```
Error: Cannot find module 'C:\...\scripts\audit\perf.ts'
```

没有任何人发现，因为**没人跑它**。它是 package.json 里的一条 script、
是 CONTRACT 里的一行预算、是 HANDOVER 里「已验证」的一格 —— 三重背书，
但背后什么都没有。

#### 为什么它比「测试失败」危险

| | 测试失败 | 幽灵门禁 |
|---|---|---|
| 会有人看吗 | 会，红了就有人查 | **不会，绿的和不存在的在报告里长得一样** |
| 发现难度 | 低 | 高，需要主动去跑 |
| 危害 | 挡路 | **给人一种虚假的安全感** |

假测试（4.6 的实验 5）是「测试在跑但结论无意义」，幽灵门禁是「连跑都没跑」。
两者是同一根藤上的瓜：**验证的可信度不能靠「文件存在」推断，只能靠「跑过并且见过它红」。**

#### 怎么防

1. **每条门禁都要亲眼见它红一次。** 新建门禁后立刻做一次变异：
   把阈值改到不可能满足，确认 exit code 变成 1，再改回来。
   我对刚补的 `perf.ts` 就是这么验的：

   ```
   变异：HARD_LIMIT_MS = 1
   结果：✗ 首屏可交互 /sandbox  519ms（三次 563/519/533）  判失败线 1ms
       合计：1 项预算，1 项超预算
       exit 1
   ```

   改回来后再跑一次确认 exit 0 —— **两个方向都验过，才算这条门禁存在。**

2. **`npm run check` 必须把每条门禁都串进去。** 只写在文档里、
   不在 `check` 里的脚本，等于不存在（上面的 `perf.ts` 就是活例子）。

3. **文档升级为「可执行断言」。** 与其写「性能符合预算」，
   不如写「跑 `npm run perf`，exit 0」。前者无法证伪，后者可以。

#### 顺带修掉的东西

- 把 `npm run check` 从「typecheck + test + build」扩成
  「typecheck + test + build + validate + e2e + a11y + perf」，
  7 条门禁一次跑完，`exit 0` 就是全绿。
- `npm run validate` 不带参数时会打用法并 exit 1，所以 `check` 里
  必须传样本文件：`npm run validate -- samples/example.sandplay.json`。

#### 4.7.1 幽灵门禁的其他六种变体

补 `perf.ts` 之后我把 `scripts/dev/` 和 `docs/` 全扫了一遍，又挖出 6 处
「在跑、但结论不可信」的门禁。它们和「文件不存在」是同一根藤上的瓜，
但更隐蔽，因为**它们都是绿的或者红得莫名其妙**。

**变体一：断言目标消失（选择器/路径失效）**

`scripts/dev/check-surface-a11y.mjs` 一直在查 `.wb-surfacebar` ——
那是 Lead 早期写在页面里的**内联**工具条。后来它被抽成
`SurfaceToolbar` 组件（`.ss-toolbar`），内联版整体删除。
于是这一段永远返回 `null`、永远判「工具条不存在」，
7 条 a11y 断言长期空转。

> **规避**：断言绑在**跨模块契约**上（`data-testid`、npm script 名、
> 导出的函数签名），不要绑 CSS 类名或内部文件路径。类名会随重构改，testid 不会。

**变体二：表单控件被静默 clamp（最阴的一个）**

`verify-visual-criteria.mjs` 和 `probe-wet-visible.mjs` 都把滑杆设成
`'0.35'` / `'1'` —— 那是**旧版内联工具条**的取值域。
换成组件后两个 range 都改成了整数域：

| 滑杆 | min | max | step |
| --- | --- | --- | --- |
| `sandbox-tool-radius` | 2 | 35 | 1 |
| `sandbox-tool-strength` | 10 | 100 | 5 |

于是 `'0.35'` 和 `'1'` **被浏览器 clamp 到各自最小值**（2 和 10），
等于把笔刷调到**比默认还弱**（默认 12 / 60）。表现是「湿沙压暗」
只测出 9.8%、低于 12% 阈值而判失败 —— 看起来完全像渲染退化，
实际是测试脚本自己把参数调小了。修正取值后是 **37.5%**。

> **规避**：`<input type="range">` 被 clamp 时**不报错、不警告**，
> 只是悄悄按最小值跑。设置值之后必须**回读并断言没被 clamp**：
>
> ```js
> setter.call(el, String(v));
> return Number(el.value) === Number(v);   // false 就是被 clamp 了
> ```
>
> 排查方向被这个问题带偏过一整轮：我一开始以为是 LIFT_RATIO 渲染退化。

**变体三：检查语义漂移（选择器还在，含义变了）**

`makeReset()` 点的是 `[data-testid="sandbox-tool-flatten"]`。
老版本里 `flatten` 是「铺平/重置」按钮；新版本里它是**第 7 个笔刷**
（⬜ 重新铺沙）——点它只选中一个笔刷，**不会重置沙面**；
真正的重置是 `sandbox-tool-reset`，而且带二次确认弹窗。

后果：A 阶段喷的水、B 阶段推的沙全都累积，量到的是「旧残留 + 新起伏」。
历史记录里那个 10.5% 的对比度是**虚高**的，从干净基准面重测只有 2.3%。

> **规避**：testid 名字里带动作语义（`flatten`/`reset`/`clear`）时，
> 重构后要重新确认它到底是哪个按钮。名字不等于行为。

**变体四：指标方向反了（只在「更差」时通过）**

B4 原本断言「沙脊区域亮度极差 `max - min` > 8」。
大力笔刷（半径 30 / 力度 100）涂 6 遍后，沙脊已经被推成一个**平坦的亮台**，
台面内部几乎没有起伏 → 极差只有 5.0，判失败。

但截图里那条亮脊和那道暗沟清清楚楚 —— **效果越好反而越判失败**。
人眼看到的「纵向位移」不是区域内的亮度抖动，而是
**这块地方相对周围地面被整体抬高了**。改成测「相对基准面的亮度位移」后：
沙脊 +29.0%、沟 −22.9%，两个方向都远超 8%。

> **规避**：一个只在「效果更差」时通过的指标，**比没有指标更坏** ——
> 它会把后续优化往回拽。写完指标后问一句：这个方向对吗？

**变体五：基准数据没跟着重置（静默判错方向）**

同一个脚本的 `baseline` 直接复用了 A 阶段的 `drySample`（喷水**前**的干沙值），
但 A 阶段喷完水才 `makeReset`。重置确实恢复了沙面，可 `drySample` 这个
**数字**没跟着重测。数值差一点点时它不报错，会悄悄判错方向。

> **规避**：凡是「基准 vs 处理」的对比，基准必须在**处理开始前的同一时刻**采样。

**变体六：数量写死（把功能增强误报成回归）**

`check-surface-a11y.mjs` 断言「`=== 7` 个工具按钮」。
v2.0 加了第 8 个笔刷（`flatten`）时就红了 —— 而加笔刷是功能增强，不是回归。

> **规避**：数量断言用「≥N」表达下界意图，除非上界真的有业务含义。
> 写死相等时问一句：**多一个为什么是错的？**

#### 4.7.2 第二轮审计：七类更深的幽灵

上面六种都还是「断言写错了」。第二轮换了判据：**把被测对象整个拿掉，门禁还绿不绿？**
绿了，它就是幽灵。按这个判据又找出七类，全部已修并留了变异证据：

**甲、崩溃即假绿（最坏的一种，因为它不出现在任何失败计数里）**

`scripts/e2e/smoke.ts` 的场景 `catch` 只把异常推进 `results`，**不设 `hardFailure`**；
最终判据是 `failedChecks === 0 && !hardFailure`，而 `failedChecks` 由各场景的
`checks.length` 求和 —— 崩掉的场景一条 check 都没跑，贡献 **0 个失败**。

```
变异：在 records 场景首行注入 throw
修前：合计：10 个场景，105 项断言，0 项失败
      ✓ E2E 全部通过          EXIT 0     ← 一个场景彻底没执行，门禁照样绿
修后：合计：1 个场景，0 项断言，0 项失败，1 个场景崩溃
      ✗ 有 1 个场景没有跑完（其断言未执行，等于未验证）
      ✗ E2E 存在失败           EXIT 1
```

> **规避**：`catch` 里除了记录，必须**同时置失败标志**。凡是「按成功项求和」
> 的判据，都要问一句：少跑一项会让总数变小，还是会让失败数变大？
> 变小就是漏洞。

**乙、端口被谁占着都算通过（审计了别人的页面）**

`perf.ts` 里 `if (res.ok) break;` —— 只要 4319 端口上有人回 200，就认为
「自己的 preview 起来了」。用静态服务器在那个端口伺服一个假页面后：

```
修前：✓ 首屏可交互 /sandbox   20ms（三次 124 / 20 / 27）  0 项超预算 ✓   EXIT 0
修后：✗ 端口 4319 已被占用，无法确认被测对象是自己的构建产物   EXIT 2
```

`a11y.ts` 同一个病，而且更隐蔽：它会在**别人的页面**上跑无障碍检查并报「通过」。
更狠的手法是把 `lang` 改坏、同时在端口上挂一份**完好的** dist 副本 ——
指纹校验挡不住这种，所以最终修法是**起服务前先探端口**（`assertPortFree`）。

> **规避**：自起服务器的门禁，必须能证明「连上的是自己起的那个」。
> 判据按强度排序：端口预检 > 构建产物指纹 > `response.ok`（最弱，等于没判）。

**丙、预算写了但没有任何约束力**

CONTRACT §7 写「首屏 ≤ 1500ms」，`perf.ts` 里 `HARD_LIMIT_MS = BUDGET_MS * 3`。
于是 1574ms 的输出和 416ms 那次**长得一模一样**，都是 `✓ ... 0 项超预算` EXIT 0。

```
修前：✓ 首屏可交互 /sandbox  1574ms ... 判失败线 4500ms   0 项超预算 ✓   EXIT 0
修后：三级判定 —— ≤1500 通过 / ≤3000 打 ⚠ 但 EXIT 0 / >3000 EXIT 1
      ⚠ 首屏可交互 /sandbox  411ms  预算 300ms，已超预算  判失败线 600ms
      ⚠ 超过 300ms 预算但未达 600ms 失败线：本次判通过，但这属于性能抖动
      合计：1 项预算，0 项超预算（1 项超出预算但在容忍区间）   EXIT 0
```

> **规避**：文档里的每个数字都要能在代码里找到对应的判断分支。
> 「写了阈值但不约束行为」比没有阈值更糟——它让人以为有保护。

**丁、环境错误的退出码和真实失败混在一起**

`perf.ts` 缺 `dist/` 时裸 `throw` → 最外层 `exit(1)`，而 `a11y.ts` / `smoke.ts`
都是 `exit(2)`。CI 里「没构建」和「性能真退化」因此无法区分。

```
修前：EXIT 1（和性能退化同码）
修后：✗ dist/index.html 不存在：先跑 `npm run build`（退出码 2…）  EXIT 2
```

> **规避**：退出码是机器读的唯一信号。`1 = 被测对象有问题`，`2 = 环境不满足（压根没测）`，
> 两者必须能分开。

**戊、场景名里的「每个」没有兑现**

`smoke.ts` 有个场景叫「全路由扫一遍：**每个**路由都能渲染」，它列了 12 条，
而 `App.tsx` 有 15 条 —— 漏的正是所有动态路由
（`/sandbox/session/:id`、`/sandbox/session/:id/report`、`/sandbox/clients/:id`、
`/toolbox/:toolId`）。而且这条门禁**抓不住自己漏了**：

```
修前：12 条路由 → 36 项断言全绿
修后：16 条路由 → 48 项断言；注入 /sandbox/session/（缺少 id）
      ✗ /sandbox/session/ 命中真实路由（不是 404 兜底页）— 落到了 NotFoundPage
      EXIT 1
```

> **规避**：清单类断言要从**唯一真相源**推导，或者在注释里写明「必须与 App.tsx 同步」。
> 手写清单 + 名字里带「每个/全部/所有」= 迟早撒谎。
> 顺带一提：`/toolbox/breathing` 这种「看着像真的」的 id 也会被 404 兜底页吞掉，
> 直到你给列表项加一条「不得落到 NotFoundPage」的断言。

**己、测试文件存在，但测的是别的东西**

`docs/HANDOVER.md` 把计分引擎的门禁写成 `npx vitest run src/__tests__/`，
跑出来 `Tests 41 passed EXIT 0` —— 但 `src/__tests__/` 里只有 `perf.test.ts`，
grep `scoreScale|scoring|反向|危机` 一个都不命中。真测试在 `src/scales/scoring.test.ts`（65 条）。

> **规避**：录门禁命令时，顺手 grep 一下它**跑的文件里**有没有被测对象的名字。
> 「文件存在 + 命令能跑 + 结果是绿的」这三件事同时成立，也可能什么都没测。

**庚、文档把守卫记在了错的门禁名下**

`HANDOVER.md` 说主包体积「E2E 也断言了这点」，但 `smoke.ts` 里提到 gzip 的
只有一句**注释**，真正的断言在 `src/__tests__/perf.test.ts`。

> **规避**：写「由 X 验证」时，去 X 里搜一眼那个判据。记错门禁名比不写更糟 ——
> 有人想确认「体积真被守住了」时会去看 X，然后什么也找不到，最后还是选择相信文档。

#### 4.7.3 幽灵的第八类：门禁的**观测者**在干扰被观测者

这一类不是断言写错，也不是被测对象缺失，而是**门禁之间的隐式共享状态**。

`scripts/dev/check-routes.mjs` 曾被判定为「有 flake」：连跑 4 次，第 1 次绿、
第 2–4 次稳定红，且失败路由每次都不同：

```
run 1: exit=0  结果：全部通过
run 2: exit=1  结果：21 项失败
FAIL  /toolbox  net::ERR_CONNECTION_REFUSED at http://127.0.0.1:56308/toolbox
[preview 退出 code=4294967295]
```

排查过：页面顺序、端口冲突、内存、chrome 残留、`reload`、孤儿进程、`stdio: 'pipe'`
（这个确实是真问题，见下）……全部排除后仍然复现。

真正的原因：**并行工作的另一个角色（负责修 `scripts/dev/` 进程泄漏的队友）写了一个
「清理孤儿进程」的函数，在每个脚本跑前跑后都调用它**：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'vite\.js.*preview' } |
  Where-Object { $_.ProcessId -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

它按**命令行正则**匹配，不区分 PID 归属。于是我的 preview 在跑到一半时被它杀掉，
症状就是 `ERR_CONNECTION_REFUSED` + `code=4294967295`（被强杀的典型退出码）。
它停手后立刻复跑，**4/4 全绿**——`check-routes.mjs` 从来没坏过。

更值得记的是**次生污染**：那个队友的度量脚本用同一个模式扫进程来统计「残留数」，
于是把我正在跑的 preview 也算成了「它自己脚本泄漏的孤儿」——
**度量工具本身在制造它要度量的现象，同时冤枉自己的修复**。

> **规避**（三条，都写进团队纪律）：
> 1. **禁止按进程名 / 命令行模式杀进程。** 只杀自己 `spawn` 拿到的那个 `child.pid`：
>    `child.kill()` → 轮询 `child.exitCode` 等它真断气 → 兜底 `taskkill /PID <自己 pid> /T /F`。
> 2. **判断「有没有残留」要限定到自己的端口**（`Get-NetTCPConnection -LocalPort <port>`），
>    不要用全机扫描。全机扫描在并行环境下必然把别人的进程算进来。
> 3. **首选端口被占时换端口，不要杀占用者**（`pickFreePort(preferred)`）。
>    并行开发里「谁先占到就是谁的」是唯一不会互相破坏的规则。
>
> 还有一条元教训：**「这个门禁有 flake」这个判断本身也可能是假的。**
> 在归因到被测代码之前，先问：有没有别的东西在同一时刻动同一份资源？
> 我差点为此去改一个本来正确的脚本。

#### 4.7.4 幽灵的第九类：**修门禁的过程中，门禁在偷偷变绿**

这一轮 a11y 审计里出现了四次「同一个 bug 反复复活」，每次都是不同的原因，
但都属于同一类：**门禁的判据在「看起来合理」的方向上漂移，直到它再次恒真。**

**① 固定 sleep 读到异步渲染的中间态**

`reduced-motion` 的子检查用 `page.reload()` + 固定 `sleep(500)` 采样。
但路由是按需加载的 chunk，500ms 时 CSS 可能还没应用，于是量到初始态：

```
/sandbox           正常模式 3 个动效元素 → reduce 后 3 个   ← 假警告
```

用「采样到稳定为止」的方法（每 250ms 读一次，连续 3 次相同才采用，
8s 上限）重测，真实值是 **68 → 0**（完全正常）。
`/about` 更典型：单独跑稳定 `19 → 0`，整轮跑稳定假报 `3 → 3`。

> 教训：**任何「等一下再量」的断言，测的是等待时长，不是被测对象。**
> 需要的是「等到它稳定」，而稳定本身要被定义（连续 N 次读数相同）。

**② 稳定性签名漏掉了样式表**

`waitForStableDom` 原本只比对 DOM 节点数 / 文本长度。于是：

```
/sandbox/clients 保留期 <select> 量到 307×41px   ← 假阳性
```

41px 是**懒加载的 CSS chunk 还没应用**时的高度，真实值 190×44。
把 `document.styleSheets.length` 和累计 `cssRules.length` 加进签名后消失。

> 教训：**「DOM 稳定」不等于「页面稳定」。** 影响尺寸的是样式，不是节点。

**③ roving tabindex 的豁免写得太松，规则变回橡皮图章**

沙具库 327 个格子用 roving tabindex（`tabIndex={i === focus ? 0 : -1}`），
把每个 `tabindex="-1"` 都判违规会误报 327 个。第一版豁免「向上找 6 层祖先，
有 ≥2 个交互兄弟就放过」——结果**规则再次恒真**，因为页面导航栏永远能凑出"组"。
注入「全站按钮 `tabIndex={-1}`」的变异后，仍然 **EXIT 0**。

收窄到「向上最多 2 层找**直接兄弟**，且组内每个兄弟都**显式声明过 tabindex**」
之后，同一变异立刻 EXIT 1 并指名 8 个元素。

> 教训：**豁免逻辑是门禁最脆弱的地方。** 每写一个 `continue`，都要问：
> 这个豁免能不能被最普通的一张页面触发？能，它就是新的恒真。

**④ `process.exit()` 绕过 `finally`，而门禁报告「通过」**

`a11y.ts` 的 `waitForServer()` 在超时分支里 `process.exit(2)`。这会**立即终止进程**，
`finally` 里的 `stopPreview(preview)` 根本不执行 → preview 泄漏占着 4174 →
**下一次运行**在 `assertPortFree` 处报「端口已被占用」EXIT 2。

危险之处：**第一轮是绿的**。泄漏只在第二轮显现，而第二轮的错误信息指向环境，
看起来像「机器上有脏进程」，不像「门禁自己没收拾干净」。连续两轮才暴露：

```
run 1: exit=0  ...  4174 残留 1   ← 报通过，但留下了垃圾
run 2: exit=2  端口 4174 已被占用  ← 看起来像环境问题
```

修法：模块级 `livePreviews: Set` + `process.on('exit')`（Node 保证 `process.exit()`
会触发它，`finally` 不会），在钩子里用**同步** `spawnSync taskkill /T /F`
（exit 钩子里事件循环已停，异步子进程根本不会跑起来）。

> 教训：**`process.exit()` 是 `finally` 的盲区。** 任何会 `process.exit` 的模块，
> 清理逻辑都必须挂在 `exit` 事件上，而不是只写在 `finally` 里。
> 更一般的：**「单次跑通」不能证明清理正确，要连跑两次。**

#### 变异测试必须跑在副本上，否则它会污染被测对象

这一条独立成段，因为它造成了一次**长达半小时的假故障排查**。

为了验证 a11y 规则会不会真红，我写了脚本直接改 `dist/index.html`（注入 `<script>`），
跑完再恢复。某次恢复操作与并发的一条 `vite build` 撞上，`index.html` 被写成了
**旧 bundle hash**（`index-ona4T-I6.js`），而 `assets/` 里已经是 `index-CC-iJE1F.js`。
紧接着的两次审计因此加载了过期资源，报出 **7 个根本不存在的 `keyboard-unreachable`**：

```
[/scales/phq-9] keyboard-unreachable: <button ... tabindex="-1" class="btn btn--lg">开始作答</button>
[/sandbox]      keyboard-unreachable: <button ... tabindex="-1">新建沙盘</button>
… 7 条
```

源码里**没有任何一处** `tabIndex={-1}`（grep 全 src 只有 2 处，都是 roving 的正常用法）。
用独立探针在同样的路由上量，**0 个** —— 这时才想到去比对 bundle 文件名。

> **规则**：变异测试必须在**被测目录的副本**上做。
> `scripts/audit/meta-self-test.mjs` 把 `dist` 复制到 `tmp/mut-dist/`，
> 通过 `XINYU_A11Y_DIST` 环境变量让审计指向副本（`vite preview --outDir`），
> **工作区的 `dist/` 全程只读**。
>
> 同样的错误在团队里还出现过一次：用 `git checkout` 把受版本控制的文件切回旧版做
> A/B 对比。这会让**磁盘状态与正在执行的代码不一致**，别人同时构建就拿到混合态。
> 正确做法是复制到 `tmp/ab-work/` 再改副本。

> **可观测的守卫**：副本方案之外，还要能**发现**读到的是过期产物。
> `meta-self-test.mjs` 的 `assertAssetsExist()` 会解析 `index.html` 引用的
> `/assets/*.js|css`，逐个确认文件存在；缺失就 EXIT 2 并直接说明
> 「index.html 与 assets/ 来自不同构建」。
>
> 这条守卫验证过会红：手工把 `dist/index.html` 的 bundle 名改成不存在的
> `index-DOESNOTEXIST.js`，自检立刻停在起点：
>
> ```
> ✗ 产物不自洽：dist/index.html 引用了不存在的资源：
>     index-DOESNOTEXIST.js
>   这说明 index.html 与 assets/ 来自不同的构建（多半是构建期间被并发改写）。
>   在这种产物上跑出的任何「规则命中」都不可信，直接重跑 npx vite build。
> exit: 2
> ```
>
> 这正是当初那 7 个假 `keyboard-unreachable` 的根因。有了这条断言，
> 同类故障从「半小时的源码排查」变成「一秒钟的产物检查」。

---

### 4.8 加视觉回归：为什么不用基线图

`docs/VISION.md` §7.4 的「视觉」一行要求「3 个场景 × 3 种摆法截图回归」。
落地时**没有**做常规的「提交基线 PNG，每次比对」。

#### 为什么放弃基线图

| 问题 | 具体表现 |
| --- | --- |
| 环境噪声 | 反锯齿在不同 Chrome / 显卡 / DPI 下差几个像素是常态。基线图会把「换了一台机器」变成红灯，最后所有人都学会忽略这个门禁 |
| 更新流程腐烂 | 基线必须人肉更新。一旦「红了就 `--update`」成为习惯，门禁等于不存在 |
| diff 噪声 | 仓库已有 21 张 `scripts/dev/shots/` 的图，再堆一批二进制基线，code review 里全是无法阅读的像素 |

#### 实际判据

`scripts/visual-regression.mjs`（`npm run visual`，已进 `npm run check`）
对 3 个场景各跑 **2 次**，逐像素比对：

| 场景 | 考什么 |
| --- | --- |
| 平沙 · 单摆件 | 基线：沙面无扰动 |
| 沙丘 · 埋沙摆件 | 山体遮挡、立面（`cell.wall`） |
| 密集 · 多摆件重叠 | z-order 与阴影，4 个摆件前后重叠 |

每个场景 5 条断言，加 1 条跨场景断言，共 **16 项**：

1. `symbolId` 都真实存在（解析 `src/sandbox/symbols.ts` 得到 327 个合法 id）
2. 两次渲染**逐像素一致**（容忍度 0）
3. 画面非空白（非透明像素 ≥ 2%）
4. 有明暗层次（亮度方差 ≥ 8）
5. 结构指纹稳定（FNV-1a over RGBA）
6. 三个场景画面**互不相同**

#### 第 1 条和第 6 条是写这个门禁时才发现的必需品

第一版种子写了 `tree / house / person / rock`。其中 `person`（真名 `man`）
和 `rock`（真名 `stone`）**根本不存在**。页面不报错，只是把不认识的
symbolId 渲染成灰色占位字形 —— 于是「密集」场景和「平沙」看起来差不多，
而所有断言照样全绿。

同一轮还犯了第二个错：会话种子字段名写成 `createdAt` / `cursor`，
事件时间写成 `at` / `seq`。而 `coerceSession`（`src/format/migrate.ts`）
认的是 `at` 与 `t`，校验不过就返回 `null`，被 `listSessions` 过滤掉，
页面拿到的是**空白沙盘**。三个场景渲染出**完全相同的画面**，
而「逐像素一致」「非空白」「有层次」全部通过。

这两次都是同一个病灶：**断言只验一致性，不验「我测的还是我以为的那个东西」**。
所以第 1 条（引用完整性）和第 6 条（场景间差异性）不是锦上添花，
是这两类幽灵的专用捕手。

#### 变异证据

`scripts/audit/visual-self-test.mjs`（`npm run visual:self-test`，CI 跑）：

| 变异 | 应命中的断言 | 结果 |
| --- | --- | --- |
| V1 每 100ms 往 canvas 撒 400 个红点 | 两次渲染逐像素一致 | ✓ exit 1 |
| V2 每 60ms 用底色覆盖整块 canvas | 三个场景画面互不相同 | ✓ exit 1 |

#### 顺带修掉的真实缺陷：`launchPreview` 静默忽略 `distDir`

写变异测试时发现它**抓不到任何问题**。根因不在被测代码，在工具本身：

```js
// scripts/dev/_shared/preview.mjs（修复前）
export async function launchPreview({ port, distDir = 'dist', cwd } = {}) {
  if (!existsSync(resolve(cwd, distDir))) throw ...;   // ← distDir 只用在这里
  const child = startPreview({ port, cwd });           // ← 没传下去！
```

`distDir` 只被存在性检查用了一次，**从未传给 vite**。于是变异测试传
`tmp/mut-dist-xxx`，检查通过了，实际服务的还是默认 `dist/` ——
注入的缺陷从没被加载，变异测试稳定地「抓不到问题」，而报错会显示成
「断言没命中」，看起来像被测代码的毛病。

修复是加 `extraArgs: ['--outDir', resolvedDist]`。这个坑的教训不是
「记得传参数」，而是：**一个静默忽略的参数比没有这个参数更危险**，
因为调用方以为自己控制住了。

> 还有一处连带修复：`existsSync(join(cwd, distDir))` 对绝对路径会拼出
> `C:\...\zhh\C:\...\zhh\dist`。改成 `resolve`，两种形式都对。

#### 这个门禁的边界

它**不是**像素基线回归。抓不到「重构后画面整体偏了 2px」「配色微调了
一个色号」这类纯视觉漂移 —— 那需要基线图 + 人眼，本项目没做。
它能抓的是非确定性渲染（随机数、未初始化缓冲、竞态、记忆化失效）
和「画面结构变了」（场景互不相同、指纹变化）。

---

### 4.9 渲染性能：别用 rAF 帧间隔去断言帧率

VISION §7.4 的性能一行要求「3D 路由、100 个摆件、帧率与内存」。
最直觉的写法是量 `requestAnimationFrame` 的帧间隔然后要求 ≥30fps。
**实测证明那个断言是恒真的**：

```
100 个摆件在场，同一页面连续 5 轮 × 120 帧
  第 1 轮  中位 6.0ms  p95 6.1ms  ≈166.7fps
  第 2 轮  中位 6.0ms  p95 6.1ms  ≈166.7fps
  ...
  第 5 轮  中位 6.0ms  p95 6.6ms  ≈166.7fps
  中位数跨度：0ms
```

`iso2d` 是**按需重绘**（`useEffect` 里画一次），稳态下根本没有 rAF 循环。
6.0ms 是 headless Chrome 合成器的空转节奏，换台慢十倍的机器还是 6.0ms。
拿它证明「移动端 ≥30fps」等于什么都没证明。

#### 改成断言什么

`scripts/render-perf.mjs`（`npm run perf:render`，已进 `npm run check`）
量的是**一帧画完要多少 CPU 时间**：100 / 400 个摆件，各 30 次采样，取 p95。

| 摆件数 | 实测 p95 | 占 30fps 单帧预算（33.3ms） |
| --- | --- | --- |
| 100 | 0.4ms | 1% |
| 400 | 2.4ms | 7% |

断言线是 **8ms**，不是 33.3ms —— 一帧里还有沙面绘制、命中测试、React 更新，
给同帧其他工作留 4× 余量。

还有一条**标度断言**：摆件数 4 倍时耗时增长必须 < 20 倍。绝对值受机器速度
影响，标度不受。如果哪天有人把绘制写成 O(n²)（比如每个摆件都重排整个数组），
绝对值可能仍在预算内，标度会先崩。

#### 三个容易踩的坑（都真实踩过）

1. **`ctx.fill()` 之后立刻 `performance.now()` 量到的不是绘制耗时**。
   canvas 命令只是入队，真正光栅化是异步的。必须加一句
   `ctx.getImageData(0, 0, 1, 1)` 强制同步结算，否则量到的是微秒级的
   「入队时间」，断言恒绿。
2. **变异注入的时机会晚于读取**。自检第一版用 `setTimeout(..., 1500)`
   改 DOM，而门禁在 1200ms 就读取了 —— 变异发生在读取之后，稳定地
   「抓不到」。变异脚本自己的时序错误和被测代码的缺陷长得一模一样，
   都是「断言没红」。改成持续轮询。
3. **破坏性正则匹配不到那段 DOM**。自检第二版按文本节点匹配
   `/\d+\s*件在场/`，还是抓不到。实测那段 DOM 是
   `<span>100</span><span> 件在场</span>` —— 数字和文字在**两个不同的
   文本节点**里，任何单节点上的正则都永远匹配不到。改成按叶子元素的
   `textContent` 改。

#### 边界

不覆盖 `three`（WebGL）：headless 下走 SwiftShader 软渲染，数字与真机
无可比性。不覆盖内存：`performance.memory` 需要 Chromium 私有 flag 且
波动极大，做门禁会变成随机红灯。

---

### 4.10 死开关：字段存在 ≠ 功能存在

`v2.0` 交付时，`Preferences.soundEnabled` 的样子是这样的：

```ts
// src/lib/types.ts
soundEnabled?: boolean;     // 沙盘音效开关（沙声/落沙声）

// src/lib/storage.ts
soundEnabled: true,         // 默认开

// 两套 i18n 都有
'settings.sound': '沙的声音',   // zh-CN
'settings.sound': 'Sand sounds', // en
```

**没有任何代码读过 `soundEnabled`。** 没有 UI 开关，没有音频实现。
它比「没做」更糟：读代码的人会以为有声音；写测试的人会以为那行
`default true` 有意义；做审计的人看到一个「已实现」的偏好字段。

这是幽灵门禁的**字段版本**：门禁的形态不一定是断言，也可以是
一个从不被读取的配置项。

#### 怎么把它挖出来的

不是靠读代码，是靠**反向搜索消费方**：

```powershell
# 搜索所有读 soundEnabled 的地方
Get-ChildItem src -Recurse -Include *.ts,*.tsx |
  Select-String -Pattern 'soundEnabled'
# → 只有 2 处：默认值定义、类型定义。零处消费。
```

对照组是 `reducedMotion` —— 同样在 `Preferences` 里，但它有 **8 处**
真实消费（`App.tsx` 写 `data-reduced-motion`、两个呼吸练习组件、
`SandboxPage` 传给渲染器）。同一份文件里的两个字段，一个是真的，
一个是死的。**对照搜索**比单点搜索更容易看出异常。

#### 修法

1. 实现：`src/sandbox/audio/sandSound.ts`，WebAudio 程序化合成，
   零音频资产（真实沙声采样动辄几百 KB，会挤爆 gzip 175KB 预算，
   且要进 `THIRD_PARTY_NOTICES.md` 资产台账）；
2. UI：工作台顶栏一个 `aria-pressed` 按钮（本项目没有设置页）；
3. 测试钉死三条契约（`sandSound.test.ts`，11 条）：
   - 开关关闭时**一次都不建 AudioContext**（资源契约，不是行为契约）
   - AudioContext 构造抛错时**不把异常抛给调用方**
   - `dispose()` 后不再发声、重复 dispose 不抛错
4. E2E 钉死「开关真的生效且持久化」（`smoke.ts` 沙盘交互场景 +3 断言）：
   点一下 `aria-pressed` 必须变，**刷新后必须保持** ——
   这一条才区分得开「写进偏好」和「只改了本地 state」。

#### 变异验证

| 变异 | 结果 |
| --- | --- |
| `createSandSound` 忽略 `enabled`，恒建 context | 单测 1 红 |
| `dispose()` 里删掉 `disposed = true` | 单测 2 红 |
| 按钮 `aria-pressed={true}` 恒真 | E2E 2 红 |

第三条变异第一版被 **TypeScript** 抓到了（`noUnusedLocals`：删掉
`setPreferences` 调用后它变成未使用导入），构建失败，E2E 实际跑的是
旧 `dist`，所以**看起来绿**。差点把「构建挂了」误读成「断言没抓到」。
变异测试必须确认构建成功，否则测的是上一个产物。

#### 顺着这条线，把整个 `Preferences` 翻了一遍

一个死开关通常不是孤例。用 `scripts/audit/ghost-fields.mjs`
（每个字段都必须有读有写）扫下来，`Preferences` 里 **8 个字段有 5 个是幽灵**：

| 字段 | 症状 | 处理 |
| --- | --- | --- |
| `soundEnabled` | 0 读 0 写。沙声是 VISION §5.1 的 P0 | **实现**（程序化合成，11 条单测 + E2E） |
| `acknowledgedAge` | 0 读 0 写。CONTRACT §7.7 明文要求年龄门 | **实现**（沙盘页提示，两条路都能关闭） |
| `acknowledgedDisclaimer` | 0 读 0 写。VISION §5.6「首次进入确认」 | **实现**（首页可关闭提示条） |
| `reducedMotion` | 有读无写：`App.tsx` 读它写 `data-reduced-motion`，呼吸练习也读，**但没有入口** | **补 UI**（工作台按钮） |
| `outlineMode` | 有读无写：`dom2d`/`iso2d` 都会画轮廓，**但没有入口** | **补 UI**（工作台按钮） |
| `sandboxUiMode` | 0 读 0 写。承诺「记住上次模式」 | **删除**（模式是每会话属性，不是全局偏好） |
| `nickname` | **有读无写**：`HomePage` 的问候分支永远为假 | **删除**（没有设置页，永远写不进去） |
| `renderer` | 有读、但只写进 `useState` —— 切换后刷新弹回默认 | **修**（切换时写回偏好） |

`reducedMotion` / `outlineMode` / `renderer` 这三个尤其值得记：

> **「无人写入」和「无人读取」一样致命，但更难发现。**
>
> 搜索字段名，你会看到 `App.tsx` 里有、两个渲染器里有、呼吸练习里有 ——
> 看起来是个活得很好的字段。只有把「读」和「写」分开数，才发现
> 那一堆全是读：用户**没有任何办法**把它设成 true。功能代码齐全，
> 入口为零。`nickname` 更隐蔽：唯一的读取点在一个永远走不到的分支里。

#### 检测器自己也是门禁，所以它也需要自检

写这个检测器的过程中，它自己坏过**两次**，两次都是假绿：

1. `collect()` 排除了整个 `src/i18n` 目录，而 `src/i18n/index.ts` 正是
   `const { locale } = usePreferences()` 所在处 → `locale` 被**误报**成幽灵。
2. 写入判定接受「任意对象字面量里的 `X: 值`」，于是 `Toolbar.tsx` 的
   类型声明 `outlineMode: boolean;` 被当成写入 → 把真正的
   `setPreferences({ outlineMode })` 删掉后，检测器**仍然报绿**。

第 2 类最危险：门禁永远绿，而它守的东西已经坏了。这正是本文件
§4.7 的主题 —— 检查器必须能证明自己会红。所以有了
`scripts/audit/ghost-fields-self-test.mjs`：G1 造一个无人读写的字段、
G2 造一个有读无写的字段、G3 用真实写法验证不误报，三条都必须在副本里跑
（`tmp/ghost-mut/`，工作区全程只读）。

G3 第一版断言「干净副本必须整棵树没有幽灵」，必然失败 ——
副本是刻意裁出来的荒地，其余字段当然没人用。断言要打在
**有意构造的那两个字段**上，否则测的是搭台子的脚手架。

#### 变异验证（本轮）

| 变异 | 结果 |
| --- | --- |
| 年龄门确认不写偏好 | E2E 1 红（仅「已持久化」那条，前 3 条仍绿 —— 说明分层正确） |
| 知情同意写错键（保持 `setPreferences` 被使用） | E2E 2 红 |
| `outlineMode` 改成写 `locale` | 幽灵检测器 1 红 |
| `reducedMotion` 改成写 `outlineMode` | E2E 3 红（打在 `<html data-reduced-motion>` 上，不是按钮上） |
| `setLocale` 无论点什么写回 zh-CN | E2E 2 红（含「切到英文后沙盘界面真的变英文」） |
| 删 `setPreferences` 调用（两次） | **`tsc` 先红，E2E 跑旧 dist 假绿** —— 必须换类型合法的变异 |

#### 第三阶幽灵：setter 存在，但没人调它

查完字段层面，顺手反查了一遍 i18n 字典，发现 **162 个键里有 42 个从没被
`t()` 引用过**（现在是 0）。顺着这条线挖到比字段幽灵更深的一层：

> `Preferences.locale` 在幽灵检测器里报的是 **「读 1 写 1 ✓」** —— 完全健康。
> 但它写入的唯一路径是 `useI18n()` 返回的 `setLocale()`，
> 而 **`setLocale()` 全仓库零处调用**。

于是：18 个组件接了 `useI18n()`、两套字典各 162 键、`App` 会读 `locale`
切字典 —— 全都实现了，用户却**永远只能看中文**，`en.ts` 在运行时是死代码。

这暴露了检测器的盲区：**它只数「谁调了 setPreferences」，不数「谁调了那个
包着 setPreferences 的函数」**。第一阶幽灵是「0 读 0 写」，第二阶是
「有读没写」，第三阶是「写函数本身是死的」。三阶都过静态扫字段名查不出来，
必须顺着调用链往上走一步。

修法：AboutPage 加语言切换（`setLocale` 终于有调用者），并加一条**跨页面**
的 E2E —— 切到英文后回 `/sandbox`，断言渲染器下拉框的文字真的变成
「Layered tray (recommended)」而不是「立体沙盘」。只断言按钮 `aria-pressed`
的话，一个什么都不做的假实现也能过。

#### 死代码：算出来但没人看

同一轮排查还顺着「零外部引用」把统计与场域模块扫了一遍。找到三处，
形态各不相同，但病根一致 —— **被计算、被类型标注，甚至被测试断言，
就是不被产品使用**：

| 位置 | 症状 | 处理 |
| --- | --- | --- |
| `stats.ts` `annotatedItemCount` | 有注释的摆件数，算了一整年，无一处 UI 展示 | 删。与 `noteCount`（写备注的动作次数）也不同义，但没有展示理由 |
| `surfaceOps.ts` `dugToBottomRatio` | **被一条单测断言过**，产品代码零读取 | 删字段，改断言真被展示的 `minHeight` |
| `surfaceCodec.ts` `fieldStats()` | 整个函数零调用，连测试都没有 | 删函数 |

第二条最值得记：那条测试的断言
`expect(...dugToBottomRatio).toBeGreaterThan(0)` **本身是对的**，它测的
「挖得足够深」也没错 —— 但它给了一个产品里看不见的字段「有人在用」的
错觉。测试可以成为幽灵的护身符。

删掉 `fieldStats` 时留了一段注释说明它和 `surfaceStats` 的区别：
两个函数看起来做同一件事，只有后者在链路上。留着前者，下一个改这里的
人会以为改的是产品行为。

#### 42 个 i18n 死键怎么处理的

不是一刀切删掉。按「有没有语义等价的实现」分三类：

| 类别 | 数量 | 处理 |
| --- | --- | --- |
| 有等价硬编码，且属于 i18n 范围（沙盘模块） | 7 | **接线**：`settings.renderer.*` → `RENDERERS[].labelKey`；`settings.retention.*` → 保留期下拉框；`sandbox.mode.*` → 记录单模式行 |
| 有等价硬编码，但实际文案更具体 | 15 | **删键**。`toast.copied`（"已复制"）vs 实际 `已复制号码 12356` —— 套上泛化键会**降低**文案质量 |
| 完全没有实现 | 20 | **删键**。这些是未兑现的承诺（录音、"另存为新会话"、设置页……），留着就是下一次幽灵 |

判断依据不是「删了省事」，而是：**一个没人读的键和一个没人读的字段，
危害完全相同** —— 它让下一个人以为功能存在。

删键用的脚本先做**预检**（每个键必须能被单行安全命中，否则拒绝写入），
因为 i18n 文件含大量中文，`-replace` 会毁掉编码。

`scripts/audit/i18n-dead-keys.mjs`（`npm run audit:i18n`，已进 `check`）+
`i18n-dead-keys-self-test.mjs`（9 个用例）。自检里特意有一条 I4：
`sandbox.sceneX.ghost` 不能被 `sandbox.scene` 的动态前缀覆盖 ——
前缀边界一旦写松，整个命名空间都会被判「在用」，检测器从此永远绿。

同一个脚本还守**字典自洽**：两表键集、顺序、占位符必须完全一致。
这条是删键过程的副产品 —— 删了 33 行键值对，每次都要担心
「zh 删了、en 忘了删」。少一个键的后果不是编译错误，而是英文用户
在那个位置看到中文，或者看到字面量 `settings.retention.days`。
类型系统看不见它（键是运行时字符串），只能由脚本守。
五个变异（少键 / 缺占位符 / 顺序错 / 重复键 / 对齐）全部有自检覆盖。

#### 第三类幽灵：CSS 自定义属性

`var(--x)` 指向一个从未定义的 token 时，浏览器**不报错、不告警、不动其它
声明** —— 它只是把**整条**声明静默丢弃，然后继续渲染。控制台干净、
`tsc` 干净、单测干净、E2E 干净、a11y 干净，页面看上去「就是那样」。
唯一能发现它的是静态对账。

v2.0 收尾时对账一次，结果是 81 处引用、27 个从未定义的 token：

```
--fs-xs/sm/size/base/lg/xl      整条字号阶梯
--shadow-1/2/3                   卡片阴影
--r-pill                         胶囊圆角
--dur-fast                       动效时长
--ink-1/2/3/4/600/800            文字层级
--watch-* / --clay-700           配色
--good-500 / --c-accent-soft     语义色
```

也就是说：沙盘工作台的圆角、阴影、字号**从写下那天起就没生效过**，
一直是浏览器的默认值。它不难看 —— 正因为不难看，所以两轮人工看页面
都没发现。

`scripts/audit/css-tokens.mjs`（`npm run audit:css`，已进 `check`）+
`css-tokens-self-test.mjs`（7 个用例）。判定规则只有一条：

> `var(--x)` 引用的 `--x` 若在任何 CSS 文件里都没定义，且**没有 fallback**
> （即 `var(--x, 兜底值)` 不算），就是缺陷。

写这个检测器时踩了两个坑，都记在自检里：

1. **定义表不能只看 `global.css`。** 第一版只把 `global.css` 当定义源，
   于是 `home.css` 里定义的 `--border`、页面级局部变量全被判成「未定义」。
   假阳性比漏报更有害 —— 它教人忽略告警。现在合并全文件定义。
2. **注释里的 `var()` 必须排除**（用例 C4）。注释掉的一行代码不该判红。

七个用例覆盖：未定义无兜底判红 / 未定义有兜底放行 / 已定义放行 /
注释里放行 / 后文才定义放行 / 跨文件定义放行 / 双短横线名字放行。

---

## 5. 棘轮基线（a11y）

> **现状（v2.0）**：基线已收窄到 **`entries: []`**，当前审计 **critical 0 / warning 0**。
> 下面「287 项存量问题」是棘轮机制**建立时**的历史记录，保留它是为了说明
> 这套机制为什么这么设计；不要据此以为现在还有 287 条债。

### 问题

存量 287 项 a11y 问题（对比度、触摸目标）。如果审计脚本以「critical > 0」为失败条件，
它从加入 CI 的第一天起就是红的 —— 然后所有人都会加 `|| true` 绕过，等于没有。

### 做法

`scripts/audit/a11y-baseline.json` 记录当前所有问题。之后：

- **只有基线之外的新问题**才导致退出码 1；
- 修掉存量问题后，报告会提示「已修复 N 项，可用 `--update-baseline` 收窄」；
- 基线**只许变窄**：任何新增问题都是红的。

验证过这套机制真的会失败：手工从基线删掉一条 entry 后，退出码变 1。

### 更新时机

只在**有意改善**后运行 `--update-baseline`。不要为了让 CI 变绿而更新 ——
那是把棘轮拆了。

### 报告怎么读

报告按**根因聚类**输出，因为 287 条没法直接派活：

```
对比度根因聚类：
前景 rgb(139, 148, 151) on rgb(246, 243, 236)   出现 41 次  最差 2.79:1
前景 rgb(77, 125, 112)  on rgb(246, 243, 236)   出现 24 次  最差 4.23:1
```

改 2–3 个 CSS 变量就能清掉大部分。触摸目标同理按高度聚类（27.6 / 31.5 / 34.6px
都是同一个 padding 来源）。

---

## 6. 已知缺口与已确认的缺陷

### 6.1 曾经的 `it.fails`：**已全部转正（现存 0 个）**

> 全仓库 grep `it.fails` 现在是 **0 个**。下面这 4 条曾用 `it.fails` 锁定，
> 缺陷修完后已逐个改成普通的 `it`。留表是为了记录「这条债曾经存在过」。
>
> ⚠️ 本节标题原写「`it.fails` 锁定的缺陷（4 个，非跳过）」——那是旧状态。
> 一个说「有 4 个 fails」的文档，会让人去找 `it.fails` 然后一个都找不到，
> 反过来怀疑测试文件丢了。

| 位置 | 曾经的缺陷 | 修法（已落地） |
|---|---|---|
| `storage.test.ts` | `add()` 在配额失败时返回 `undefined`，调用方无法感知写入失败 | 返回 `{ ok, error }` 并在 UI 弹提示 |
| `storage.test.ts` | 配额抛错后内存快照含新记录、磁盘为 `null` —— UI 显示已保存，刷新丢失 | 写失败时回滚内存状态 |
| `storage.test.ts` | `storage` 事件只 `emit` 不 `invalidate`，跨标签页同步视觉上失效 | 一行：`invalidate(e.key); emit(e.key);` |
| `format.test.ts` | 隐私检查只扫 `session.meta`，`items[0].name` 这类泄漏不会被拦 | 把 `FORBIDDEN_FIELDS` 检查扩到 items / events.payload / 顶层 |

### 6.2 未覆盖的部分（诚实清单）

- **React hook 行为**：`environment: 'node'`，没有 jsdom。`useSyncExternalStore`
  的引用稳定性靠 `getPreferences()` 的 `toBe` + `getItemCalls` 缓存命中数间接验证，
  **不是**真实组件挂载。真正的白屏回归由 E2E 兜住。
- **样式与视觉**：有视觉回归门禁（`scripts/visual-regression.mjs`，见 §4.8），
  但它判的是**确定性**而不是「和基线图比」，所以**抓不到纯视觉漂移**
  （比如重构后整体偏移 2px、配色微调）。这类改动仍然只能靠人看。
- **3D 渲染器的运行时性能**：`three`（WebGL）路径没有性能断言。headless
  下 WebGL 走 SwiftShader 软渲染，帧时间比真机差一到两个数量级，
  断言它只会产出误导性的绿或误导性的红。`iso2d`（默认渲染器）的
  100 / 400 摆件绘制开销有门禁（`scripts/render-perf.mjs`）。
- **内存**：没有内存断言。`performance.memory` 需要 Chromium 私有 flag，
  波动极大，做成门禁会退化成随机红灯。泄漏特征由
  `brush.perf.test.ts` 的「后段不得比前段慢 3 倍」间接守。
- **跨浏览器**：只在 Chrome 跑过。Safari / Firefox 未验证。
- **读屏实际体验**：a11y 审计是静态规则检查，不等于 NVDA / VoiceOver 实测。
- **键盘全流程**：量表作答的 1–4 快捷键有单测；沙盘全键盘操作已进 E2E
  （`keyboard-flow` 场景，12 断言），但**只在 `dom2d` 渲染器下成立** ——
  默认的 `iso2d` 没有摆件的键盘操作入口。
- **IndexedDB 路径**：`src/lib/idb.ts` 的降级逻辑未单测（需要真实 IDB）。
- **Stress / 长会话**：MAX_EVENTS = 4000 的边界有测，但「连续使用 30 天、
  记录数上千」这类累积场景没有。

### 6.3 沙面编码体积：不是 bug，是预算口径

初版 CONTRACT §7 写「沙面编码 ≤ 8KB」，但沙面 payload 随笔画数**线性增长
（约 +430B/笔）**，20 笔就 8588B 超限。根因是 **RLE 只能压「连续同值」，
而笔刷留下的是平滑梯度**，相邻值几乎都不同 —— 每格一个 run，压缩率天然很低。

已拆成两条预算（见 CONTRACT §7）：

- 单次 `surface.stroke` 编码载荷 ≤ 8KB（实测 430–750B，余量极大）
- 会话级 `session.surface` ≤ 40KB（约 90 笔，实测 50 笔 19.4KB）

**不引入量化或 zlib**：40KB 在 localStorage 5MB 里占 0.8%，而换编码会破坏
已导出的 `.sandplay.json` 兼容性。这个「不优化」的理由比优化本身重要，
所以测试里留了一条 `编码体积随笔画数线性增长` 把该特性钉成事实 ——
将来谁想改编码，它会变红提醒回去同步文档。

---

## 7. CI

**已有 CI**：`.github/workflows/quality.yml`（Windows runner，Node 22）。
本节原来的标题是「CI 建议」，正文写「当前没有 CI（可选交付项）」——
只要没有 CI，所有门禁的最终执行者都只有「自觉」，
而审计已经证明「没人跑的门禁等于不存在」：
`perf.ts` 的判失败线松到 3× 预算、`smoke.ts` 场景崩溃会假绿，
两处都活了很久，因为从没人在干净环境里跑过它们。

CI 的步骤顺序就是 `package.json` 里 `check` 的顺序，两者必须同步改。
当前步骤：

```yaml
name: quality
on:
  push: { branches: [main] }
  pull_request:
  workflow_dispatch:
jobs:
  check:
    runs-on: windows-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci

      # ---- 类型（不需要 --force）----
      - run: npx tsc -b --noEmit
      - run: npx tsc -p tsconfig.scripts.json --noEmit

      # ---- 构建：必须先于 vitest / E2E / a11y / perf，它们都读 dist/ ----
      - run: npx vite build

      # ---- 测试 ----
      - run: npx vitest run
      - run: node --experimental-strip-types --no-warnings scripts/validate-session.ts samples/example.sandplay.json

      # 校验器必须能拒绝坏样例：只测「接受」不测「拒绝」等于只测了一半
      - name: 格式校验器（拒绝坏样例）
        shell: bash
        run: |
          set +e
          node --experimental-strip-types --no-warnings scripts/validate-session.ts samples/broken.sandplay.json
          code=$?
          if [ "$code" -eq 1 ]; then echo "✓ 正确拒绝（退出码 1）"; else echo "✗ 退出码 $code，期望 1"; exit 1; fi

      # ---- 幽灵字段（§4.10）----
      - run: node scripts/audit/ghost-fields.mjs --strict   # 每个偏好字段必须有读有写
      - run: node scripts/audit/ghost-fields-self-test.mjs  # 检测器自己会红吗

      # ---- 真浏览器门禁 ----
      - run: node --experimental-strip-types --no-warnings scripts/e2e/smoke.ts
      - run: node scripts/audit/e2e-self-test.mjs          # 移动端断言有效
      - run: node scripts/audit/keyboard-self-test.mjs     # 键盘断言有效
      - run: node scripts/visual-regression.mjs            # 视觉回归（§4.8）
      - run: node scripts/audit/visual-self-test.mjs       # 视觉断言有效
      - run: node scripts/render-perf.mjs                  # 100/400 摆件绘制（§4.9）
      - run: node scripts/audit/render-perf-self-test.mjs  # 渲染性能断言有效
      - run: node --experimental-strip-types --no-warnings scripts/audit/a11y.ts
      - run: node scripts/audit/meta-self-test.mjs         # a11y 规则有效
      - run: node --experimental-strip-types --no-warnings scripts/audit/perf.ts

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-screenshots
          path: scripts/e2e/screenshots/
          if-no-files-found: ignore
```

> ⚠️ **别在 CI 里给构造函数传 `--`。** `npm run validate -- samples/x.json`
> 里的 `--` 是 **npm 的分隔符**，npm 会把它剥掉再传参，所以能跑通；
> 但在 CI 里直接写 `node scripts/validate-session.ts -- samples/x.json`
> 会因为 `--` 被当成未知选项而报 `参数错误：无法识别的选项：--` 并退出 2。
> 我第一版 CI 就是这么写错的，幸好本地跑了一遍才发现。

注意事项：

- **先 build 再跑 E2E / 视觉 / a11y**，顺序不能反。
- E2E 失败时**必须上传截图**，否则无从判断是白屏还是断言写错。
- `--strict` 现在**可以**加进 CI：基线已收窄到 0 条（`entries: []`），
  `--strict` 与默认模式当前等价，正是切到零容忍的时机。
  这里原来写「不要加进 CI，存量债未清会一直红」——存量债早已清完，
  那句话让 `--strict` 变成没人敢用的开关，也就没人知道它其实已经能过。
- a11y 的 `--update-baseline` **不要**在 CI 里自动跑。

---

## 8. 踩过的坑（加测试前先看）

1. **PowerShell 会把中文写坏**。改含中文的源码**必须**用编辑器/`read`+`edit` 工具，
   不要用 `Set-Content` / `Out-File` —— 会加 UTF-8 BOM 或按 ANSI 转码，
   导致 `JSON.parse` 失败、lightningcss 构建失败（HANDOVER §4.1）。
   本仓库的 `a11y-baseline.json` 就被这样弄坏过一次，所以加载器现在会主动剥 BOM。

2. **`/scales/:scaleId` 首次进入是「作答前必读」说明页，不是题目页**。
   直接断言选项会拿到 0 个。必须先点「开始作答」。

3. **选项按钮点击后立刻翻页**，`option-row--active` 来不及被观察到。
   量表是「选完自动下一题」，正确的可观察信号是顶部「已答 N」+1。

4. **工具栏 `sandbox-save` 只是打开保存面板**，真正写入要点面板内的
   `sandbox-save-confirm`。搞混会误判成「保存坏了」。

5. **`process.exit` 的退出码会被 PowerShell 的 stderr 横幅掩盖**。
   判断成败看 `=== EXIT: N ===` 那一行，不要看 `npx.ps1` 抛的
   `NativeCommandError`。

6. **Windows 上 `spawn('npx.cmd')` 必须 `shell: true`**，且结束时用
   `taskkill /T /F` 连子进程一起杀，否则 vite 会留孤儿进程占住端口。

7. **审计结果必须可复现，否则棘轮基线没有意义。** 这条踩得最深：早期版本
   `sleep(900)` 后就开始审计，同一份代码连跑两次得到 **160 与 175** 两个数字。
   两个根因：

   - **长列表分批渲染**：沙具库有 327 个格子，抽样时可能只渲染了一半。
     修法是 `waitForStableDom()` —— 反复取「元素总数 + testid 集合」作为签名，
     连续 3 次相同才认为稳定。
   - **同一文案重复计数**：像「327 件」这种同时出现在标题和 `aria-label` 里的文本
     会被记两次，数量随渲染顺序抖动。修法是 `report()` 里按
     `路由|规则|文案` 去重。

   修完后连跑 3 次稳定在 152。**改完任何审计规则，务必连跑 3 次确认数字一致**
   —— 不可复现的数字会让人以为是噪声，然后习惯性忽略所有报告。

8. **`data-testid` 会被改名，锚点要留可诊断的失败信息。** 库模块重构把
   `sandbox-lib-item` 改成了 `lib-item`，E2E 立刻红了。这次是好事（说明锚点真的
   在测东西，而不是写死成永远通过），但断言信息要直接写
   `找不到 data-testid="lib-item"`，而不是「沙具格子存在」这种抽象描述。

9. **确认一条 a11y 规则「没发现问题」时，要先证明它会报问题。**
   对比度清零后我一度怀疑是判定逻辑坏了（毕竟从 139 条突然变 0 条很可疑），
   于是写了个一次性脚本渲染一段已知 2.79:1 的文字，确认算出来正好 2.79 且会被判
   不达标。**「零发现」和「规则失效」在报告上长得一模一样**，只能靠这种方式区分。

10. **`page.evaluate` 的回调会序列化后在浏览器里执行，不能引用 Node 侧任何东西。**
    这一条是真事故：有人把回调里的字面量 `44 - 1` 换成 Node 侧常量 `MIN_TARGET`，
    看起来是「消除魔法数字」的好重构，运行时直接
    `ReferenceError: MIN_TARGET is not defined` —— 因为外层作用域在浏览器里不存在。
    修法是在回调内用本地字面量，并加一道**编译期同步守卫**让两边永远一致：

    ```ts
    const MIN_TARGET = 44;             // Node 侧
    const BROWSER_MIN_TARGET = 44;     // 浏览器侧副本
    // 对不上 tsc 就报错，防止有人只改一边
    const _sync: typeof MIN_TARGET = BROWSER_MIN_TARGET;
    ```

    更广的教训：**用坏掉的工具跑出的「全绿」和「全红」一样不可信。**
    那次工具坏了以后，看到 exit 1 的正确反应不是去改代码让它变绿，
    而是先怀疑工具本身 —— 写个独立复算器验证规则到底还在不在。

11. **`data-testid` 是跨模块契约，改名等于破坏性变更。**
    库模块重构把 `sandbox-lib-item` 改成 `lib-item`，没有通知使用方，
    E2E 立刻红了。改名之前请先 grep 全仓：

    ```bash
    # 用编辑器全局搜索，或：
    Get-ChildItem -Recurse -Include *.ts,*.tsx,*.mjs src,scripts | Select-String 'data-testid'
    ```

    > ⚠️ 这里曾经写 `npx rg 'data-testid' -g '!node_modules'`。
    > **那条命令是个陷阱**：本仓库没有装 ripgrep，`npx rg` 会去 npm 下载一个
    > 同名但完全无关的包 `rg@0.0.2`（一个很老的脚手架），
    > 实际执行输出是 `README.md already exists. run with -f to overwrite` ——
    > 它想创建 README，根本不做搜索。
    >
    > 所以文档里写 `npx <工具名>` 之前，要确认那个包名在 npm 上就是你以为的工具。
    > ripgrep 的包名是 `@ripgrep/ripgrep` 或直接用编辑器搜索。

    发现改名时的正确反应是**更新锚点并让失败信息可诊断**
    （`找不到 data-testid="lib-item"`），**不是**放宽断言或加 `|| true`。
    顺便：E2E 红了不一定是坏事 —— 这次恰恰证明锚点在真的测东西。

12. **`getBoundingClientRect()` 返回的是「变换后」的包围盒，不是布局尺寸。**
    （CONTRACT §9.3 第五类幽灵）

    给沙盘加双指缩放/旋转时踩的。三种渲染器原本都用它算命中测试和
    canvas 尺寸：

    | 变换 | 结果 | 危害 |
    | --- | --- | --- |
    | `translate` | 位置偏移 | 归一化后抵消，无害 |
    | `scale` | 尺寸同比放大 | 分子分母抵消，**仍正确** |
    | `rotate(90deg)` | **宽高互换**（802×601 → 601×802） | 除以错误边长，落点偏移 |

    最坏的地方是**缩放正常、只有旋转会坏** —— 做对一半让你以为测量方式没问题。

    正确做法见 `src/sandbox/view/measure.ts` 的 `measureSandboxGeometry()`。
    两个必须同时成立的细节：

    - **矩形和点都要逆变换到同一坐标系**。只还原矩形不还原点，
      纯缩放时坐标完全错（放 1.95 倍后屏幕 75% 处应为 0.628，会算成 0.75）；
    - **变换中心要用宿主的中心**，不是被测量元素的中心 ——
      元素偏离宿主中心时，用错中心会让逆映射整体平移。

    ⚠️ 验证这个功能时**不要用 `page.click()`**（会滚动页面，sticky 导航吞点击），
    也**不要自己重算一遍期望值**（见下一条）。

13. **测试里不要重新实现一遍被测的数学。** —— 这条是「恒真断言」的根源。

    `measure.test.ts` 第一版复刻了一遍逆变换来算期望值，于是它测的是
    「我复刻的那段数学」，不是产品代码。变异验证当场戳穿：

    ```
    变异：把 measureSandboxGeometry().normalized() 改成忘记逆变换点
    结果：54 个测试全绿   ← 断言是护身符，不是门禁
    ```

    改法：用假 `Element` + 假 `window.getComputedStyle` 注入最小 DOM
    （`measureSandboxGeometry` 只用三样东西：`getBoundingClientRect`、
    `closest`、`getComputedStyle().transform`），直接断言产品函数的返回值。
    同样一个变异，现在有 **3 个用例变红**。

    顺带记录**验证精度时另一个坑**：`iso2d`（默认渲染器）是 Canvas 手绘，
    摆件坐标只存在于内存里，DOM 读不到。要观测坐标必须切到 `dom2d`
    —— 它把摆件渲染成绝对定位元素，`style.left/top` 就是归一化坐标。

    > **判据：如果删掉被测代码后断言仍然通过，它就不是门禁。**
    > 新增门禁时至少做一次变异验证（模板见 `tmp/mutate-view*.mjs`），
    > 否则无法区分「通过」和「恒真」。

---

## 9. 待办

- [x] ~~修 §6.1 的 4 个缺陷，把对应 `it.fails` 改成 `it`~~ —— 全部修复，`it.fails` 已清零
- [x] ~~清 a11y 存量~~ —— **critical 0 / warning 0**，基线 `entries: []`
- [x] ~~补 `SandboxPage.tsx:496` 与 `RecordsPage.tsx:290` 的 label~~ —— 已补
- [ ] 装 CI（§7）—— 现在所有门禁都是绿的，可以直接接入
- [ ] 沙盘全键盘流程的自动化（CONTRACT §7 要求，目前手工）
- [ ] 跨浏览器验证（目前只在 Chrome 跑过）
