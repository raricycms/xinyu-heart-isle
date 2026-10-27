# 心屿 · Xinyu

**一座能"用手"改变的心理沙盘，加一间不联网的自助小屋。**

心理量表 · 赛博沙盘 · 情绪调节工具箱 · 心理援助资源 —— 全部跑在浏览器里，没有账号、没有服务器、没有埋点。

<!-- 徽章位置：等 CI / release 就绪后填入，现在故意留空，不放假徽章。
[![CI](https://img.shields.io/badge/build-passing-brightgreen)](#)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Format](https://img.shields.io/badge/format-sandplay--session%2Fv1-informational)](./docs/FORMAT.md)
-->

> **边界声明**：本站内容仅供自我了解与情绪调节参考，**不构成医学诊断或治疗建议**，不做 AI 自动解读。
> 如果你或身边的人正处在危险中，请立即联系专业援助 —— 站内 [`/safety`](src/pages/SafetyPage.tsx) 页面列出了可用的热线。

---

## 它是什么

一个**纯静态、零后端**的心理自助工具站。五个模块：

| 模块 | 路由 | 做什么 |
| --- | --- | --- |
| 首页 | `/` | 心情签到、7 天趋势、每日引导语、模块入口 |
| 心理量表 | `/scales` | PHQ-9 / GAD-7 / PSS-10 / ISI / RSES，含计分与结果区间说明 |
| 赛博沙盘 | `/sandbox` | 327 件沙具 + 可塑形沙面 + 完整过程记录，可回放、可对比、可导出 |
| 情绪工具箱 | `/toolbox` | 7 个练习：4-7-8 呼吸、方块呼吸、5-4-3-2-1 着陆、身体扫描、思维记录表、担忧时间、三件好事 |
| 资源与安全 | `/resources` `/safety` | 心理援助热线 + 分场景求助指引 |

沙盘是重心。它不是"贴纸画布"，而是尽量让**沙**存在：

- **沙面能塑形**：128×96 高度场，抬沙/挖沙/抹平/耙纹/喷水/压平/挖隧道，带休止角物理（干沙会塌、湿沙能立）；
- **过程能回看**：19 种事件构成完整事件流，时间轴可拖到任意一步，回放结果与当时所见一致；
- **数据能带走**：`.sandplay.json` 格式有[公开规范](./docs/FORMAT.md) + [JSON Schema](./public/schema/sandplay-session-v1.schema.json) + [零依赖校验器](./scripts/validate-session.ts)。

---

## 它**不是**什么

这一节比上一节重要。

| 它不是 | 因为 |
| --- | --- |
| ❌ 网络靶场 / 渗透练习平台 | 文件夹叫 sandbox 只是因为沙盘，和网络安全无关 |
| ❌ 诊断工具 | 量表分数只是自评状态的快照，不是诊断结论；没有临床常模 |
| ❌ AI 解读器 | 不做"看图说话"。沙盘的意义由摆的人自己说，产品不替他说 |
| ❌ 医疗设备 | 未经任何医疗器械认证，不提供治疗建议或危机干预 |
| ❌ 云端服务 | 没有后端。你的记录不在我们的服务器上，因为我们没有服务器 |
| ❌ 危机干预服务 | 不提供实时响应。危机情况请看 [`/safety`](src/pages/SafetyPage.tsx) |

关于"为什么不做 AI 解读"：专业伦理明确反对对沙盘做"看图说话"式诠释，而错误解读对脆弱用户的伤害不可逆。这不是技术限制，是**立场**。详见 [`docs/VISION.md`](docs/VISION.md) §1.1 与 §5.6。

---

## 现状：诚实版

用五个维度衡量"离理想中的沙盘有多远"（评分卡出自 [`docs/VISION.md`](docs/VISION.md) §1.2）：

| 维度 | 问题 | v1 起点 | v3 目标 |
| --- | --- | :---: | :---: |
| **D1 介质自由度** | 用户能不能"用手"改变这个地方？ | 1/5 | 4/5 |
| **D2 象征系统** | 能不能找到"就是它"的那个东西？ | 2/5 | 5/5 |
| **D3 过程可回看** | 三个月后还能不能看见"当时怎么摆的"？ | 1/5 | 5/5 |
| **D4 关系支持** | 咨询师能不能和来访者一起用它？ | 0/5 | 4/5 |
| **D5 开放与可信** | 别人能不能审计、复用、贡献？ | 2/5 | 5/5 |
| | **合计** | **6/25** | **23/25** |

> 这张表是决策工具，不是营销数字。v3 各项目标是否达成，由 [`docs/HANDOVER.md`](docs/HANDOVER.md) 的验收项逐条判定 —— 我们不在这里替自己打分。

已经做到的：

- ✅ 沙面 L2 高度场 + 休止角松弛 + 干湿两态；
- ✅ 327 件沙具 / 6 大类 / 24 子类（emoji 字形，无版权负担）；
- ✅ 事件流 + 时间轴回放 + 逐帧标注 + 会话对比 + 客观统计；
- ✅ 本地档案、咨询师协作模式、可打印报告、封盘与归档；
- ✅ Apache-2.0 + 公开数据格式规范 + 沙具包清单 + 校验器 CLI。

还缺的（**上线阻断项**，详见 [`docs/HANDOVER.md`](docs/HANDOVER.md)）：

- ⛔ 量表题干与分级文案需**持证专业人士复核**（ISI 第 1 题、RSES 第 8 题有译法争议）；
- ⛔ 12 条热线需**逐条拨打核验**（`verifiedAt` 是收集日期，**不是拨打日期**）；
- 🚧 督导视图、实时协作（WebRTC，默认关闭）、PWA、无障碍专项 —— 排在 v2.5 / v3.0。

---

## 快速开始

需要 **Node 22+**。

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

```bash
npm run build      # 生产构建 → dist/
npm run preview    # 预览构建产物
npm run typecheck  # TypeScript 严格检查（0 错误）
```

### 验证一份沙盘文件

校验器是**零依赖**的，直接跑 TypeScript，不需要先 `npm install`：

```bash
node --experimental-strip-types scripts/validate-session.ts samples/example.sandplay.json
```

```
✓ samples/example.sandplay.json
  标题：示例沙盘 · 一棵树和一片海　模式：自助(self)　场景：beach　已封盘
  摆件 1　事件 3　时长 0:16
  沙面 128×96 干沙　喷水 0 次
  自述 20 字　标注 0 条
  导出：心屿 Xinyu 2.0.0　2026-10-26T14:32:10.000Z
```

退出码：`0` 全部通过 / `1` 校验未通过 / `2` 文件读不到。更多用法见 [`samples/README.md`](samples/README.md)。

---

## 技术栈

| 层 | 选型 | 备注 |
| --- | --- | --- |
| 构建 | **Vite 8** | 纯静态产物 |
| UI | **React 19** + TypeScript（strict） | 无 UI 库、无图表库 |
| 路由 | **react-router-dom 7**（`BrowserRouter`） | 15 条路由 |
| 3D（可选） | **three** `^0.186` | **仅动态 `import()`**，不进主包；2D DOM 渲染是默认路径 |
| 样式 | 纯 CSS + 设计令牌 | 12 个模块样式表 |
| 存储 | `localStorage` + **IndexedDB** | 通过 `useSyncExternalStore` 订阅，支持跨标签页同步 |
| 测试 | **vitest** + puppeteer-core | 单测 + 截图验收 |

依赖白名单与新增依赖的准入规则见 [`docs/CONTRACT.md`](docs/CONTRACT.md) §7；第三方许可证台账见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

### 无后端 = 数据不出设备

没有账号、没有服务器、没有埋点。所有记录保存在当前浏览器：

```
localStorage              IndexedDB（xinyu-db）
├── xinyu.moods           ├── sessions
├── xinyu.scaleResults    ├── clients
├── xinyu.sessions        ├── assets
├── xinyu.clients         └── annotations
├── xinyu.toolSessions
├── xinyu.journal
└── xinyu.preferences
```

代价是诚实的：**换设备 = 数据带不走**（除了导出的 `.sandplay.json`），**清浏览器数据 = 记录丢失**，**共用电脑上别人能打开你的记录**。所以「我的记录」页提供导出备份、导入恢复、一键清空。

---

## 目录结构

```
.
├── public/
│   ├── favicon.svg
│   └── schema/                    # JSON Schema（对外契约）
├── samples/                       # 样例 .sandplay.json + 说明
├── scripts/
│   ├── validate-session.ts        # 零依赖校验器 CLI
│   ├── audit/                     # 一次性核查脚本
│   └── dev/                       # 截图 / 沙具清单
├── src/
│   ├── lib/                       # 类型 / 存储 / IndexedDB / 日期 / id / toast
│   ├── components/{ui,layout}/     # Button, Card, Tag, Notice, Empty, AppShell…
│   ├── styles/                    # 设计令牌 + 各模块 css
│   ├── scales/                    # 5 个量表数据 + 计分引擎
│   ├── toolbox/                   # 7 个练习 + 计时 hook
│   ├── resources/                 # 热线数据 + 资源目录
│   ├── format/                    # ★ sandplay-session/v1 类型与校验 + 旧数据迁移
│   ├── sandbox/
│   │   ├── surfaceCodec.ts        # ★ 高度场 RLE/Base64 编解码 + 物理松弛
│   │   ├── surfaceState.ts        # ★ 运行时 ⇄ 持久化桥接（含湿度场）
│   │   ├── events.ts              # ★ 19 种事件 + 归约 + 命令栈（撤销/重做）
│   │   ├── symbols.ts             # 327 件沙具
│   │   ├── scenes.ts              # 5 个场景主题
│   │   ├── render/                # 渲染适配层：dom2d / iso2d / three
│   │   ├── workbench/             # 工具箱面板、侧栏、Inspector
│   │   ├── replay/                # 时间轴、关键节点、统计、差异、续接
│   │   ├── archive/               # 档案、来访者绑定、下载、报告事实
│   │   └── pages/                 # 回放 / 报告 / 对比 / 来访者
│   ├── pages/                     # 11 个主路由页面
│   ├── i18n/                      # 轻量键表（zh-CN / en，缺键回退）
│   ├── App.tsx                    # 路由表
│   └── main.tsx
└── docs/                          # 见下
```

★ = 对外契约相关，外部工具主要看这几个。

---

## 文档

### 第一次接触这个项目

- **[`docs/FAQ.md`](docs/FAQ.md)** —— **常见问题**：数据存在哪、会不会上传、沙盘怎么用、沙具包怎么加、键盘能不能用、支持哪些浏览器。**先读这份**，它回答了大多数人最先问的问题。
  > 注意：FAQ 只答工程与使用层面。**关于「这个沙盘说明什么」这类临床问题，本项目一律不答**（见 [`docs/CONTRACT.md`](docs/CONTRACT.md) §5.6）。它也不提供任何自动解读功能。

### 写给外部工具作者

- **[`docs/FORMAT.md`](docs/FORMAT.md)** —— **`sandplay-session/v1` 格式规范**。19 种事件、沙面 `S1`/`W1` 编码（含可直接照抄的解码伪代码）、隐私红线、版本降级策略。**只读这一份就能写出兼容的解析器。**
- **[`public/schema/sandplay-session-v1.schema.json`](public/schema/sandplay-session-v1.schema.json)** —— JSON Schema（Draft 2020-12）。
- **[`scripts/validate-session.ts`](scripts/validate-session.ts)** —— 官方校验器，零依赖，`node --experimental-strip-types` 直接跑。
- **[`samples/`](samples/README.md)** —— 3 个样例：最小例子、全字段例子、故意写坏的例子。

### 写给贡献者与临床同行

- [`docs/VISION.md`](docs/VISION.md) —— 产品愿景。五维评分卡、差距分析、三年路线图、**非目标与红线**。
- [`docs/CONTRACT.md`](docs/CONTRACT.md) —— 并行开发共享契约：路由表、公共 API、CSS 类、写入范围、文案红线、依赖白名单。
- [`docs/PLAN.md`](docs/PLAN.md) —— 产品与技术计划：架构、安全伦理、排期、风险。
- [`docs/HANDOVER.md`](docs/HANDOVER.md) —— **交接清单**：上线阻断项、技术债、已知坑。
- [`CONTRIBUTING.md`](CONTRIBUTING.md) —— 怎么提 issue、怎么改代码、文案红线。
- [`ROADMAP.md`](ROADMAP.md) —— 公开路线图。
- [`CHANGELOG.md`](CHANGELOG.md) —— 版本变更记录。

---

## 部署

产物是纯静态文件：

```bash
npm run build
# 上传 dist/ 到任意静态托管
```

> ⚠️ 使用 `BrowserRouter`，静态托管需配置 **所有路径回退到 `index.html`**：
>
> - Nginx：`try_files $uri $uri/ /index.html;`
> - Vercel / Netlify：SPA rewrite 规则
> - 无法配置回退时：把 `main.tsx` 的 `BrowserRouter` 改为 `HashRouter`
>
> ⚠️ **部署后务必实测深层链接**：直接访问 `/scales/phq-9`（不要从首页点进去），确认页面正常。
> 本站资源路径为绝对路径 `/assets/...`；若改回 `base: './'`，两层及以上子路由会因 MIME 不符而整页白屏
> （详见 [`docs/HANDOVER.md`](docs/HANDOVER.md) 4.4）。
>
> 📌 若部署在**子目录**（如 `example.com/xinyu/`），需把 `vite.config.ts` 的 `base` 改成 `'/xinyu/'`，
> 并在路由配置里设置 `basename="/xinyu"`。

---

## 隐私

- **无上传**：没有任何网络请求携带你的记录。想验证？打开开发者工具的 Network 面板。
- **无账号**：不做登录，也就不存在"账号被盗"。
- **无埋点**：连匿名统计都没有。
- **导出由你发起**：`.sandplay.json` 只在你点了导出之后才生成，存在你选的位置。
- **格式层面拒绝身份信息**：`meta` 里出现 `realName` / `name` / `phone` / `idCard` / `email` / `address` / `wechat` 任一键名，校验直接失败。

局限性也说清楚：本地存储没有加密，共用设备上他人可读；浏览器清数据即丢失；`localStorage` 通常有 5–10 MB 上限。

安全问题的报告方式见 [`SECURITY.md`](SECURITY.md)。

---

## 许可

| 对象 | 许可 |
| --- | --- |
| 代码 | **Apache-2.0**（见 [`LICENSE`](LICENSE)、[`NOTICE`](NOTICE)） |
| 文档 | CC BY 4.0 |
| 沙具字形 | emoji 字形（Unicode License v3），无版权负担，可自由使用 |
| 你的数据 | **归你**。我们不主张任何权利 |

第三方依赖的完整许可证文本见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

选用 Apache-2.0 而非 MIT 是刻意的：它带明确的专利授权与贡献条款，更适合"希望被机构审计和采用"的项目。

---

## 重要提醒（请认真读）

1. **量表不是诊断工具**，分数只反映近期的自评状态。
2. **热线号码可能变更**。`src/resources/helplines.ts` 里每条都带 `verifiedAt`，正式上线前必须逐个拨打核验。
3. **本站不是危机干预服务**，不提供实时响应。若你或身边的人处于危险中，请立即联系专业机构或紧急服务。
4. **沙盘不做解读**。摆完之后你可能会想"这说明了什么" —— 心屿不会回答这个问题，因为它不该由软件回答。
