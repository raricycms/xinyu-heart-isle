# 变更记录

本文件的格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> **说明**：项目尚未正式发版，`package.json` 版本号为 `0.1.0`。下面的 `v2.0.0` 是**功能里程碑**的编号，
> 与 npm 包版本号暂不同步 —— 正式发版时会统一。

---

## [未发布]

### 计划中

- 移动端 30fps 真机复测
- 量表文案专业复核（ISI 第 1 题、RSES 第 8 题）
- 12 条热线逐条拨打核验

---

## [v2.0.0] — 2026-10

「沙盘」里程碑。核心是把 v1 的"贴纸画布"变成真正的沙盘，并把过程留下来。

### 新增

**介质层（D1）**

- 沙面 L2 高度场：128×96 单通道网格，0–255 映射 0–7cm，基准面 90
- 7 种笔刷：抬沙、挖沙、抹平、耙纹、喷水、压平、挖隧道
- 休止角物理松弛：干沙快速塌落、湿沙可以立起来（`relax()`）
- 干湿两态 + 分区湿度场（单通道 `W1` 编码）
- 2.5D 轴测渲染（`iso2d`），DOM 渲染默认路径
- 可选 3D 渲染器（`three` ^0.186，**仅动态 `import()`**，不进主包）

**象征层（D2）**

- 沙具从 59 个 emoji 扩展到 **327 个**，6 大类 / 24 子类
- 沙具检索（中文名 / 英文名 / id / 标签多字段打分）
- 按子类分组的浏览视图

**过程层（D3，护城河）**

- `SandSession` 会话模型 + `schemaVersion: 2`
- **19 种事件**的完整事件流：`item.add/move/scale/rotate/remove/note/affect/layer/bury`、
  `scene.change`、`surface.stroke/reset`、`session.start/phase/lock/save/import`、
  `annotation.add`、`reflection.edit`
- 事件重放（`replay()` / `replayAll()`），重放结果与当前画面严格一致
- 撤销 / 重做（命令栈，分叉时丢弃被撤销的分支）
- 时间轴回放：可拖到任意一步
- 关键节点标记（第一件摆件 / 第一次整理沙面 / 每次换场景）
- 逐帧标注（`annotation.add`，作者可为 `self` 或 `counselor`）
- 客观统计：摆件数、事件数、时长、各操作计数、最长停顿、九宫格分区分布、沙面改动比例、湿度比例
- 会话差异对比（只算事实差分，不写"进步/退步"）
- 会话续接（从某一步接着摆新的，只读源会话）

**关系层（D4）**

- 双模式：自助 / 咨询师协作 / 督导
- 本地档案（化名 + 本地 id，无账号）
- 封盘与归档
- 可打印的会话报告（客观摘要 + 截图 + 自述）
- 多会话对比

**生态层（D5）**

- `sandplay-session/v1` 格式规范：[`docs/FORMAT.md`](docs/FORMAT.md)
- JSON Schema（Draft 2020-12）：[`public/schema/sandplay-session-v1.schema.json`](public/schema/sandplay-session-v1.schema.json)
- 零依赖校验器 CLI：[`scripts/validate-session.ts`](scripts/validate-session.ts)
- 三个样例文件 + 说明：[`samples/`](samples/README.md)
- **Apache-2.0** 许可证（[`LICENSE`](LICENSE)）+ [`NOTICE`](NOTICE)
- 第三方依赖与资产台账：[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
- 社区文档：[`CONTRIBUTING.md`](CONTRIBUTING.md)、[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)、[`SECURITY.md`](SECURITY.md)、[`ROADMAP.md`](ROADMAP.md)

**工程**

- 轻量 i18n（`src/i18n/`，扁平键表 + 缺键回退，无第三方库）
- IndexedDB 存储层（`xinyu-db`：sessions / clients / assets / annotations）
- 静默模式
- 无障碍：键盘可达、44px 触摸目标

### 变更

- **数据模型**：从 v1 快照（`SandboxSnapshot`）改为 v2 会话（`SandSession` + 事件流）。
  旧快照自动迁移：生成 `session.start` + 每件一个 `item.add` + 一条 `session.import`（`from: "sandbox-snapshot/v1"`）
- **沙面存储**：从"只有背景色"改为 RLE + Base64 高度场（`S1` 容器）；湿度场用 `W1` 容器
- **导出格式**：从无格式的 JSON 备份改为带 `format` / `version` / `exportedAt` / `producer` 的自包含快照
- **依赖**：新增 `three`（可选 3D，动态加载）、`vitest`、`puppeteer-core`（开发依赖）

### 修复

- 修正历史上 `SandboxItem.scale` 的类型注释（写 `0.5~2`，实际 clamp 到 `0.2~4`）
- 修正 `docs/CONTRACT.md` 路由表遗漏 `/sandbox/session/:id/report`

### 安全

- **隐私红线**：`meta` 中出现 `realName` / `name` / `phone` / `idCard` / `email` / `address` / `wechat`
  任一键名，格式校验直接失败（error，非 warning）
- 本地录音与自定义图**默认不导出**，需显式勾选
- 沙面解码全部做边界检查，损坏数据回退空白沙面而非抛异常

### 已知问题

- 移动端 30fps 未在目标机型上复测
- 导入 `.sandplay.json` 时无文件大小上限
- 校验器不检查 `items` 与 `events` 的重放一致性（内部 `isConsistent()` 会检查）

---

## [v1.5.0] — 2026-09

「定型」里程碑。数据格式、许可证、文档体系就位。

### 新增

- `.sandplay.json` 概念与初步导出（结果 + 过程）
- 沙面 L2 原型：高度场 + 笔刷 + 休止角
- 代码许可证（Apache-2.0）、`NOTICE`、第三方台账
- `CONTRIBUTING.md`、`i18n` 抽取

---

## [v1.1.0] — 2026-08

「打磨」里程碑。

### 新增

- 沙面质感 L1（纹理 + 耙纹 + 沙声）
- 事件流 + 撤销/重做
- 象征物 59 → 120 个（首批）
- 沙具搜索与收藏
- 计分引擎单元测试

### 修复

- 补上历史遗留的计分引擎测试覆盖

---

## [v1.0.0] — 2026-07

初版。一个纯静态的心理自助工具站。

### 新增

- **心理量表**：PHQ-9 / GAD-7 / PSS-10 / ISI / RSES，含计分与结果区间说明
- **赛博沙盘**（v1）：拖拽 emoji 摆件 + 5 个场景主题 + 保存快照
- **情绪工具箱**：4-7-8 呼吸、方块呼吸、5-4-3-2-1 着陆、身体扫描、思维记录表、担忧时间、三件好事
- **资源地图**：12 条心理援助热线 + 6 类心理资源
- **我的记录**：统一时间线、趋势图、导出 / 导入 / 清空
- **危机与求助** `/safety`：24 小时热线、分场景指引
- **关于与边界** `/about`：能力边界、技术说明
- 纯前端架构：`localStorage` + `useSyncExternalStore`，无后端、无账号、无埋点
- 设计令牌体系（纯 CSS），无 UI 库

---

## 版本号说明

| 编号 | 含义 |
| --- | --- |
| `v1.0.0` | 初版：量表 + 沙盘 v1 + 工具箱 + 资源 |
| `v1.1.0` | 打磨：沙面质感、事件流雏形 |
| `v1.5.0` | 定型：数据格式、许可证、文档 |
| `v2.0.0` | 沙盘：沙面 L2、事件流完整化、档案、对比、报告、生态文档 |
| `v2.5.0`（计划） | 协作：批注、督导视图、会谈管理、PWA |
| `v3.0.0`（计划） | 生态：沙具包市场、规范 v1.0、研究模式、顾问委员会 |

**注意**：在心屿的语义里，「v2.0」指的是**沙盘成熟**，不是"破坏性变更"。
数据格式的兼容性由 `sandplay-session/v1` 里的 `version` 字段单独管理，与产品版本号无关。
