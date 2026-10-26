# 第三方组件与资产台账

> 本文件是「心屿 / Xinyu」的分发合规台账，面向打包者、机构采购与法务审阅。
> 每一段都回答同一个问题：**如果你再分发本站或它的构建产物，你需要额外做什么？**
>
> 相关文件：[`LICENSE`](./LICENSE)（Apache-2.0 全文）、[`NOTICE`](./NOTICE)、
> [`docs/CONTRACT.md`](./docs/CONTRACT.md) §7（依赖白名单）。

---

## 一、结论先行

| 项 | 结论 |
| --- | --- |
| 本站代码 | Apache-2.0，**无 AGPL/GPL 传染性依赖**，可闭源集成、可商用 |
| 运行时依赖 | 4 个：`react`、`react-dom`、`react-router-dom`（均 MIT）、`three`（MIT） |
| 沙具资产 | **327 个沙具，全部是 Unicode emoji 字符**，不以文件形式分发任何图片 |
| 图片 / 字体 / 音频 | **不包含**任何需要署名或付费的素材 |
| 需随分发携带的文件 | `LICENSE`、`NOTICE`、本文件（Apache-2.0 §4(d)） |

因此：**再分发本站时，唯一必须做的事是把 `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md`
三个文件一起带上，并保留 `NOTICE` 中的版权行。** 没有额外的图片署名列表要抄。

---

## 二、依赖台账（运行时）

版本号取自本仓库锁定的实际安装版本（`package-lock.json`，2026-10 快照）。

| 依赖 | 版本 | 许可证 | 用途 | 进入主包？ |
| --- | --- | --- | --- | --- |
| `react` | 19.3.1 | MIT | UI 框架；全部页面与组件 | ✅ 是 |
| `react-dom` | 19.3.1 | MIT | 浏览器渲染器（`createRoot`） | ✅ 是 |
| `react-router-dom` | 7.18.4 | MIT | 客户端路由（`BrowserRouter`，见 `docs/CONTRACT.md` §3.1） | ✅ 是 |
| `three` | 0.186.1 | MIT | 可选 3D 沙盘渲染器（`src/sandbox/render/three.tsx`） | ❌ 否 —— 经**动态 `import()`** 切为独立 chunk，只在用户切换到 3D 视图时下载；加载失败会静默回退到 2.5D |

### 2.1 为什么 `three` 不算进主包

`src/sandbox/render/index.tsx` 用 `React.lazy(() => import('@/sandbox/render/three'))` 引入它。
这是 `docs/CONTRACT.md` §7 的体积预算要求（主包 gzip ≤ 175KB）：
Three.js 是唯一会把主包撑大的依赖，因此必须走动态导入。
**默认渲染器是 2.5D（`iso2d`），不下载 three 也能完整使用沙盘。**

### 2.2 MIT 许可证的义务

四个运行时依赖都是 MIT。MIT 的要求只有一条：**在副本中保留版权声明与许可声明**。
本文件与 `LICENSE`、`NOTICE` 一起随仓库分发即满足该要求；若你只分发 `dist/` 构建产物，
请把这三个文件一并附上（或在你自己的 `THIRD_PARTY_NOTICES` 中保留本节表格与版权行）。

各依赖的版权行如下（原文照录）：

```
react, react-dom
Copyright (c) Meta Platforms, Inc. and affiliates.

react-router-dom
Copyright (c) React Training LLC 2015-2019
Copyright (c) Remix Software Inc. 2020-2021
Copyright (c) Shopify Inc. 2022-2023

three
Copyright © 2010-2026 three.js authors
```

### 2.3 开发期依赖（不进入分发产物）

这些只在你本地开发、测试、构建时使用，**不会出现在 `dist/` 里**，再分发产物时无需处理：

| 依赖 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| `typescript` | 5.9.3 | Apache-2.0 | 类型检查 |
| `vite` | 8.3.5 | MIT | 开发服务器与构建 |
| `@vitejs/plugin-react` | 6.1.2 | MIT | React 的 Vite 插件（Babel 转换） |
| `vitest` | 5.0.5 | MIT | 单元测试 |
| `puppeteer-core` | 24.43.1 | Apache-2.0 | E2E / 截图回归（使用**本机已安装的 Chrome**，不下载 Chromium） |
| `@types/node` | 24.19.2 | MIT | Node 类型定义 |
| `@types/react` | 19.3.0 | MIT | React 类型定义 |
| `@types/react-dom` | 19.3.0 | MIT | ReactDOM 类型定义 |
| `@types/three` | 0.186.0 | MIT | three 类型定义 |

> `puppeteer-core` 与 `puppeteer` 的区别：前者**不下载**打包的 Chromium，
> 因此本仓库不包含任何浏览器二进制文件，也没有额外的第三方运行时授权义务。

### 2.4 依赖白名单与新增流程

本站的依赖是**白名单制**，完整规则见 [`docs/CONTRACT.md`](./docs/CONTRACT.md) §7。
新增任何依赖都必须同时满足：

1. 许可证必须在 Apache-2.0 兼容范围内（MIT / BSD / ISC / Apache-2.0）；
   **不接受 GPL / AGPL / SSPL**——它们会限制本项目的机构集成与闭源再分发场景；
2. 在 PR 说明中给出**体积预算**（对主包 gzip 的影响）；
3. 更新本文件第二节的表格；
4. 若是仅开发期使用，必须注明「不进入分发产物」。

---

## 三、沙具资产台账

### 3.1 事实

沙具库定义在 [`src/sandbox/symbols.ts`](./src/sandbox/symbols.ts)，共 **327 个条目**，
分 6 大类、24 子类。每个条目的 `glyph` 字段是一个 **Unicode emoji 字符**（或单个字符），
由操作系统的 emoji 字体渲染。

| 项 | 值 |
| --- | --- |
| 沙具数量 | 327 |
| 大类 | 6（自然 / 生灵 / 人物 / 建筑 / 物件 / 抽象） |
| 子类 | 24 |
| 素材形式 | Unicode 字符（emoji），写入 TS 源码的字符串字面量 |
| 图片文件 | **0 个** |
| 字体文件 | **0 个**（不打包任何 emoji 字体） |
| 音频文件 | **0 个** |
| 第三方授权义务 | **无额外义务** |

`symbols.ts` 中每个条目统一带 `license: 'emoji (Unicode)'`、`packId: 'core'` 标记，
作为机器可读的授权标识（若将来引入沙具包，`packId` 与 `license` 就是分发边界）。

### 3.2 为什么 emoji 不需要单独的资产授权

- emoji **不是图片素材**，而是 Unicode 标准中定义的**码位**（例如 `U+1F30B` VOLCANO）。
  Unicode 字符本身属于公有领域，任何人都可以自由使用、复制、显示。
- 看到的具体"图案"由**操作系统或用户安装的 emoji 字体**绘制
  （Apple Color Emoji、Noto Color Emoji、Segoe UI Emoji、Twemoji 等）。
  字体是**用户设备上的软件**，本站不打包、不分发、不嵌入任何字体文件，
  因此不触发这些字体各自的授权条款（多数 emoji 字体允许自由使用渲染结果，
  即便个别有限制，其约束对象也是字体软件本身，而非本站）。
- 少数 emoji 的**设计风格**（例如各家厂商的图形样貌）可能涉及商标，
  但本站只引用码位、**不复制任何厂商的图形资产**，也不宣称与这些厂商有关联。

### 3.3 关于 Unicode 许可证

Unicode 字符数据（`UnicodeData.txt`、emoji 序列定义等）由 Unicode Consortium 发布，
适用 [Unicode License v3](https://www.unicode.org/license.txt)（MIT 风格，宽松，允许自由使用与再分发）。

**本站不需要附带该许可证的副本**，原因：本站没有分发任何 Unicode 数据文件，
只是在自己的源代码里使用了几个字符——任何软件写一个 `"A"` 都不需要附 ASCII 表。
本节的说明仅用于回答"这些字符从哪来、有没有授权问题"。

### 3.4 明确声明

> 本项目**不包含任何需要署名或付费的图片素材**。
> 没有 CC0 以外的图片，没有 CC-BY 素材，没有商业图库素材，没有 AI 生成图，没有字体文件。
>
> 新增沙具若引入任何非 emoji 资产，**必须**同时更新本节台账（来源、作者、许可证、取得日期）
> 并在 PR 中附授权凭据。详见 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 「新增沙具的流程」。

---

## 四、文档与数据的许可

| 内容 | 许可 | 说明 |
| --- | --- | --- |
| 源代码（`src/**`、`scripts/**`） | Apache-2.0 | 见 [`LICENSE`](./LICENSE) |
| 文档（`README.md`、`docs/**`、各社区文档） | CC BY 4.0 | 允许转载与改编，需署名「心屿 / Xinyu」并附原文链接 |
| 用户导出的会话数据（`.sandplay.json`） | 归用户所有 | 本站不主张任何权利；格式规范见 [`docs/FORMAT.md`](./docs/FORMAT.md) |
| 沙具字符（emoji 码位） | Unicode（公有领域） | 见 §3.2 |

> 说明：Apache-2.0 与 CC BY 4.0 的组合是「代码严、文档松」的常见做法——
> 代码需要专利授权条款保护使用者，文档需要便于传播。

---

## 五、维护规则

1. **本文件与 `package.json` 同步更新**：任何依赖版本变动都要改第二节的表格。
2. **每次发版检查一次**：`npm ls --depth=0` 的输出与本文件表格必须一致。
3. **不确定就标注**：如果某个资产的授权状况说不清，**不要合入**——写进 PR 的待确认项，
   由维护者联系作者确认。宁可少一个沙具，不要留一个说不清的授权。

---

最后更新：v2.0.0（2026-10）
