# 开源"赛博心理沙盘"调研报告

> 调研时间：2026-10-26 ｜ 数据源：GitHub REST API（仓库元数据）+ 各仓库 README 原文
> 判定口径："赛博心理沙盘"= 可交互的沙盘/模拟环境，且其模拟对象是**心理状态与心理动力学**（而非纯社会行为或纯图像分类）。

## 结论速览

**不存在成熟的、可直接使用的开源"赛博心理沙盘"。** 四个方向呈现明显断层：

| 子领域 | 开源供给 | 最高星标 | 结论 |
|---|---|---|---|
| A 数字沙盘/箱庭 | 论文原型 + 个人练手项目 | 7★ | 有"形态"，无"临床可用性"；多数无 license |
| B 智能体心理沙盘 | 成熟引擎（社会模拟），但与临床心理学脱节 | 22,290★ | 是最好的"地基"，不是成品 |
| C 心理剧/治疗性角色扮演 | 近乎空白 | 4★ | 心理剧在 GitHub 上几乎没有工程化实现 |
| D 中文「心理沙盘」原型 | 若干个人/比赛原型，仅 1 个有 LICENSE | 0★ | 形态最贴国内咨询场景，唯一可合法二次开发的是 AGPL-3.0 的 sandtray-community |

## 先看检索矩阵：这个词本身几乎搜不到东西

| GitHub 检索词 | 命中 | 实际内容 |
|---|---|---|
| `赛博沙盘`（精确短语） | **1** | 只有 raricycms/xinyu-heart-isle（当天新建） |
| `赛博心理` | 35 | 全是赛博朋克 UI、八字命理、停车场系统等噪音 |
| `心理沙盘 AI` / `心理沙盘 LLM` | **0 / 0** | 没有项目把「心理沙盘」和 AI 同时写进元信息 |
| `心理剧 沙盘`（AND） | **1** | 只有 Empathy-Theater |
| `psychodrama` | 21 | 全部无关（空仓库 / twisted server / 剧场资料） |
| `sandplay therapy` | 37 | 多为 "Minecraft 沙盒" 同名污染 |
| Gitee `心理沙盘` | 未核实 | API 未认证调用返回 `[]`，但对照组 `q=vue` 同样返回 `[]`，网页端有 405 验证码拦截 → **不能据此断言 Gitee 没有** |

> 结论：**「赛博心理学沙盘」不是开源社区术语，而是中文互联网的命名**。真正按这个语义做出来的东西，散落在「数字沙盘」「AI 心理剧」「多 Agent 心理模拟」三个互不通信的圈子里。

## 候选清单（A/B/C 英文侧 12 项，均已拉取仓库元数据）

| # | 项目 | 星标 | 语言 | License | 最后推送 | 贴合度 | README 核实 |
|---|---|---|---|---|---|---|---|
| 1 | cs-sandtray/sand-tray | 5 | HTML | 无 | 2025-06-30 | 高 | 已读 |
| 2 | grLuca/sandplay-simulator | 1 | JavaScript | 无 | 2026-05-13 | 高 | 已读 |
| 3 | Chenkehan21/sandplay | 7 | Python | 无 | 2023-07-08 | 中 | 元数据 |
| 4 | sejinq/sandtrayDiagnosis | 1 | Prolog | 无 | 2017-05-09 | 中 | 元数据 |
| 5 | joonspk-research/generative_agents | 22,290 | —（JS/Python） | Apache-2.0 | 2024-08-05 | 中 | 元数据 |
| 6 | google-deepmind/concordia | 1,828 | Python | Apache-2.0 | 2026-10-20 | 中高 | 已读 |
| 7 | a16z-infra/ai-town | 10,705 | TypeScript | MIT | 2026-08-26 | 中低 | 元数据 |
| 8 | martinezmarcos93/psyche-simulacra | 1 | Python | MIT | 2026-10-22 | 高 | 元数据 |
| 9 | sotopia-lab/sotopia | 341 | Python | MIT | 2026-06-05 | 中高 | 元数据 |
| 10 | travistoner/Empathy-Theater | 1 | TypeScript | 无 | 2026-02-04 | 高 | 已读 |
| 11 | inteiros/VRET-AI_Fear_Detection | 4 | ShaderLab | 无 | 2024-11-21 | 中低 | 元数据 |
| 12 | Franky100-pig/Sand-and-Ink | 5 | JavaScript | MIT | 2026-10-25 | 低 | 元数据 |

---

## A. 数字沙盘 / 箱庭疗法

### 1. cs-sandtray/sand-tray —— 最接近"AI 沙盘"的公开实现
- URL: https://github.com/cs-sandtray/sand-tray
- 5★ ｜ HTML ｜ 无 license ｜ 最后推送 2025-06-30 ｜ 仓库已于 2026-08-10 **归档**
- 核心功能：项目代号 MEMTEA，明确"受传统沙盘疗法启发"的 AI 辅助数字沙盘。README 描述两种模式：① AI 引导式创作沙盘（AI 陪用户逐步摆放、引导自我探索）；② 交互共创沙盘（用户与 AI **轮流**摆放沙具的回合制体验），并附带一篇研究论文 PDF。
- 成熟度：论文/毕设级原型，已归档、无 license（法律上不可二次分发），不可直接用于产品。
- 贴合度：**高**——"沙具 + 沙盘空间 + AI 共同摆放 + 象征叙事"四要素齐全，是唯一把"沙盘会话"流程写清楚的仓库。

### 2. grLuca/sandplay-simulator —— 可跑通的"沙盘 + AI 解读"闭环
- URL: https://github.com/grLuca/sandplay-simulator
- 1★ ｜ JavaScript ｜ 无 license ｜ 最后推送 2026-05-13
- 核心功能：纯前端单页心理沙盘（双击 index.html 即可用，无后端、无数据库、无需 API Key）。用户选沙盘、拖拽摆放沙具（可旋转/缩放/置顶/层叠），记录作品标题、**当前情绪、关键词、自我叙述**，一键导出"仅含沙盘区域"的 PNG 与 JSON；再把截图 + 提示词喂给 GPT / ChatGPT 等支持图像理解的模型，得到"温和的诠释报告与反思引导"。
- 成熟度：个人原型，含 Playwright 测试；README 明确声明"不做诊断、不做治疗、不适合替代专业支持"，合规意识较好。
- 贴合度：**高**——完整走通"表达 → 记录 → AI 诠释"链路，是自建产品时最省事的交互参照（中文文档）。

### 3. Chenkehan21/sandplay —— 沙盘作品的自动分类
- URL: https://github.com/Chenkehan21/sandplay
- 7★ ｜ Python ｜ 无 license ｜ 最后推送 2023-07-08
- 核心功能：仓库自述为 "sandplay scene classification"，即用视觉/深度学习模型对沙盘作品图像做场景类别识别，属于**沙盘分析自动化**，不提供沙盘交互。
- 成熟度：研究/课程原型，2023 年后停滞。
- 贴合度：**中**——只覆盖"评估侧"，可作为"作品 → 特征 → 解释"的一环，但不是沙盘本身。

### 4. sejinq/sandtrayDiagnosis —— 把沙盘象征规则形式化
- URL: https://github.com/sejinq/sandtrayDiagnosis
- 1★ ｜ Prolog ｜ 无 license ｜ 最后推送 2017-05-09
- 核心功能：Java 与 Prolog 联动，为沙箱疗法（모래상자 기법）构建心理诊断推理系统（韩文描述）。价值在于把"沙具象征 → 心理推断"写成可执行的规则库。
- 成熟度：学生项目，2017 年后无更新。
- 贴合度：**中**——若要做"沙盘象征知识图谱/推理层"，这是罕见的可参考样本。

### 关于 "World Technique" / Lowenfeld
- 检索 `lowenfeld OR "world technique"` 返回 49 个仓库，**前列均为无关内容**（MDN 的 JS 教程、客户分群 notebook）。
- **未发现任何开源的 World Technique / Lowenfeld 世界技法实现**（未核实项：若存在，未在 GitHub 公开检索面暴露）。
- 补充：中文生态有商业产品（如"MindSandbox 虚拟心理沙盘室"），但**未开源**，未核实其代码。

## B. 智能体 / LLM 驱动的心理模拟沙盘

### 5. joonspk-research/generative_agents（Stanford Smallville）
- URL: https://github.com/joonspk-research/generative_agents
- 22,290★ ｜ 语言未识别（JS+Python 混合）｜ Apache-2.0 ｜ 最后推送 2024-08-05
- 核心功能：25 个 LLM 智能体在 2D 小镇中生活，靠 **memory stream（记忆流）+ reflection（反思）+ planning（计划）** 产生连贯的日常行为，并自发组织出情人节派对等群体事件。
- 成熟度：高——论文官方实现，代码稳定但已停更（2024-08），生态与衍生项目极多。
- 贴合度：**中**——是"行为沙盘"的经典认知架构（记忆/反思可直接复用），但**不显式建模心理状态、症状或治疗关系**，没有评估与干预语义。

### 6. google-deepmind/concordia —— 最好的"心理沙盘引擎"底座
- URL: https://github.com/google-deepmind/concordia
- 1,828★ ｜ Python ｜ Apache-2.0 ｜ 最后推送 2026-10-20 ｜ PyPI: `gdm-concordia`
- 核心功能：生成式社会模拟库。**Game Master** 扮演环境、裁决行动是否物理/社会可行；每个 entity 由可插拔 **components**（指令、记忆、行动选择等）组成，prefab 作为实体模板。README 明确面向社会科学研究、AI 安全与伦理、**认知神经科学**、经济学、合成数据生成。
- 成熟度：高——DeepMind 维护、有技术报告（arXiv 2312.03664）与设计模式论文、持续更新、有 GUI/CLI 编辑器。
- 贴合度：**中高**——示例智能体按 March & Olsen (2011) 三问推理（"这是什么情境／我是什么样的人／像我这样的人在此情境会怎么做"），这正是心理学可插槽位；但仓库**本身不含临床心理学语义**（无沙盘、无治疗流程、无量表）。

### 7. a16z-infra/ai-town
- URL: https://github.com/a16z-infra/ai-town
- 10,705★ ｜ TypeScript ｜ MIT ｜ 最后推送 2026-08-26
- 核心功能：可一键部署的 "AI 小镇" starter kit（Convex 后端 + Pixi 渲染），角色自主移动、对话、社交，地图/角色/对话规则可自定义。
- 成熟度：高——工程化模板，文档完善，持续更新。
- 贴合度：**中低**——通用社会沙盘，无心理学建模；但对"赛博沙盘"的**可部署性、可视化、多用户观看**有直接参考价值。

### 8. martinezmarcos93/psyche-simulacra —— 概念上最"心理学沙盘"的 ABM
- URL: https://github.com/martinezmarcos93/psyche-simulacra
- 1★ ｜ Python ｜ MIT ｜ 最后推送 2026-10-22
- 核心功能：基于智能体的模型，为个体配置**荣格心理学画像**，研究等级秩序、符号、禁忌与神话如何在群体中涌现（仓库 topics 含 jungian-psychology / collective-unconscious / computational-psychology）。
- 成熟度：极低——个人项目，1★，无社区。
- 贴合度：**高**（概念层）——"心理结构 → 群体动力学"正是心理沙盘的隐喻内核；但工程与实证都很薄，只能当思想原型。

## C. 心理剧 / 角色扮演 / 治疗性模拟

### 9. sotopia-lab/sotopia
- URL: https://github.com/sotopia-lab/sotopia
- 341★ ｜ Python ｜ MIT ｜ 最后推送 2026-06-05 ｜ ICLR 2024 spotlight
- 核心功能：开放式社会学习环境。两个智能体带着各自的**私有社会目标、秘密、背景**进入场景进行角色扮演对话，再由评审模型从目标达成、社会规范、可信度、关系变化等多维度打分。
- 成熟度：中高——学术团队维护，有 docs.sotopia.world、多篇后续论文（sotopia-π / sotopia-rl）。
- 贴合度：**中高**——"带隐藏心理动机的角色扮演 + 多维评估"最接近心理剧与社交技能训练；但目标是训练 AI 社交智能，没有治疗框架。

### 10. travistoner/Empathy-Theater（共情剧场）
- URL: https://github.com/travistoner/Empathy-Theater
- 1★ ｜ TypeScript ｜ 无 license ｜ 最后推送 2026-02-04
- 核心功能：自我定位为"**AI 辅助的心理剧沙盘 (AI Psychodrama)**"。Next.js 应用：用户输入最害怕或最渴望的社交场景 → AI 生成像素风场景与 NPC → 多 NPC 对话 → `Ctrl+R` **角色反转**（看 AI 如何模仿自己）→ 结束生成心理分析报告；底层接 ModelScope GLM-4.7-Flash 对话 + 通义 Z-Image 出图。
- 成熟度：极低——个人项目、无 license、强依赖第三方 API，图像生成 1–5 分钟。
- 贴合度：**高**——目前检索到的**唯一**把"心理剧 + 角色反转 + 沙盘"写进产品逻辑的开源实现（中文文档）。

### 11. inteiros/VRET-AI_Fear_Detection
- URL: https://github.com/inteiros/VRET-AI_Fear_Detection
- 4★ ｜ ShaderLab（Unity）｜ 无 license ｜ 最后推送 2024-11-21
- 核心功能：海洋恐惧症（thalassophobia）VR 暴露治疗：NeuroSky Mindwave 脑电 + CNN 实时检测恐惧，检测到不适时**动态降低暴露强度**，形成闭环自适应治疗。
- 成熟度：极低——毕设/课程级，无文档化部署。
- 贴合度：**中低**——是"治疗性情境模拟"，但无象征表达、无沙盘生成性，与心理剧也不同源。

### 12. Franky100-pig/Sand-and-Ink
- URL: https://github.com/Franky100-pig/Sand-and-Ink
- 5★ ｜ JavaScript ｜ MIT ｜ 最后推送 2026-10-25
- 核心功能：离线"沙与墨"艺术沙盒：落沙物理 + 水墨流体 + 纯艺术模式，无账号、无网络、不存数据；仓库 topics 含 art-therapy、sandplay、meditation、stress-relief。
- 成熟度：低——2026-09 新建项目。
- 贴合度：**低**——它提供的是"沙"这一媒介的**手感与减压体验**，不是临床沙盘；但作为"数字沙介质"的渲染参考有价值（MIT 可商用）。

## D. 中文生态：2026 年集中冒出的「数字心理沙盘」

> 这组是按「心理沙盘 / 箱庭 / 赛博沙盘」逐个拉元数据 + 文件树 + README 核实的结果。共同特征：**几乎全部 0 star、单作者、2025–2026 新建**；10 个里 **9 个没有 LICENSE**（唯一例外是下面的 sandtray-community，AGPL-3.0），但形态比英文项目更接近国内咨询场景。

### 13. u8901006/sandtray-community —— 唯一有正规 LICENSE 的 3D 沙盘（可自架、双人协作）
- URL: https://github.com/u8901006/sandtray-community ｜ 单机版：https://github.com/u8901006/sandtray
- 0★ ｜ TypeScript ｜ **AGPL-3.0（有 LICENSE 文件）** ｜ 建仓 2026-10-24 ｜ 约 52MB
- 核心功能：面向治疗场景的**双人协作 3D 沙盘**——两座沙盘、物件动画、逐物件操作授权、撤回、实时同步、会谈内保存/恢复、PNG 导出，还有可探索的自然庭园。技术栈 TS + React + Three.js，后端用 Cloudflare Workers + Durable Objects（OIDC 登录），带 Playwright 冒烟测试、`specs/` 契约文档、`THIRD_PARTY_NOTICES.md` 与素材授权台账。
- 规模：809 个文件、293 个 `.glb`、52 个测试；**270 件 Kenney/Quaternius 的 CC0 沙具可商用**，这是它相对其他项目最硬的差异点。
- 成熟度：**工程规范最好**（CI + 契约测试 + 素材授权台账 + CHANGELOG），作者自述「公开候选版，尚未完成临床发布验收」。
- 贴合度：**高**——「双人共建 + 实时同步」正好对应「治疗者在场」的箱庭设置；AGPL-3.0 意味着**可以合法二次开发，但衍生作品必须同样开源**。

### 14. Dilute2377/mind-sandbox（MindSandbox 虚拟心理沙盘室）
- URL: https://github.com/Dilute2377/mind-sandbox
- 0★ ｜ Vite + Three.js + 原生 JS（GitHub 语言标为 Python）｜ 无 license ｜ 2026-09-13 ｜ 仓库约 232MB
- 核心功能：本地优先的 3D 沙盘室原型。可旋转 3D 沙盘 + 摆件展柜 + 物理摆放；摆件搜索/放置/移动/旋转/缩放/删除/撤销；沙面高度变化与笔画记录；「实质创作动作」才启动会话（浏览不污染临床时序）；封盘后锁定并支持**时间轴回放**；临床过程抽屉输出客观事件统计与文字报告；标准中文 JSON 导出。声称含 **300 件正式摆件资源**。
- 成熟度：**中文项目里工程完成度最高**（有 `node --test` 测试、Blender 资产管线、设计文档）。但 2026-09 建仓、0 讨论、无 license。
- 贴合度：**最高**——「沙盘 + 摆件 + 过程记录 + 回放 + 客观复盘」全链路都有，且明确写了「不做诊断、不自动推断心理意义」的伦理边界。README 提到公众号文章《沙盘不是"看图说话"：从一间真实沙盘室，到 MindSandbox 虚拟心理沙盘室》。
- 注意：无 LICENSE 文件 → 公开可读但**不可合法二次分发/商用**，只能作设计参照。

### 15. tenntsitinn/blocksandbox-prototype（心灵沙境 BLOCK_SANDBOX）
- URL: https://github.com/tenntsitinn/blocksandbox-prototype
- 0★ ｜ HTML + Canvas 2D ｜ 无 license ｜ 2026-07 建仓（TRAE AI 创造力大赛「社会服务赛道」参赛作品）
- 核心功能：纯前端、零安装的 2.5D 在线沙盘。标准沙盘 72×57×7cm（24×18 单位格）；轴测/俯视双视角同步；初始地形按正态分布生成、相邻高差 ≤1 厚度；「理沙」模式移沙、退出后可拖拽沙具；内置沙具图像编辑器（用于纠正大模型出图）。规划中：WebSocket 实时协同、动作时间轴、会话存档、AI 辅助分析。
- 实测文件：`entry.html`(9.7KB)、`sandbox-standard.html`(86KB)、`toys.js`(79KB)、`pixel-editor.html`(70KB)、`server.js`、`i18n.js`、`sound-manager.js`；注意仓库里是 **`README.txt`（8.6KB）而不是 README.md**，按 README.md 抓会 404。
- 运行方式：纯静态双击 `entry.html` 即可；完整功能 `node server.js` → `http://localhost:8600/entry.html`。README.txt 自述「正式版 1.0」，含 24×18 沙面、5 档沙高、Box-Muller 正态初始化、三语 i18n、Web Audio 合成音效。
- 成熟度：比赛 Demo，无 license；作者自述沙具库仅测了 3 个，「时间轴/多人协同/AI 分析」仍是待实现。
- 贴合度：**高（交互层）**——「浏览器内可交互沙盘 + 沙面物理 + 双视角」是最轻的可抄形态；咨询师端/来访者端实时同步是它没做完的部分。

### 16. raricycms/xinyu-heart-isle（心屿）
- URL: https://github.com/raricycms/xinyu-heart-isle
- 0★ ｜ TypeScript ｜ 无 license ｜ 2026-10-26 建仓（就是今天）
- 核心功能：纯前端心理自助工具站（Vite 8 + React 19 + TS strict），`/sandbox` 路由即「赛博沙盘」：拖拽象征物、存快照到 localStorage；另有量表 / 情绪工具箱 / 资源地图。这是目前 GitHub 上**唯一直接把模块命名成「赛博沙盘」**的公开仓库（全站搜「赛博沙盘」精确短语仅此 1 条）。
- 成熟度：2026-10-26 当天建仓（165KB），README 自评 `tsc` 0 错误、`vite build` 通过，但无 star、无 license，可信度需要时间验证。
- 贴合度：中——命名最贴题，但更像「心理自助工具合集」里的一个子模块。

### 17. 2020wenfeng-dev/sandplay（箱庭之心）
- URL: https://github.com/2020wenfeng-dev/sandplay
- 0★ ｜ HTML ｜ 无 license ｜ 2026-06-11
- 核心功能：**单文件 `index.html`（60KB）**的网页版心理沙盘（箱庭疗法）游戏，无 README、无构建、无依赖。
- 贴合度：中——「一个 HTML 就能玩的箱庭」的极简样本，适合快速看交互原型，不具备临床流程。

### 18. 其余「空壳/声明型」仓库（避免踩坑）
- [XiyaoDai/suxin-sandbox](https://github.com/XiyaoDai/suxin-sandbox)：自述「面向 12–22 岁青少年、遵循荣格箱庭疗法 + 张日昇标准化沙盘体系」，但仓库仅 1KB，**空壳**。
- [zhangpeng623/agno-sandbox](https://github.com/zhangpeng623/agno-sandbox)：自述「心理沙盘智能体」，但 `main.py` 0 字节、README 4 行、直接把 `.env` 与 `agno.db` 提交进仓库，**空壳 + 密钥泄露风险**。
- [xinshifengkezhi/psySandbox](https://github.com/xinshifengkezhi/psySandbox)：自述「心理沙盘深度学习项目」，实际是「沙盘操作日志 → 图神经网络训练/可解释性」的研究代码（txt→CSV→建图→训练→边重要性），依赖私有沙盘软件日志数据集，缺数据跑不通，非可交互沙盘。
- [cnshsliu/sandplay-ai-training-skill](https://github.com/cnshsliu/sandplay-ai-training-skill)：给 Claude Code / Codex 用的「多彩AI沙盘 AI 心理训练」skill（仅 9KB，`production only`），是提示词/技能包而非应用。
- [Piggywu981/ie-research-simulation](https://github.com/Piggywu981/ie-research-simulation)（5★, MIT）：**ERP 企业沙盘**，与心理无关，检索时会被「沙盘」二字误伤。
- [Benioh/Adolescent-Depression-Simulator](https://github.com/Benioh/Adolescent-Depression-Simulator)（14★，Python，无 license，2025-05 后停更）：**这是「心理沙盘」相关检索里星标最高的项目，但它跑错赛道**——7 个 Agent 模拟青少年抑郁 30 天发展 + 咨询对话 + AI 督导 + 治疗联盟追踪。可作为「多 Agent 心理状态建模」参考，但不是沙盘。

> **Gitee 侧：未能核实。** `gitee.com/api/v5/search/repositories?q=心理沙盘` 返回 `[]`，但对照组 `q=vue` 同样返回 `[]`（未认证调用已被静默禁用），网页搜索只回 JS 外壳、explore 页返回 405 验证码 → 需要令牌或人工浏览器检索才能下结论，**不能据此说 Gitee 上没有**。

### 19. 中文商业产品（未开源，作为需求参照）
- 「沙盘心灵岛」：iOS 端，触控塑沙、多人会话、AI 分析、语音聊天，321MB，iOS 独占。
- 「舒凡」3D 电子沙盘：B 端硬件一体化方案。
- 心言集团 3D 心理沙盘：宣称用 AI 解码情绪（[DoNews 报道](https://www.donews.com/news/detail/4/5542936.html)）。
- 另有「AI 电子心理沙盘」进入戒毒所等场景的报道（[法治日报](http://h5epaper.legaldaily.com.cn/content/20260907/Articel07004SR.htm)）。
> 结论：**数字心理沙盘在国内已经是「有市场、有硬件、有 iOS 产品，但开源生态近乎为零」的状态**——上面 6 个仓库加起来不到 10 star。

---

## 综合判断

### 1) 现在有没有成熟的开源"赛博心理沙盘"？
**没有。** 四条证据：
- **中英文项目全部加起来，最高星标 22,290★（但那是通用社会模拟引擎 generative_agents）；真正的「心理沙盘」相关仓库几乎全是 0–7★**；本报告核实的中文候选（10 个）里 **只有 1 个有 LICENSE（sandtray-community，AGPL-3.0）**，其余 9 个都是「公开但未授权」。
- A 类全部是论文原型或个人练手项目，最高 7★，且 **5 个 A 类项目里 5 个无 license**——法律上不可直接复用，这是比"代码不成熟"更硬的障碍。
- B 类有工业级引擎，但它们是**社会模拟**引擎，不是**心理临床**工具：没有症状维度、没有治疗阶段、没有伦理与危机处理层。
- C 类心理剧几乎空白：GitHub 搜索 `psychodrama` 仅 21 个仓库，最高 1★，且多为无关项目（如用"心理剧"命名的 LLM 决策协议）。

### 2) 最接近的积木（建议的组合路径）
| 层 | 选型 | 理由 |
|---|---|---|
| 模拟引擎 | **concordia**（Apache-2.0，活跃） | GM + components 架构天然可插入"心理状态"组件；有学术引用与 GUI 编辑器 |
| 认知架构 | **generative_agents**（Apache-2.0） | memory stream / reflection / planning 可直接复用为"来访者记忆与自我叙事" |
| 可部署外壳 | **ai-town**（MIT） | TypeScript 全栈 + 可视化，适合做产品化前端 |
| 沙盘交互与会话流程 | **cs-sandtray/sand-tray** + **grLuca/sandplay-simulator** | 前者给"AI 引导/轮流共创"双模式，后者给"作品导出 + AI 诠释"闭环（注意二者均无 license，只能借鉴设计，不能抄代码） |
| 合法可复用的沙盘内核与资产 | **u8901006/sandtray-community**（AGPL-3.0） | 唯一有 LICENSE 的 3D 双人沙盘 + 270 件 CC0 沙具 + 授权台账；AGPL 有传染性，闭源产品只能参考架构 |
| 沙盘过程记录格式 | **Dilute2377/mind-sandbox**（无 license） | 中文 JSON 会话导出 + 客观事件流（放弃/置换/深埋/锁定）是唯一成体系的箱庭过程 schema，可作字段设计参照 |
| 心理参数化 | **psyche-simulacra**（MIT） | 荣格画像→群体动力学的参数设计参考 |
| 角色扮演与评估 | **sotopia**（MIT） | 带隐藏动机的对话 + 多维度评分，可改造为心理剧评估 |

### 3) 真实缺口（不要自欺）
1. **没有沙具象征的标准数据模型**：沙具分类、空间语义（方位/密度/边界/空区）、序列时序，都没有公开 schema。现有项目都是硬编码自己的沙具列表。
2. **没有临床量表对接**：没有任何仓库把沙盘作品特征与标准化评估（如沙盘作品评定量表、症状自评）打通。
3. **没有治疗伦理与安全层**：危机识别、转介、知情同意、未成年人保护，在所有候选项目中都缺失（grLuca 仅在 README 里写了免责声明）。
4. **许可证是最大风险**：A 类与 C 类最适合"心理沙盘"的项目**全部无 license**；中文 10 个候选里只有 `sandtray-community` 有明确 LICENSE（AGPL-3.0，有传染性），其余「公开但未授权」= 法律上只能看、不能抄、不能商用。
5. **沙具资产是隐藏门槛**：只有 `sandtray-community` 提供了带授权台账的 **270 件 CC0 沙具**（Kenney/Quaternius）可直接商用；`mind-sandbox` 有 628 个 `.glb`（约 1857 文件）但没有逐件授权记录，用进产品有版权风险。
6. **心理剧的治疗机制没有被工程化**：角色反转、替身、镜照这些技术，只有 Empathy-Theater 用了一个 `Ctrl+R` 草草实现，且无任何疗效验证。
7. **"心理"多是 prompt，不是模型**：psyche-simulacra 以外，几乎没有项目把心理状态做成**可计算、可观测、可验证的状态变量**——这是"沙盘"与"聊天机器人"的分水岭。
8. **最独特的一块空白：荣格沙具象征编码体系**。沙具象征分类本体、九宫格区域编码、首次摆放/移动轨迹编码，开源界**零实现**；治疗师侧的多会话纵向档案、逐帧标注、督导对比工具也完全没有。psySandbox 只到「沙具名+语义 → 向量 → 三分类」，cs-sandtray 只有论文、没有编码表。

### 4) 一句话建议
如果目标是**做研究**：用 Concordia 起底，自己写 psychology components + 沙盘象征 ontology，参数量化后再谈验证。
如果目标是**做产品**：先用 ai-town 的壳 + generative_agents 的记忆架构做 MVP，沙盘交互照抄 cs-sandtray 的双模式设计（重写实现以规避 license），AI 诠释层参考 grLuca 的"截图 + 结构化记录 → 多模态模型"管线。
如果目标是**做国内咨询场景的沙盘**：唯一能合法二开的是 `sandtray-community`（AGPL-3.0 + 270 件 CC0 沙具 + 双人实时协作，代价是衍生作品必须开源）；要闭源商业化，就只能把 MindSandbox 当"功能清单 + 交互参照"（3D 沙盘、300 摆件、封盘锁定、时间轴回放、客观临床抽屉）、把 blocksandbox 当"最轻的浏览器沙盘基线"（Canvas 2.5D + 沙面高度物理 + 双视角），**参考设计与流程、代码全部重写**——这恰好也解释了为什么国内没有可直接 fork 的开源沙盘。

## 已核实但无结果的方向
- `therapy roleplay LLM simulation`：GitHub 返回 **0 条**。
- `lowenfeld / "world technique"`：49 条，**无相关实现**。
- `sandplay therapy`（关键词）：37 条，绝大多数是"Minecraft 沙盒游戏"等同名污染，真正相关的仅本报告 A 类 4 项。
- `psychodrama`：21 条，**无一为临床心理剧系统**。
