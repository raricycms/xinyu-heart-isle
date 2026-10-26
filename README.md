# 心屿 · Xinyu

一个温和的**心理自助工具站**：心理量表、赛博沙盘、情绪调节工具箱、心理援助资源汇总。

> **边界声明**：本站内容仅供自我了解与情绪调节参考，**不构成医学诊断或治疗建议**。
> 如果你正处在危险中，请直接联系专业援助（见站内 `/safety` 页面）。

---

## 快速开始

```bash
npm install
npm run dev       # http://127.0.0.1:5173
```

```bash
npm run build     # 生产构建 → dist/
npm run preview   # 预览构建产物
npm run typecheck # TypeScript 严格检查
```

---

## 功能

| 模块 | 路由 | 说明 |
| --- | --- | --- |
| 首页 | `/` | 心情签到、7 天趋势、每日引导语、模块入口 |
| 心理量表 | `/scales` | PHQ-9 / GAD-7 / PSS-10 / ISI / RSES，含计分与结果解读 |
| 赛博沙盘 | `/sandbox` | 拖拽象征物表达内在状态，可保存快照 |
| 情绪工具箱 | `/toolbox` | 呼吸、着陆、身体扫描、思维记录、担忧时间、三件好事 |
| 资源地图 | `/resources` | 危机热线 + 6 类心理资源 |
| 我的记录 | `/records` | 统一时间线、趋势图、导出 / 导入 / 清空 |
| 危机与求助 | `/safety` | 24 小时热线、分场景指引 |
| 关于与边界 | `/about` | 能力边界、技术说明、内容可信度 |

---

## 技术栈

- **Vite 8** + **React 19** + **TypeScript**（strict）
- **react-router-dom 7**（`BrowserRouter`）
- **纯 CSS** + 设计令牌（无 UI 库 / 无图表库 / 零多余依赖）
- **localStorage** 持久化，通过 `useSyncExternalStore` 订阅（支持跨标签页同步）

### 无后端 = 数据不出设备

没有账号、没有服务器、没有埋点。所有记录保存在当前浏览器的 `localStorage`：

```
xinyu.moods          xinyu.scaleResults   xinyu.sandbox
xinyu.toolSessions   xinyu.journal        xinyu.preferences
```

可在「我的记录」页**导出为 JSON 备份**、**导入恢复**、或**一键清空**。

---

## 目录结构

```
src/
├── lib/          # 公共层：类型 / 存储 / 日期 / id / toast / utils
├── components/
│   ├── ui/       # Button, Card, Tag, Progress, Notice, Empty, Stat
│   └── layout/   # AppShell（页头/导航/页脚）, PageHero
├── styles/       # global(设计令牌) + app + 各模块 css
├── scales/       # 量表数据 + 计分引擎
├── sandbox/      # 象征物 + 场景主题
├── toolbox/      # 工具元数据 + 各工具实现 + 计时 hook
├── resources/    # 热线数据 + 资源目录
├── pages/        # 10 个路由页面
├── App.tsx       # 路由表
└── main.tsx      # 入口
```

---

## 文档

- [`docs/PLAN.md`](docs/PLAN.md) —— **产品与技术计划文档**（产品定位、功能规划、架构、安全伦理、排期、风险、路线图）
- [`docs/CONTRACT.md`](docs/CONTRACT.md) —— 并行开发共享契约（路由表、公共 API、CSS 类、写入范围、文案红线）
- [`docs/HANDOVER.md`](docs/HANDOVER.md) —— **交接清单**（上线阻断项、技术债、已知坑）

---

## 当前验收状态

| 项目 | 结果 |
| --- | --- |
| `npx tsc -b --noEmit` | ✅ 0 错误 |
| `npx vite build` | ✅ 通过（67 modules / JS 434 kB gzip 141 kB / CSS 68 kB gzip 12.7 kB） |
| 13 个路由 × 桌面 + 移动 | ✅ 全部渲染，0 控制台错误，0 横向溢出 |
| 交互全流程（签到 / 量表 / 沙盘拖拽 / 计时 / 导出） | ✅ 通过 |

> **尚未完成、且上线前必须完成的两件事**：
> 1. 量表题干与分级文案由持证专业人士复核（ISI 第 1 题、RSES 第 8 题有改动或译法争议）
> 2. 12 条热线号码逐条拨打核验（`verifiedAt` 是收集日期，**不是拨打日期**）
>
> 详见 [`docs/HANDOVER.md`](docs/HANDOVER.md)。

---

## 部署

产物为纯静态文件：

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
> ⚠️ **部署后务必实测深层链接**：直接访问 `/scales/phq-9`（不要从首页点进去），
> 确认页面正常显示。本站资源路径为绝对路径 `/assets/...`；若改回 `base: './'`，
> 两层及以上子路由会因 MIME 不符而整页白屏（详见 [`docs/HANDOVER.md`](docs/HANDOVER.md) 4.4）。
>
> 📌 若部署在**子目录**（如 `example.com/xinyu/`），需把 `vite.config.ts` 的
> `base` 改成 `'/xinyu/'`，并在路由配置里设置 `basename="/xinyu"`。

---

## 重要提醒

1. **量表不是诊断工具**，分数只反映近期的自评状态。
2. **热线号码可能变更**，`src/resources/helplines.ts` 中每条带 `verifiedAt` 字段，
   正式上线前请逐个核验。
3. **本站不是危机干预服务**，不提供实时响应。若你或身边的人处于危险中，请立即联系专业机构或紧急服务。
