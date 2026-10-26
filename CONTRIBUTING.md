# 贡献指南

谢谢你愿意花时间。下面按「你想做什么」来组织，你可以直接跳到最接近的那一节。

- [先读这三条](#先读这三条)
- [报告问题](#报告问题)
- [改代码](#改代码)
- [写文档或做翻译](#写文档或做翻译)
- [写外部工具](#写外部工具)
- [临床与内容专业意见](#临床与内容专业意见)
- [不要做的事](#不要做的事)
- [开发环境](#开发环境)
- [提交前自检](#提交前自检)

---

## 先读这三条

1. **心屿不做诊断，也不做沙盘解读。** 任何代码、文案、注释、示例都不应暗示"软件能告诉你这说明了什么"。这不是偏好，是项目的存在前提，见 [`docs/VISION.md`](docs/VISION.md) §1.1 与 §5.6。
2. **数据不出本地是硬约束。** 不引入任何会上报用户输入的网络调用 —— 包括"匿名统计"。见 [`docs/CONTRACT.md`](docs/CONTRACT.md) §5 第 4 条。
3. **这是一个面向脆弱用户的工具。** 一句随手写的文案，可能被一个正在低谷里的人读到。写文案时请放慢一点。

---

## 报告问题

开 issue 之前，先看一眼 [`docs/HANDOVER.md`](docs/HANDOVER.md) 的「已知问题」清单 —— 有些问题我们已经知道了。

一个好的 issue 包含：

- **你做了什么**（具体到点了哪个按钮、导入了什么文件）；
- **你期待什么**；
- **实际发生了什么**（错误信息、截图、控制台日志）；
- **环境**（浏览器 + 版本 + 操作系统）。

### 报告安全或隐私问题时请别开公开 issue

见 [`SECURITY.md`](SECURITY.md)。

### 报告内容错误

量表题干、分级文案、热线号码、资源链接的错误**优先级最高**。请在 issue 标题里加上 `[内容]`，并尽量附上来源（权威指南、官方页面）。

> 热线号码尤其重要：`src/resources/helplines.ts` 里的 `verifiedAt` 是**收集日期**，不是**拨打核验日期**。如果你恰好拨通了某一条，请告诉我们结果 —— 这是目前最缺的信息。

---

## 改代码

### 流程

1. 开一个 issue 说明你要改什么（小的文档 typo 可以直接提 PR）；
2. Fork，从 `main` 切一个分支：`fix/xxx` 或 `feat/xxx`；
3. 改，跑自检（见下）；
4. 提 PR，说明「改了什么 / 为什么 / 怎么验证的」。

### 代码约定

| 约定 | 说明 |
| --- | --- |
| TypeScript strict | 不用 `any`；确实需要时加注释说明为什么 |
| 不引入 UI 库 / 图表库 | 样式用纯 CSS + 设计令牌（`src/styles/global.css`） |
| 不引入新的运行时依赖 | 需要时先在 issue 里讨论，并同时更新 [`docs/CONTRACT.md`](docs/CONTRACT.md) §7 白名单表 + [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) |
| 纯函数优先 | 计分、统计、编解码、差分这类逻辑写成可单测的纯函数 |
| 注释写「为什么」 | 代码已经说明了「是什么」 |
| 中文文案 | 面向用户的文案用中文；标识符用英文 |

### 不要改的文件

以下文件是**共享契约**，改动会影响其他并行工作，需要先讨论：

```
src/App.tsx
src/lib/**
src/components/**
src/styles/global.css
src/styles/app.css
src/sandbox/{events,useSandboxSession,symbols,surfaceCodec,surfaceState,surfaceOps}.ts
src/format/**
docs/CONTRACT.md
docs/VISION.md
```

如果你认为其中某个文件必须改，请先开 issue，**不要直接提 PR**。

### 并行工作：不要按进程名杀进程

多个 agent / 多人可能同时在同一个工作区跑门禁，而门禁都要起 `vite preview`。
**一个真实的教训**：有人为了清理自己的孤儿进程写了

```powershell
# ✗ 绝对不要这么写
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'vite\.js.*preview' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

它按命令行**正则匹配**，不区分 PID 归属，会把别人正在跑的 preview 一起杀掉。
受害者的门禁表现成「随机某个路由 `ERR_CONNECTION_REFUSED` + `preview 退出 code=4294967295`」，
看起来像被测代码有 flake，实际是外部干扰——排查方向会被彻底带偏。
更糟的是：如果度量脚本也用同样的模式统计「残留进程数」，
它会**把别人的进程算成自己的泄漏**，同时制造它要度量的现象。

三条纪律：

1. **只杀自己 `spawn` 出来的 `child.pid`**：
   `child.kill()` → 轮询 `child.exitCode` 等它真断气 → 兜底 `taskkill /PID <自己 pid> /T /F`。
   不要用 `/IM node.exe`，不要按模式匹配。
2. **判断「有无残留」限定到自己的端口**：
   `Get-NetTCPConnection -LocalPort <port> -State Listen`。
   不要用全机扫描，那在并行环境下必然把别人的进程算进来。
3. **首选端口被占就换端口，不要杀占用者**（`pickFreePort(preferred)`）。
   「谁先占到就是谁的」是并行开发里唯一不会互相破坏的规则。

写好后请统一用 `scripts/dev/_shared/preview.mjs`，不要每个脚本各写一套。

### 新增依赖的门槛

心屿刻意保持依赖精简。新增一个依赖需要：

1. 许可证在允许清单内（MIT / ISC / BSD / Apache-2.0）。**GPL / AGPL / SSPL 一律拒绝** —— 与"希望被机构采用"的目标冲突。
2. 在 PR 里给出体积预算（gzip 后多少 KB）。
3. 更新 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 的台账（名称、版本、许可证、版权行）。
4. 如果是重依赖（如 3D 库），必须是**动态 `import()`**，不进主包。

---

## 写文档或做翻译

文档的价值和代码一样高，尤其是 [`docs/FORMAT.md`](docs/FORMAT.md) —— 它是外部工具作者唯一的入口。

### 文档风格

- **中文优先**，用「你」不用「您」，语气平和、不煽情、不说教；
- 表格优先于长段落；
- 用 `> **注意**` 这样的引用块做callout；
- 内部链接用相对路径，例如 [`docs/FORMAT.md`](docs/FORMAT.md)；
- **不要用 PowerShell 的 `Get-Content` / `Set-Content` 读写含中文的文件** —— 会破坏 UTF-8 编码。用编辑器或 `read`/`write` 工具。
- 所有文件必须是 **UTF-8 无 BOM**。

### 翻译

目前只有 `src/i18n/zh-CN.ts` 和 `src/i18n/en.ts` 两张表，且只有沙盘模块的文案在表内。翻译时请注意：

- **不要翻译** `symbolId`、事件 `type`、格式字段名 —— 它们是数据契约的一部分；
- 情绪词表（`AFFECT_LABELS`）的英文译法要保守，宁可直译也不要意译 —— 这些词是给用户挑的，不是给我们诠释的；
- 量表题干属于专业内容，**翻译改动需要专业复核**，不要单独提 PR。

---

## 写外部工具

这是我特别欢迎的一类贡献：查看器、导入器、批量统计、迁移脚本、别的语言实现。

1. 先读 [`docs/FORMAT.md`](docs/FORMAT.md)，它被设计成"只读这一份就能写出解析器"；
2. 拿 [`samples/`](samples/README.md) 里的样例自测，特别是 `broken.sandplay.json`（验证错误处理）；
3. 用官方校验器验证你的输出；
4. 如果你发现了规范里没写清的地方 —— **这正是最有价值的 issue**。请描述你在哪里卡住、你的实现怎么处理的。

如果你做了第三方工具，欢迎在 issue 里告诉我们，我们可以列在 README 里。

---

## 临床与内容专业意见

如果你是有执照的心理咨询师 / 治疗师 / 精神科医师，我们非常需要你的意见，尤其是：

- 量表题干与分级文案的准确性与适切性（ISI 第 1 题、RSES 第 8 题目前有译法争议）；
- 沙盘六阶段模型的表述是否恰当；
- 边界声明是否足够清楚；
- 是否有我们没意识到的伦理风险。

开 issue 时标注 `[专业意见]` 即可。我们不会要求你署名，也不会把你的意见当作背书。

---

## 不要做的事

| 请不要 | 原因 |
| --- | --- |
| 提交真实来访者的沙盘数据 | 违反隐私红线。要做样例就自己造一个，参见 `samples/` |
| 提交真实姓名、手机号、身份证号、住址 | 同上 |
| 加 AI 自动解读 / 情绪识别 / 诊断建议 | 项目的核心非目标 |
| 加用户行为埋点、崩溃上报、A/B 测试 | 数据不出本地 |
| 加社交功能（点赞、分享到广场、公开案例库） | 沙盘内容可能极度私密 |
| 把热线号码改成"看起来更新"的 | 号码错误可能致人死亡。必须附权威来源 |
| 改 `LICENSE` 正文 | Apache-2.0 正文必须逐字准确 |
| 提交时带上 `dist/`、`node_modules/`、`.shots/` | 已在 `.gitignore` |

---

## 开发环境

需要 **Node 22+**（校验器用了 `--experimental-strip-types`）。

```bash
npm install
npm run dev        # 开发服务器 http://127.0.0.1:5173
npm run typecheck  # TypeScript 严格检查（应用 + scripts/）
npm run test       # 单元 + 性能测试（vitest）
npm run build      # 生产构建
npm run preview    # 预览构建产物
npm run check      # 一键跑全部 7 道门禁
```

---

## 提交前自检

```bash
npx tsc -b --noEmit        # 必须 0 错误
npx vitest run             # 必须全绿
npx vite build             # 必须通过；主包 gzip ≤ 175KB
```

改了格式相关的东西，还要跑：

```bash
node --experimental-strip-types scripts/validate-session.ts samples/example.sandplay.json samples/surface-demo.sandplay.json
```

预期退出码 `0`。如果改了 `docs/FORMAT.md` 里的字段说明，请**同时**核对：

- `src/format/sandplay.ts` 的 `validateSandplayFile()`；
- `public/schema/sandplay-session-v1.schema.json`；
- `samples/` 里的样例。

这四者必须一致。文档写错但校验器对，会让所有外部工具作者踩坑。

---

## 提交信息

用简短的祈使句，中英文都行：

```
修正 ISI 第 1 题题干表述
fix: 沙面笔刷在触摸屏上断点
docs: FORMAT.md 补充 W1 湿度场示例
```

## 许可

提交 PR 即表示你同意以 **Apache-2.0** 授权你的代码贡献，以 **CC BY 4.0** 授权你的文档贡献。请确认你有权这样做（例如，工作成果属于你的雇主时，需要先取得许可）。
