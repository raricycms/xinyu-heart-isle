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

E2E、a11y、perf 依赖 `dist/`，必须先 `npx vite build`。三个脚本都会自己检查，
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

### E2E：10 场景 / 120 断言

> 断言数以 `npm run e2e` 输出的「合计：10 个场景，N 项断言」为准。
> 这里原写 107，实测 108；后来又补全了「全路由扫一遍」的动态路由
> （`/sandbox/session/:id`、`/sandbox/session/:id/report`、`/sandbox/clients/:id`、
> `/toolbox/:toolId`），断言数升到 120，覆盖 16 条路由。
> 那个场景原名叫「每个路由都能渲染」但只列了 12 条，而 `App.tsx` 有 15 条——
> 三条动态路由从没被验证过。**场景名里的「每个」是要能兑现的**。

| 场景 | 断言 | 关键点 |
|---|---|---|
| 首页 | 6 | 标题含「心屿」、正文 > 100 字、**首屏不加载 three** |
| 量表列表 | 9 | 5 个量表 slug 逐个查、筛选组有无障碍名 |
| 量表作答 | 14 | 深链接直开、说明页免责与计分口径、开始作答、键盘 1–4 |
| 沙盘渲染 | 13 | stage/toolbar/7 个工具/沙具库/canvas、**未加载 three** |
| 沙盘交互 | 8 | 点沙具计数 +1、脏标记、撤销/重做、事件流增长 |
| 沙面工具 | 8 | 7 个工具逐个点击 + 拖动，无 console 错误 |
| 记录页 | 3 | 渲染 |
| 安全页 | 5 | `tel:` 链接、12356、号码格式干净 |
| 深链接刷新 | 5 | `/sandbox/compare` 刷新后仍渲染、无 4xx 静态资源 |
| 全路由扫描 | 36 | 12 条路由，**每条都验证不是 404 兜底页** |

### a11y：5 个路由，**全部清零**

| 规则 | 数量 | 说明 |
|---|---|---|
| `target-size` | **0** | 曾 163/152 项，按高度聚类后统一 padding 修掉 |
| `color-contrast` | **0** | 曾 122 项；`--ink-400` 由 `#8b9497`(2.79:1) 改 `#515556`(5.5:1) |
| `form-label` | **0** | 两处缺 label 已补（`SandboxPage` textarea、`RecordsPage` file input） |

**基线已收窄到 `entries: []`（0 条），现在 `--strict` 也通过。**
这意味着门禁从「棘轮模式」升级为「零容忍模式」—— 任何新增 a11y 问题都会直接失败。

`prefers-reduced-motion` **已完全正常**，5 个路由在 reduce 模式下动效元素全部降为 0
（`53→0`、`34→0`、**`68`→0**、`28→0`、`60→0`）。

**审计结果必须可复现**，否则基线毫无意义。这一点踩过坑，见 §8 第 7 条。

---

## 4. 怎么加测试

### 4.1 加单元测试

文件放被测模块旁边：`src/scales/scoring.test.ts`、`src/lib/storage.test.ts`。
`vitest.config.ts` 的 `include` 是 `src/**/*.test.ts(x)` + `scripts/**/*.test.ts`。

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
- **样式与视觉**：无视觉回归测试。CSS 改动只能靠人看。
- **跨浏览器**：只在 Chrome 跑过。Safari / Firefox 未验证。
- **读屏实际体验**：a11y 审计是静态规则检查，不等于 NVDA / VoiceOver 实测。
- **键盘全流程**：仅验证了量表作答的 1–4 快捷键；沙盘全键盘操作是 CONTRACT §7
  的要求，目前只靠手工。
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

      # ---- 真浏览器门禁 ----
      - run: node --experimental-strip-types --no-warnings scripts/e2e/smoke.ts
      - run: node --experimental-strip-types --no-warnings scripts/audit/a11y.ts
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

- **先 build 再跑 E2E / a11y**，顺序不能反。
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

---

## 9. 待办

- [x] ~~修 §6.1 的 4 个缺陷，把对应 `it.fails` 改成 `it`~~ —— 全部修复，`it.fails` 已清零
- [x] ~~清 a11y 存量~~ —— **critical 0 / warning 0**，基线 `entries: []`
- [x] ~~补 `SandboxPage.tsx:496` 与 `RecordsPage.tsx:290` 的 label~~ —— 已补
- [ ] 装 CI（§7）—— 现在所有门禁都是绿的，可以直接接入
- [ ] 沙盘全键盘流程的自动化（CONTRACT §7 要求，目前手工）
- [ ] 跨浏览器验证（目前只在 Chrome 跑过）
