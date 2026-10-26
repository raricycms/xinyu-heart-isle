# 心屿 · 交接清单

> 本文档面向"接手这个项目的人"。它只写**需要你动手的地方**，不重复功能介绍。
> 产品设计、架构、路线图见 [`docs/PLAN.md`](./PLAN.md)；模块间约定见 [`docs/CONTRACT.md`](./CONTRACT.md)。

---

## 一、当前状态

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 类型检查 `npx tsc -b --noEmit` | ✅ 0 错误 | |
| 生产构建 `npx vite build` | ✅ 通过 | 67 个模块 |
| 10 个路由 | ✅ 全部可渲染 | 桌面 1440px + 移动 390px 双端验证 |
| 浏览器控制台 | ✅ 0 错误 | 26 次页面渲染采集 |
| 交互全流程 | ✅ 通过 | 见 PLAN.md 8.1 |
| 计分引擎单元测试 | ❌ **未编写** | 最高优先级技术债 |
| 量表内容专业审核 | ❌ **未进行** | 上线前阻断项 |
| 热线号码拨打核验 | ❌ **未进行** | 上线前阻断项 |

**一句话结论**：代码可以跑，产品可以演示，但**不能直接面向真实用户上线**——差的是内容审核和号码核验，不是功能。

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

### P0 · 计分引擎单元测试

这是全站**最容易出错、出错后果最严重**的地方。当前 `src/scales/scoring.ts` 没有任何测试。

至少覆盖：

1. **反向计分**：PSS-10 的第 4/5/7/8 题、RSES 的 5 道反向题，验证 `min + max - value`
2. **区间边界**：每个 `level` 的 `min`/`max` 两端点，验证 `findLevel` 落点唯一且不重叠
3. **极值**：全选最低档、全选最高档时的总分是否等于理论量程端点
4. **`detectCrisis`**：PHQ-9 第 9 题 = 0 返回 false，≥ 1 返回 true，其余量表恒为 false

建议用 Vitest。当前 `package.json` 没有测试框架，需要先引入。

### P1 · 存储层健壮性

`src/lib/storage.ts` 有两个已知边界：

- **损坏 JSON**：`readJSON` 已 try/catch 返回 fallback，但没有测试覆盖
- **配额溢出**：`persist()` 捕获异常后只 `console.warn`，用户界面上**没有任何提示**——用户会以为存上了
- **沙盘快照无上限**：每次保存都是完整 `items` 数组，重度用户理论上可能触及 5 MB 配额

建议：给 `writeJSON` 增加失败回调，在 UI 上以 toast 明确告知"这次没存上"。

### P2 · 无障碍

- 键盘流程只做了沙盘（方向键微调 / Delete 删除）和量表（数字键选择 / ← → 切题）
- 呼吸动画依赖 `scale()` 变换，`usePreferences().reducedMotion` 已接入 `html[data-reduced-motion]`，但**没有实际生效的系统级检测**——目前只能手动开关
- 对比度未用工具实测

### P3 · 性能

- 单个 JS chunk 434 kB（gzip 141 kB）。若在意首屏，可对 `/sandbox` 与 `/toolbox/*` 做路由级 `lazy()`
- 沙盘拖拽每次 `pointermove` 都触发一次 `setState` + 全量 map。摆件很多时（>50）可能掉帧，建议加 `requestAnimationFrame` 节流

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
