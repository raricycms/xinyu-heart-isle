# 心屿 · 交接清单

> 本文档面向"接手这个项目的人"。它只写**需要你动手的地方**，不重复功能介绍。
> 产品设计、架构、路线图见 [`docs/PLAN.md`](./PLAN.md)；模块间约定见 [`docs/CONTRACT.md`](./CONTRACT.md)。

---

## 一、当前状态

> 核对于 v2.0（2026-10）。每条都给了**可复现的验证命令**，不要相信数字，请自己跑。

| 项目 | 状态 | 验证方式 |
| --- | --- | --- |
| 类型检查（应用） | ✅ 0 错误 | `npx tsc -b --noEmit` |
| 类型检查（脚本） | ✅ 0 错误 | `npx tsc -p tsconfig.scripts.json --noEmit` |
| 生产构建 | ✅ 通过 | `npx vite build` |
| 主包体积 | ✅ gzip **140.7 kB**（预算 175 kB） | 看上一条输出的 `index-*.js` |
| 单元测试 | ✅ 17 文件 / 546 用例全绿 | `npx vitest run` |
| E2E 冒烟 | ✅ 12 场景 / **153 断言** | `node --experimental-strip-types --no-warnings scripts/e2e/smoke.ts` |
| 无障碍审计 | ✅ critical 0 / warning 0 / exit 0 | `npx vite build && node --experimental-strip-types --no-warnings scripts/audit/a11y.ts` |
| 首屏可交互 | ✅ 常态 408–456ms（预算 1500ms，失败线 3000ms） | `npm run perf`（需先 `npm run build`） |
| 格式校验器 | ✅ 通过 | `node --experimental-strip-types --no-warnings scripts/validate-session.ts samples/example.sandplay.json` |
| 多路由 + 深链刷新 + 移动端 | ✅ 通过 | `node scripts/dev/check-routes.mjs` |
| 计分引擎单元测试 | ✅ 65 条断言全绿 | `npx vitest run src/scales/scoring.test.ts` |
| 量表内容专业审核 | ❌ **未进行** | 上线前阻断项（见 §2.1） |
| 热线号码拨打核验 | ❌ **未进行** | 上线前阻断项（见 §2.2） |

**一句话结论**：功能、质量门禁、可访问性都已完成，**但仍不能直接面向真实用户上线** ——
差的是**内容审核**和**号码核验**，这两件事必须由有资质的人做，不是写代码能解决的。

**一键跑全部门禁**：`npm run check`
（**22 个环节**串起来，exit 0 即全绿；环节清单以 `package.json` 的 `scripts.check` 为准 ——
这里不抄那份清单，抄了就会漂）。

**六条「门禁的自检」仍然不在 `check` 里**（它们各自要跑 1–5 分钟，且必须先有 `dist`）：

| 命令 | 验证什么 | CI |
| --- | --- | --- |
| `npm run a11y:self-test` | 无障碍规则本身有效：注入 6 类缺陷必须被抓到，roving tabindex 必须被豁免 | ✅ |
| `npm run e2e:self-test` | 移动端 390px 断言有效：注入 500px 宽元素 / 8×8px 按钮必须被抓到 | ✅ |
| `npm run kbd:self-test` | 键盘流程断言有效：让方向键失效必须被抓到 | ✅ |
| `npm run visual:self-test` | 视觉回归断言有效：注入随机噪点 / 擦掉画面必须被抓到 | ✅ |
| `npm run perf:render:self-test` | 渲染性能断言有效：摆件数不符 / 绘制被拖慢必须被抓到 | ✅ |
| `npm run audit:ghost:self-test` | 幽灵字段检测器有效：无人读写 / 有读无写必须被抓到，真实写法不许误报 | ✅ |

> `npm run audit:ghost`、`npm run audit:i18n`、`npm run audit:css` **在 `check` 里** ——
> 它们是纯静态扫描，秒级，没有理由不每次跑。它们各自的自测
> （`audit:i18n:self-test` 验两表对齐/少键/占位符/重复 5 类变异，
> `audit:css:self-test` 验未定义变量的 6 种放行与判红情形）也都在 `check` 里，同样因为快。
>
> **v2.0 收尾新加的几条自测也已经在 `check` 里**，因为它们够快或值得付时间：
> `audit:idb:self-test`、`audit:cache:self-test`、`audit:routes:self-test`、
> `audit:faq:self-test`。其中 `audit:routes:self-test` 最慢（要重建 `dist` 两三次），
> 但它守的是白屏 —— **那是用户最先看到、也最不知道找谁报的故障**，
> 值得付这个时间。

> 为什么要单独有这几个：**从没红过的断言不算门禁**。
> `e2e:self-test` 第一版就抓到了自己的 bug（用 `window.innerWidth` 当基准，
> 而 `isMobile` 下它会被溢出内容撑大，使断言恒真）；
> `kbd:self-test` 对应的 `keyboard-flow` 场景上线即抓到 `onItemCommit`
> 丢参数的实现缺陷（`tsc` 和 547 条单测都放行）；
> `visual:self-test` 抓到的不是被测代码，而是工具本身 ——
> `launchPreview` 的 `distDir` 参数**只用于存在性检查、从未传给 vite**，
> 于是所有变异测试实际都在测默认 `dist/`，稳定地「抓不到问题」。
> `perf:render:self-test` 两版都「抓不到」，原因都在自检脚本自己身上：
> 注入时机晚于读取、以及按文本节点匹配不到
> `<span>100</span><span> 件在场</span>` 这种跨节点文本。
> 做法统一为：**把 `dist` 复制到 `tmp/`，在副本上注入缺陷，工作区全程只读。**
>
> 幽灵门禁还有个**字段版本**：`Preferences.soundEnabled` 曾经字段存在、
> 默认 `true`、两套 i18n 文案齐备，但**零处代码读过它** —— 沙声这个
> VISION §5.1 的 P0 项根本没实现。靠「反向搜索消费方」挖出来的
> （同一个文件里 `reducedMotion` 有 8 处真实消费，对照就露馅了）。
> 已实现（WebAudio 程序化合成，零音频资产），单测 + E2E 双钉死。
> 详见 `TESTING.md §4.10「死开关」`。

> ⚠️ 这条命令曾经是「typecheck + test + build」三条，而 CONTRACT §7 里
> 「首屏可交互」一行的验证方式写着 `scripts/audit/perf.ts` —— **那个文件从来不存在**，
> `npm run perf` 一直抛 `MODULE_NOT_FOUND`。因为没人跑，所以没人发现。
> 现在脚本补上了、也接进了 `check`，并且做了一次变异（把判失败线改成 1ms）
> 确认它真的会红。详见 `TESTING.md §4.7「幽灵门禁」`。
>
> 顺手把整个 `scripts/` 和 `docs/` 扫了一遍，又挖出 **6 处「在跑但结论不可信」**
> 的检查并全部修掉（滑杆值被静默 clamp、断言目标被删除后改名、
> testid 语义漂移、指标方向反了等）。完整审计报告在 `tmp/ghost-gates-report.md`，
> 六种变体的规避规则见 `TESTING.md §4.7.1`。
>
> 这一轮最值得记住的一句：**一个从来没见它红过的门禁，不能算门禁。**

---

## 二、上线前必做（阻断项）

### 2.1 量表内容由专业人士复核

需要复核的不只是"有没有错别字"，而是**会不会误导**：

| 位置 | 具体问题 |
| --- | --- |
| `src/scales/data.ts` · ISI 第 1 题 | 原量表问「入睡需要多少分钟」，本站为适配四选一改为「躺下后需要超过 30 分钟才能睡着」。**这是对原量表的改动**，需确认是否影响计分效度与常模对应关系 |
| `src/scales/data.ts` · RSES 第 8 题 | 「我希望能为自己赢得更多尊重」在中文文献中有多种译法。因该题参与反向计分，译文不同会改变得分，需确认采用版本 |
| `src/scales/data.ts` · 全部 `levels` 文案 | 「状态平稳」「低落感比较明显」等措辞是否会被读者理解为诊断结论 |
| `src/pages/ScaleRunPage.tsx` · 危机建议列表 | PHQ-9 第 9 题 > 0 时展示的 4 条建议（不要独处 / 移交危险物品 / 念头具体时立即求助 / 念头会过去），措辞需专业审核 |

### 2.2 热线号码逐条拨打核验

`src/resources/helplines.ts` 共 12 条。**`verifiedAt` 字段记录的是资料收集日期，不是拨打核验日期**，不要误读。

优先核验这条——置信度最低：

```ts
// 华中师范大学心理援助热线
// 当前写入：4009-678-320
// 存疑：正确号码可能为 400-967-8320
```

其余号码（12356 / 010-82951332 / 400-161-9995）来自公开权威渠道，但仍需实测接通情况与工作时间。

### 2.3 外链可用性

`src/resources/catalog.ts` 共 39 条资源，其中 WHO、NIMH、NHS、Get Self Help、Moodjuice 等为境外站点，
**在中国大陆网络环境下可能无法访问**。二选一处理：补充国内替代链接，或在卡片上明确标注访问条件。

---

## 三、技术债（按优先级）

> **v2.0 更新（2026-10）**：本节原列为 P0–P3 的四项技术债**已全部清偿**，
> 下面保留原始描述是为了让接手者知道「曾经坏在哪里」以及**怎么验证它没坏回去**。
> 未清偿的项已移入 §3.5。

### P0 · 计分引擎单元测试 —— ✅ 已清偿

**原状**：`src/scales/scoring.ts` 零测试，而这是全站出错后果最严重的地方。

**现状**：已有 **65 条断言**（`src/scales/scoring.test.ts`），覆盖原计划的全部四项：
反向计分（PSS-10 第 4/5/7/8 题、RSES 5 道反向题，验证 `min + max - value`）、
区间边界（`findLevel` 落点唯一且不重叠）、极值（全选最低/最高档等于量程端点）、
`detectCrisis`（PHQ-9 第 9 题 0 → false，≥1 → true；其余量表恒 false）。

**怎么验证没坏回去**：`npx vitest run src/scales/scoring.test.ts`。

> ⚠️ **这里曾经写错成 `npx vitest run src/__tests__/`，而那是一个幽灵门禁。**
>
> `src/__tests__/` 目录里**只有 `perf.test.ts`**，41 条断言全是性能和编码体积，
> grep `scoreScale|scoring|反向|危机` **零命中**。
> 也就是说那条命令：
>
> ```
> npx vitest run src/__tests__/   →   Tests 41 passed (41)   EXIT=0
> ```
>
> 全绿、退出码 0、看起来完美 —— **但它一条计分逻辑都没测。**
>
> 这个比 `perf.ts` 不存在更隐蔽：`perf.ts` 会立刻抛 `MODULE_NOT_FOUND`，
> 而这里文件在、命令成立、结果绿，只是**测的东西和它声称的毫无关系**。
> 紧急关头正是要信任计分引擎的时候，而这个门禁在最需要它的地方失效。
>
> 教训：**路径写对不等于测对了。** 验证「某个模块有测试」时，
> 要打开那个文件看一眼它 `describe` 的是什么，别只看它绿不绿。


### P1 · 存储层健壮性 —— ✅ 已清偿

**原状**：三个边界都没处理 —— 损坏 JSON 无测试；配额溢出只 `console.warn`、
用户以为存上了；沙盘快照无上限。

**现状**（`src/lib/storage.ts`）：
- `persist()` 返回 `boolean`，`writeJSON()` 透传；集合 API 的
  `add/upsert/update/remove/clear` **全部返回 `boolean`**，UI 可据此弹 toast。
  **这是破坏性变更**：返回值从 `void` 改成 `boolean`，新代码别写成
  `expect(...).toBeUndefined()`。
- 写入失败时**不填** `snapshotCache`，保证内存快照与磁盘不分叉
  （历史缺陷：写失败后内存里有、磁盘上没有，表现为「界面显示已保存、刷新后消失」）。
- 跨标签页 `storage` 事件改为**先 `invalidate` 再 `emit`**
  （历史缺陷：只 emit 不失效，订阅者被唤醒却仍命中旧缓存，界面永不更新）。
- 损坏 JSON 有测试覆盖，`readJSON` 的 `try/catch` 返回 fallback。

**怎么验证没坏回去**：`npx vitest run src/lib/storage.test.ts`（46 条，含 3 条
「原缺陷，已修复」的反向回归；它们**故意写成会失败的样子**来描述旧行为）。

### P2 · 无障碍 —— ✅ 已清偿

**原状**：键盘流程只覆盖沙盘与量表；`reducedMotion` 只接了手动开关、没有系统级检测；
对比度未用工具实测。

**现状**：
- `scripts/audit/a11y.ts` 用真实 Chrome 审计 **15 条路由**（对齐 `src/App.tsx` 的
  完整路由表），**critical 0 项、warning 0 项、exit 0**。曾经的历史存量
  （对比度 122、触摸目标 152、form-label 2）全部清零，基线已收窄为
  `entries: []`（`scripts/audit/a11y-baseline.json`）。
- 覆盖从 5 条扩到 15 条后，**立刻暴露出 4 个此前从未被量过的真实缺陷**
  （`/scales/phq-9` 返回链接 30.9px、`/sandbox/clients` 下拉框 41px、
  `/toolbox` 返回链接 21.3px、`/resources` 外链 23.9px），均已修复；
  另有 1 处标题跳级（两个呼吸工具 h1→h3）已修。这说明「只测 5 条」时
  这些缺陷一直存在，只是没人量过。
- `prefers-reduced-motion` **系统级检测已验证真实生效**：15 条路由的动效元素
  分别 53/34/**68**/28/60/95/19 … → 全部降为 0（实测 3 次，sandbox 是 68 不是 58）。
- 三条判据（`keyboard-unreachable` / `reduced-motion` / 路由覆盖）都曾**恒真**，
  现在每条都有变异证据，并由 `node scripts/audit/meta-self-test.mjs` 自动回归。
- `scripts/dev/` 下有对比度计算器（`contrast.mjs`）与色板反解脚本
  （`palette.mjs` / `palette-tier.mjs`），改色板后可复算。

**两个必须知道的约定**（`docs/CONTRACT.md` §7 有详述）：
1. **44px 指元素盒子**，不是视觉命中区。**不能用伪元素 `inset:-6px` 取巧** ——
   审计量 `getBoundingClientRect()`，伪元素溢出不计入，数字一点不降。
2. 色板必须按**最深背景** `--sand-300 (#e4dccb)` 反解。按 `--sand-200`
   解出来的颜色在真实页面上仍会不达标。
3. 三级灰阶（`--ink-300/400/500`）之间要留 **>2.5% 相对亮度差**，
   否则全部压到 4.5:1 会挤成同一个灰、层级消失。

**怎么验证没坏回去**：
```bash
npx vite build   # 必须先构建，审计跑的是 dist
node --experimental-strip-types --no-warnings scripts/audit/a11y.ts
```

### P3 · 性能 —— ✅ 已清偿

**原状**：单 chunk 434 kB（gzip 141 kB）；沙盘拖拽每次 `pointermove` 都 `setState`。

**现状**：
- 路由级 `lazy()` 已完成（`src/App.tsx`），`three` 走动态 `import()` 独立 chunk。
- 主包 gzip **140.7 kB**，预算 175 kB。断言它的是 **`src/__tests__/perf.test.ts`**（`dist/` 存在时逐文件校验体积预算）。
  ⚠️ 这里原写「`--report-only` 之外的 E2E 也断言了这点」——**E2E 里没有任何体积断言**，
  `smoke.ts` 里唯一提到 gzip 的地方是一句注释。文档把守卫记在了错的门禁名下，
  后果是有人想确认「体积真的被守住了」时，会去看 `smoke.ts` 然后什么也找不到。
- 拖拽/笔刷已 rAF 节流；`replayAll` 的 O(n²) 已消除（4000 条 **53.5ms → 1.3ms**）；
  `computeSessionStats` 无 surface 场景 **72.6ms → 1.3ms**。

**性能断言的采样陷阱**（重要）：并行跑测试时 CPU 被打满，
**干扰只会让耗时变长、永远不会变短**，所以绝对预算断言要用**最小值**
（`bestMs`）而非中位数 —— 中位数会把抢占算进去，曾经导致
`perf-scale.test.ts` 6 次全量挂 3 次。标度（比值）断言仍用中位数，
因为用最小值会让分母贴近 0、比值反而失真。

### 3.5 仍未清偿的项

- **`docs/TESTING.md` 之外没有 CI**：所有门禁靠手工执行。接入 CI 时注意
  a11y 审计需要真实 Chrome（`puppeteer-core`，路径见 `scripts/audit/a11y.ts` 顶部）。
- **`src/sandbox/SandboxCanvas.tsx` 是死代码**（已被 `src/sandbox/render/` 取代，
  全仓无引用），保留仅为减少一次性 diff 风险，可安全删除。
- **`src/sandbox/render/three.tsx` 不支持拖动/缩放/旋转**（只能点击选中）。
  这是**刻意的**：3D 是可选视图，拖动交互在 2.5D 里做。3D 视图有明确提示。
- **沙盘会话体积无硬上限**（仅 `MAX_EVENTS = 4000` 软约束）。重度使用理论上
  可能触及 localStorage 5MB 配额；写入失败现在会被感知（见 P1），但不会自动清理。

---

## 四、几个容易踩的坑

### 4.1 这个 shell 不是 UTF-8

**不要**用 PowerShell 的 `Get-Content` / `Set-Content` / `Out-File` 编辑含中文的源码文件。
ANSI 代码页会把中文标点转成乱码（例如 `“` 变成 `鈥?`），还会给文件加上 UTF-8 BOM，
导致 lightningcss 解析失败、**全站构建挂掉**。本项目开发过程中真实踩过一次，排查了十几分钟。

用编辑器或 `write`/`edit` 工具改源码。如果已经在 shell 里改坏了，检查方法：

```powershell
# 检查 BOM
[System.IO.File]::ReadAllBytes('src/styles/sandbox.css')[0..2]
# 检查乱码
Select-String -Path src/**/*.css -Pattern '鈥|锟'
```

### 4.2 `useSyncExternalStore` 必须返回稳定引用

`getSnapshot` 如果每次都返回新对象/新数组，React 会抛
`The result of getSnapshot should be cached to avoid an infinite loop` 并**让整站白屏**。

这个 bug 在本项目里真实发生过：`getPreferences()` 每次 `{ ...DEFAULT, ...stored }` 都造新对象。
**类型检查 0 错误、构建成功，但浏览器里一个字都不显示。**

修改 `src/lib/storage.ts` 时务必保持 `snapshotCache` 的"写入即失效、读取即缓存"语义。

> 通用教训：`tsc` + `vite build` 全绿 ≠ 页面能打开。必须至少用真实浏览器渲染一次。

### 4.3 危机检测不能挂在总分上

`detectCrisis` 只看 PHQ-9 第 9 题的**原始作答值**，与总分无关。因为：
第 9 题选「几乎每天」但其余题都选 0 时，总分只有 3 分，落在「状态平稳」区间。

此时如果页面上同时出现「状态平稳」和危机热线，等于在暗示用户"你其实没事"。
`ScaleRunPage` 已用 `crisisOverridesLevel` 处理这种情况（标签改「需要优先关注」、主标题改「先说这一件事」、
建议列表换成危机场景专用内容）。**改这一段时不要退回原来的写法。**

### 4.4 资源路径必须是绝对路径 `/`

`vite.config.ts` 的 `base` 必须是 `'/'`，**不能是 `'./'`**。

本站有两层子路由（`/scales/phq-9`、`/toolbox/breathing-478`）。用相对路径时，浏览器会把
`./assets/index.js` 解析成 `/scales/assets/index.js`；在 SPA fallback 下这个请求返回的是
`index.html`（MIME `text/html`），于是 `<script type="module">` 被浏览器以 MIME 不符拒绝执行
——**整页白屏**。

阴险之处在于：首页和单层路由（`/records`）完全正常，开发时很容易漏掉。
这个 bug 在本项目里真实存在过，直到用生产构建实测深层链接才暴露。

同理，`index.html` 里的 favicon 也要写 `/favicon.svg` 而不是 `./favicon.svg`。

> 验证方法：`npm run build` 后起一个带 SPA fallback 的静态服务器，
> **直接访问** `/scales/phq-9`（而不是从首页点进去），确认 `#root` 有内容。

### 4.5 沙盘拖拽的坐标换算

`SandboxCanvas` 里必须用 `rect.left` / `rect.top` 做偏移，且拖拽开始时记录
"指针与元素中心的归一化偏移量"（`offsetX` / `offsetY`），否则拖第一下摆件会跳到指针位置。

拖拽过程中**不要写 localStorage**，只在用户点「保存沙盘」时写。

---

## 五、文件地图

```
src/
├── lib/            # 公共层（Lead 所有，改动需谨慎）
│   ├── types.ts        # 全部数据模型
│   ├── storage.ts      # localStorage 读写 + useSyncExternalStore ← 4.2 的坑在这
│   ├── date.ts  id.ts  utils.ts  toast.ts
├── components/     # UI 与外壳
├── scales/         # 量表数据 + 计分引擎 ← 2.1 和 P0 在这
├── sandbox/        # 象征物 + 场景 + 画布
├── toolbox/        # 7 个练习 + 计时 hook
├── resources/      # 热线 + 资源目录 ← 2.2 和 2.3 在这
├── pages/          # 10 个路由页
└── styles/         # 手写 CSS，无预处理器
docs/
├── PLAN.md         # 产品与架构主文档
├── CONTRACT.md     # 模块间契约
└── HANDOVER.md     # 本文档
```

---

## 六、跑起来

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npx tsc -b --noEmit
npx vite build
```

部署到静态托管时注意：本站用 `BrowserRouter`，**必须配置所有路径回退到 `index.html`**
（Nginx: `try_files $uri /index.html;`），否则刷新子路由会 404。
无法配置回退就改用 `HashRouter`（改 `src/main.tsx` 一行）。
