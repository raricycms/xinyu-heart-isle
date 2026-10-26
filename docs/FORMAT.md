# 心屿 · 沙盘会话文件格式规范

> 版本：`sandplay-session/v1`（格式版本 `1`）｜最后更新：2026-10
> 配套文件：[`docs/CONTRACT.md`](./CONTRACT.md)、[`docs/VISION.md`](./VISION.md)
> 参考实现：`src/format/sandplay.ts`｜JSON Schema：[`public/schema/sandplay-session-v1.schema.json`](../public/schema/sandplay-session-v1.schema.json)｜校验器：[`scripts/validate-session.ts`](../scripts/validate-session.ts)

---

## 0. 这份文档给谁看

给**想给心屿写外部工具的人**：查看器、导入器、批量统计、迁移脚本、另一个沙盘程序、你自己的分析笔记本。

读完之后，你应该能做到：

1. 从零写一个**只靠这份文档**就能跑通的 `.sandplay.json` 解析器；
2. 知道哪些字段是必须的、哪些可以安全忽略、哪些一旦出现说明文件不对；
3. 正确解出沙面高度场与湿度场（第 6 节，含可直接照抄的伪代码）；
4. 判断一个文件是否越过了隐私红线（第 8 节）；
5. 用官方校验器验证你的输出（第 9 节）。

**你不需要读心屿的源码。** 文档里出现的每个约束都同时在 `src/format/sandplay.ts` 的 `validateSandplayFile()` 里实现，两边是同一套规则；不一致时以校验器为准，并请把它当成心屿的 bug 报给我们。

> **本文档不解释任何临床含义。** 心屿不对沙盘做诊断、不做 AI 解读。格式里的每个字段都只描述「发生了什么」，不描述「这意味着什么」。写工具时请守住这条线。

---

## 1. 一句话概括

`.sandplay.json` 是一个 **UTF-8 编码、无 BOM 的 JSON 对象**，有三个特点：

- **自包含快照**：`session.items` 是最终画面，单独存在就能渲染出来，不需要事件流；
- **带过程**：`session.events` 是可选的完整操作序列，重放它必须得到和 `session.items` 一致的结果；
- **纯本地**：文件由用户自己导出、自己保管。心屿没有服务器，也不会知道你导出了什么。

文件后缀固定为 `.sandplay.json`（两个点）。媒体类型用 `application/json`；如果你要注册一个更具体的，我们建议 `application/vnd.xinyu.sandplay+json`（非强制，本项目不依赖它）。

---

## 2. 顶层结构

```json
{
  "format": "sandplay-session/v1",
  "version": 1,
  "exportedAt": "2026-10-26T14:32:10.000Z",
  "producer": { "app": "心屿 Xinyu", "version": "2.0.0" },
  "session": { "…": "见第 3 节" }
}
```

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `format` | string | ✅ | 固定字面量 `"sandplay-session/v1"`。**判别格式的唯一依据**，先看它再看别的。 |
| `version` | number | ✅ | 固定为 `1`。结构不兼容变更时才会变。 |
| `exportedAt` | string | ✅ | 导出时刻，ISO 8601 带时区（如 `2026-10-26T14:32:10.000Z`）。 |
| `producer` | object | ✅ | 生成这个文件的程序。见 2.1。 |
| `session` | object | ✅ | 会话正文。见第 3 节。 |

解析器的最小判断：

```
如果 input.format !== "sandplay-session/v1" → 不是本格式，停止（不要猜）
如果 input.version !== 1                  → 是未来/未知版本，按 §7 降级处理
```

> `format` 里已经带了 `v1`，`version` 又写了一次 `1`，看起来冗余——这是刻意的。`format` 给人看和给路由用，`version` 给程序做数值比较用。两个都必须检查。

### 2.1 `producer`

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `app` | string（非空） | ✅ | 程序名，例如 `"心屿 Xinyu"`。 |
| `version` | string（非空） | ✅ | 程序版本，例如 `"2.0.0"`。**是字符串，不是数字**——`"2.0.0"` 不能写成 `2`。 |
| `homepage` | string | — | 程序主页，可选。 |

写外部工具时请填上自己的 `app`，别冒用心屿的名字。这不会影响校验通过，但会决定用户排查问题时能不能找到你。

> **一个历史包袱**：早期设计稿（`docs/VISION.md`、`docs/PLAN.md` 与任务单）把这个字段叫 `generator`。**已实现的格式用的是 `producer`**，校验器也只认 `producer`。
> 如果你照着旧文档写了个输出 `generator` 的工具，请改成 `producer`；如果你在读别人写的文件，遇到只有 `generator` 没有 `producer` 的，那是按旧稿实现的产物，**不是本规范的一部分**，校验会失败。
> 同理，会话开始时间字段是 `createdAt`（不是旧稿里的 `at`），且 `session` 里**没有** `schemaVersion` 字段——`schemaVersion: 2` 是心屿内部 `SandSession` 的标记，不写进文件。

---

## 3. 会话正文 `session`

固定字段（8 个必须）：

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `id` | string（非空） | ✅ | 会话 id，本地生成。**不是身份标识**，别往里塞人名。 |
| `createdAt` | string | ✅ | 会话开始时间，ISO 8601。 |
| `title` | string | ✅ | 标题。**允许空字符串**。 |
| `mode` | enum | ✅ | 见 3.1。 |
| `sceneId` | string（非空） | ✅ | 场景主题 id。见 3.2。 |
| `locked` | boolean | ✅ | 是否已封盘。 |
| `items` | array | ✅ | 摆件最终状态。可为空数组。见第 4 节。 |
| `events` | array | ✅ | 过程事件流。**可为空数组**，但字段本身不能缺。见第 5 节。 |

可选字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `endedAt` | string | 会话结束时间。 |
| `lockedAt` | string | 封盘时刻。`locked: true` 时通常存在。 |
| `archived` | boolean | 是否归档。 |
| `surface` | object | 沙面高度场。缺省表示「本次没改沙子」。见第 6 节。 |
| `reflection` | string | 用户自述原文。**原样保存，不要改写、不要摘要**。 |
| `prompts` | string[] | 引导问题。 |
| `meta` | object | 元信息（不含身份）。见 3.3。 |
| `annotations` | array | 时间轴标注。见 3.4。 |
| `thumbnail` | string | 缩略图 dataURL。可能很大，渲染时按需读。 |
| `stats` | object | 客观统计摘要，导出时计算。**仅供阅读，不参与任何校验**；不要把它当成权威数据源，它不是。 |

### 3.1 `mode`（会话模式）

| 值 | 含义 |
| --- | --- |
| `"self"` | 自助：用户一个人摆 |
| `"counselor"` | 咨询师协作：咨询师在场 |
| `"supervision"` | 督导：用于案例讨论 |

其他值一律视为不合法。心屿不区分「治疗」和「咨询」——这是刻意的用词选择，写工具时也请不要替我们分类。

### 3.2 `sceneId`（场景主题）

内置 5 个：

| id | 名称 |
| --- | --- |
| `"beach"` | 沙滩 |
| `"meadow"` | 草地 |
| `"night"` | 夜晚 |
| `"room"` | 房间 |
| `"void"` | 虚空 |

**未知 `sceneId` 不算错误。** 校验器只要求它是非空字符串。外部工具应当：认识的正常渲染，不认识的回退到中性背景 + 在界面上说明「未知场景」。不要因为不认识就拒绝整个文件。

### 3.3 `meta`（元信息）

这些字段是「临床记录里的非诊断子集」——只记客观事实，不含任何评估结论。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `alias` | string | 化名/代号。**这是唯一允许出现「名字」的地方。** |
| `clientRef` | string | 本地档案 id（不是真实身份）。 |
| `therapistRef` | string | 咨询师代号。 |
| `sessionNo` | number | 第几次会谈。 |
| `phase` | enum | `intro` / `create` / `reflect` / `connect` / `record` / `dismantle`。见下。 |
| `startedAt` | string | 会谈开始时间。 |
| `endedAt` | string | 会谈结束时间。 |
| `trayW` / `trayD` / `trayH` | number | 沙盘内径 宽/深/高，单位 cm。客观尺寸，不做分析。 |
| `consentPhoto` | boolean | 是否已取得拍摄/展示同意。 |
| `consentProcess` | boolean | 是否同意把过程数据（事件流）包含在导出里。 |

`phase` 的六个值来自沙盘治疗手册的六阶段模型。心屿只做「可适配」，不把流程写死——用户可以永远不填 `phase`。

> **隐私红线**：`meta` 里出现 `realName`、`name`、`phone`、`idCard`、`email`、`address`、`wechat` 中任意一个键名，校验**直接失败**（不是警告）。理由见第 8 节。

### 3.4 `annotations`（时间轴标注）

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `id` | string（非空） | ✅ | 标注 id。 |
| `eventIndex` | number | ✅ | 指向 `session.events` 的 0-based 下标。**`-1` 表示「会话结尾」**。 |
| `t` | number | ✅ | 相对会话开始的毫秒数。 |
| `text` | string | ✅ | 标注正文。 |
| `author` | enum | — | `"self"` 或 `"counselor"`。 |
| `at` | string | ✅ | 标注写入时刻，ISO 8601。 |

注意 `eventIndex` 可能越界（例如事件流被裁剪过）。渲染时请做边界检查，不要直接 `events[eventIndex]` 取值后解引用。

---

## 4. 摆件 `session.items[]`

```json
{
  "id": "item_0001",
  "symbolId": "tree",
  "x": 0.42,
  "y": 0.58,
  "scale": 1.2,
  "rotation": 0,
  "z": 1,
  "note": "它比我想的更老一些。",
  "affectLabels": ["孤独", "温暖"],
  "burial": 0
}
```

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `id` | string（非空） | ✅ | 会话内唯一。重复即报错。 |
| `symbolId` | string（非空） | ✅ | 沙具 id，例如 `"tree"`、`"mountain"`、`"person-child"`。 |
| `x` | number | ✅ | 归一化横坐标，`0` = 左边缘，`1` = 右边缘。**必须落在 `[0,1]`**，越界即错误。 |
| `y` | number | ✅ | 归一化纵坐标，`0` = 上边缘，`1` = 下边缘。同样 `[0,1]`。 |
| `scale` | number | ✅ | 缩放倍数。UI 范围 `0.2 ~ 4`，但校验器允许 `0.1 ~ 4`（v1 迁移来的历史数据可能更低）。 |
| `rotation` | number | ✅ | 旋转角度（度），顺时针为正。**不做范围校验**（见下）。 |
| `z` | number | ✅ | 层序，**越大越靠上**（绘制顺序，不是 3D 坐标）。 |
| `note` | string | — | 用户给这个摆件写的注释。 |
| `affectLabels` | string[] | — | 用户自选的感受词。 |
| `burial` | number | — | 埋入深度 `0~1`：`0` = 完全露出，`1` = 完全埋没。 |
| `audioNote` | string | — | 本地录音 dataURL。**仅在导出选项 `includeAttachments: true` 时出现。** |
| `imageData` | string | — | 用户导入的自定义图 dataURL。同上。 |

### 4.1 坐标系（必须照做，否则位置全错）

```
(0,0) ──────────────► x = 1
  │  左上角是原点
  │  y 轴向下
  ▼
y = 1                 (1,1)
```

- 原点在**左上角**，`y` 轴**向下**——和 CSS / Canvas 一致，和数学坐标系相反。
- 坐标是**归一化的**，与实际像素尺寸、屏幕大小、设备像素比都无关。渲染时乘以你的画布尺寸即可。
- 沙盘是 2.5D 的「俯视 + 轻微透视」视角，不是真正的 3D 场景。`z` 只决定**谁盖住谁**，不代表高度。摆件的视觉高度感由 `burial` 与沙面高度共同决定，这属于渲染细节，格式本身不规定。

### 4.2 `scale` 与 `rotation` 的实际范围

- `scale`：心屿自己的 UI 限制在 `0.2 ~ 4`，历史数据（v1 迁移来的）可能低到 `0.1`。校验器接受 `0.1 ~ 4`，越界只报**警告**——因为「一个摆件特别大」不构成文件损坏。
- `rotation`：UI 限制在 `-180 ~ 180`，但校验器**完全不检查**这个字段的范围，任何有限数字都接受（只在它不是数字时报 error）。请自己用 `rotation % 360` 归一化后再渲染。

### 4.3 `symbolId` 与沙具库

心屿内置 327 个沙具，`symbolId` 是小写英文短横线串。但它**不是封闭枚举**：

- 用户可以导入自己的图，产生任意 `symbolId`；
- 未来版本会加新沙具；
- 外部工具可能定义自己的沙具。

所以校验器只要求 `symbolId` 是非空字符串。**你的解析器必须能处理未知 `symbolId`**：渲染一个占位符（一个圆点、一个问号方块都行），并在界面上标注「未知沙具」。不要整份文件拒绝，也不要静默丢弃这个摆件——丢掉一个摆件等于改动了用户的沙盘。

`symbolId` → 中文名称的映射不在本格式里（它是渲染资源，不是数据契约）。如果你需要显示名称，读心屿的 `src/sandbox/symbols.ts`，或者干脆显示 `symbolId` 原文。

### 4.4 `affectLabels` 到底是什么

这是用户自己从一组词里**挑的**感受标签，心屿只是把挑的结果存下来。它不是情绪识别结果，不是 AI 推断，不是量表分数。

内置词表有 13 个（供你参考，不要写死）：害怕、愤怒、难过、孤独、温暖、安全、沉重、轻盈、紧、麻、想靠近、想远离、说不清。

校验器只要求它是字符串数组。**遇到不认识的标签请原样保留并显示**——用户可能用了自定义词，改写或丢弃都是数据损失。

---

## 5. 过程事件 `session.events[]`

```json
{ "t": 4200, "type": "item.add", "itemId": "item_0001", "payload": { "item": { "…": "完整摆件对象" } } }
```

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `t` | number | ✅ | 相对会话开始的**毫秒数**（不是时间戳！）。应单调不减。 |
| `type` | string | ✅ | 19 种之一，见 5.2。未知类型即错误。 |
| `itemId` | string | — | 涉及单个摆件时给出目标 id。 |
| `payload` | object | — | 载荷。**形状随 `type` 变化**；未知额外键被允许（向前兼容）。 |

### 5.1 三条重放规则

写回放器/导入器时，这三条决定了你的实现是否正确：

1. **`t` 是相对量，不是绝对时间。** 会话开始的时刻在 `session.createdAt`，第 n 条事件发生在 `createdAt + t` 毫秒。事件流里没有绝对时间戳——这是刻意的，因为用户可能暂停、合盖、第二天再回来。
2. **重放结果必须等于 `items`。** 从空状态依次应用全部事件，得到的摆件集合应当与 `session.items` 逐个字段一致（`id`、`x`、`y`、`scale`、`rotation`、`symbolId`、`note`、`z`）。心屿内部用 `isConsistent()` 断言这件事。**如果你只用 `items` 渲染、完全忽略 `events`，你的画面也是对的**——这正是「自包含快照」的意思。
3. **`item.remove` 之后 `id` 可以复用。** 不要假设「同一 id 只能 `add` 一次」。`item.add` 对同 id 是**覆盖**语义（幂等），不是追加。

### 5.2 全部 19 种事件

「必须字段」一列里，`itemId` 指的是**外层** `itemId`，`payload.*` 指载荷里的键。

| # | `type` | 必须字段 | `payload` 结构 | 语义 |
| --- | --- | --- | --- | --- |
| 1 | `item.add` | `payload.item` | `{ item: <完整摆件对象> }` | 放入一个摆件。同 id 覆盖（幂等）。 |
| 2 | `item.move` | `itemId`, `payload.x`, `payload.y` | `{ x, y }` 均为 `[0,1]` | 移动。 |
| 3 | `item.scale` | `itemId`, `payload.scale` | `{ scale }` | 缩放。 |
| 4 | `item.rotate` | `itemId`, `payload.rotation` | `{ rotation }` 度 | 旋转。 |
| 5 | `item.remove` | `itemId` | `{}`（可省略） | 移除。 |
| 6 | `item.note` | `itemId` | `{ note?: string }` | 写/清空注释。`note` 缺省 = 清空。 |
| 7 | `item.affect` | `itemId`, `payload.affectLabels` | `{ affectLabels: string[] }` | 标记感受词。空数组 = 清空。 |
| 8 | `item.layer` | `itemId`, `payload.z` | `{ z }` | 改层序。 |
| 9 | `item.bury` | `itemId`, `payload.burial` | `{ burial }` `[0,1]` | 改埋入深度。 |
| 10 | `scene.change` | `payload.sceneId` | `{ sceneId }` | 换场景主题。 |
| 11 | `surface.stroke` | `payload.after` | `{ tool?, before?, after }`，`after` 是完整 `surface` 对象 | 一次沙面笔刷。**快照式**，见 5.3。 |
| 12 | `surface.reset` | — | `{}`（可省略） | 清空沙面（`surface` 变回缺省）。 |
| 13 | `session.start` | — | `{ sceneId?, mode? }` | 会话开始。通常是第 0 条，`t: 0`。 |
| 14 | `session.phase` | `payload.phase` | `{ phase }` | 进入某个临床阶段。 |
| 15 | `session.lock` | — | `{}`（可省略） | 封盘。之后会话只读。 |
| 16 | `session.save` | — | `{ title?: string }` | 保存动作（含改标题）。**不改变摆件状态。** |
| 17 | `session.import` | — | `{ from?: string }` | 从别的格式导入。`from` 例如 `"sandbox-snapshot/v1"`、`"compacted"`。 |
| 18 | `annotation.add` | `payload.id`, `payload.eventIndex`, `payload.text` | `{ id, eventIndex, text }` | 加一条时间轴标注。 |
| 19 | `reflection.edit` | `payload.text` | `{ text: string }` | 改写自述。 |

补充说明：

- **`session.save` / `session.import` 是「标记」而非「操作」**：重放时它们不改变任何摆件状态。它们存在是为了让回放时能显示「在第 17 秒保存过一次」。
- **`t: 0` 的 `session.start` 不是必须的**，但心屿总会写一条。你的解析器不该依赖它存在。
- 事件总数上限 `4000` 条。超限时心屿会**裁剪**较早的事件，并把被裁掉部分折叠成一条 `session.import`（`from: "compacted"`）。所以理论上可能出现「`items` 里有摆件、但事件流里找不到它的 `item.add`」——这是正常现象，按 `items` 渲染即可。

### 5.3 `surface.stroke` 为什么存快照

一次笔画同时存 `before` 和 `after` 两个**完整的**沙面对象（各是一整段 RLE+Base64 字符串）。听起来浪费，但这是刻意的：

- 回放时**不需要重算物理**（松弛、休止角），直接替换即可，保证回放与当时所见**完全一致**；
- 代价是文件变大（一次笔画约 5–8 KB 的 Base64），换来的是跨平台、跨版本、跨实现的结果确定性。

`before` 是可选的——只有需要「逐笔倒放」的工具才用得上。如果你只做顺序回放，读 `after` 就够。

> 为什么这很重要：沙面的物理松弛涉及浮点累加顺序。若存「笔刷参数」让各家自己算，不同 JS 引擎、不同迭代次数就会得到不同的沙丘。**快照消灭了这类不一致。**

---

## 6. 沙面高度场编码（`surface`）

这是整个格式里唯一需要真正写编解码逻辑的地方。

```json
"surface": {
  "cols": 128,
  "rows": 96,
  "height": "UzEBgABgAAEAAABagGA=",
  "wetness": "VzEBAPAuyJAx",
  "state": "dry",
  "waterAdded": 0
}
```

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `cols` | number | ✅ | 列数。默认 `128`。 |
| `rows` | number | ✅ | 行数。默认 `96`。 |
| `height` | string | ✅ | 高度场，RLE + Base64。见 6.2。 |
| `wetness` | string | — | 湿度场，独立编码。见 6.3。 |
| `state` | enum | — | `"dry"` 或 `"wet"`。全局湿度档，供工具层快速判断。 |
| `waterAdded` | number | — | 已喷水次数。客观计数，不解读。 |

### 6.1 数据模型

- 沙面是一张 `cols × rows` 的**单通道**高度图，**行优先**（第 0 行从左到右，然后第 1 行……），索引 `i = row * cols + col`。
- 每个格子是一个字节 `0..255`，线性映射到 `0..7 cm`：`cm = height / 255 * 7`。
- 基准面 `SURFACE_BASE_LEVEL = 90`（约 `2.47 cm`）表示「未被触碰的平整沙面」。高于 90 = 堆起来，低于 90 = 挖下去。
- 格子的**物理尺寸不做规定**——它是渲染概念。心屿的默认沙盘是 57×72 cm，但格式不绑死这个数字。

### 6.2 `height`：`S1` 容器 + RLE + Base64

编码分三层，**自内向外**：

```
① 原始像素   Uint8[cols*rows]，行优先
② RLE 运行    (value: u8, length: varint)  交替重复
③ 二进制容器  'S' '1' ver colsLE16 rowsLE16 runCountLE32  ++  RLE 字节
④ Base64     Base64(③)  → 存进 JSON 字符串
```

**容器头部（11 字节，小端）：**

| 偏移 | 长度 | 内容 |
| --- | --- | --- |
| 0 | 2 | ASCII `"S1"`（`0x53 0x31`）。魔数，用来快速判错。 |
| 2 | 1 | 版本号，当前 `1`。 |
| 3 | 2 | `cols`，uint16 小端。 |
| 5 | 2 | `rows`，uint16 小端。 |
| 7 | 4 | `runCount`，uint32 小端。 |
| 11 | … | `runCount` 组 `(value u8, length varint)`。 |

**varint 就是 LEB128**：每字节低 7 位是数据，最高位是「还有后续」标志。例如 `12288` → `0x80 0x60`（`12288 = 0 + 96<<7`，第一个字节 `0x80` 表示继续，第二个 `0x60 = 96`）。

**解码伪代码**（可直接照抄）：

```
function decodeHeight(b64):
    bytes = base64Decode(b64)
    if bytes.length < 11:              return null   # 太短
    if bytes[0] != 0x53:               return null   # 不是 'S'
    if bytes[1] != 0x31:               return null   # 不是 '1'
    ver      = bytes[2]                             # 目前只可能是 1
    cols     = bytes[3] | (bytes[4] << 8)
    rows     = bytes[5] | (bytes[6] << 8)
    runCount = bytes[7] | (bytes[8] << 8) | (bytes[9] << 16) | (bytes[10] << 24)
    if cols <= 0 or rows <= 0 or cols > 512 or rows > 512: return null
    if runCount <= 0 or runCount > cols * rows:            return null

    data    = new Uint8[cols * rows]
    offset  = 11
    written = 0
    for i in 0 .. runCount-1:
        if offset >= bytes.length: return null      # 截断
        value  = bytes[offset]; offset += 1
        length = 0; shift = 0
        while offset < bytes.length:                # 读 varint
            b = bytes[offset]; offset += 1
            length |= (b & 0x7F) << shift
            shift  += 7
            if (b & 0x80) == 0: break
        if length <= 0: return null
        end = min(len(data), written + length)
        data[written .. end-1] = value              # 填充
        written = end
        if written >= len(data): break

    if written != len(data): return null            # 长度对不上
    return { cols, rows, data }
```

**编码伪代码**（写导出器时用）：

```
function encodeHeight(cols, rows, data):
    runs = []
    i = 0
    while i < len(data):
        value  = data[i]
        length = 1
        while i+length < len(data) and data[i+length] == value and length < 0xFFFFFF:
            length += 1
        runs.push(value)
        runs.push(...varintBytes(length))
        i += length

    header = [0x53, 0x31, 1,
              cols & 0xFF, (cols >> 8) & 0xFF,
              rows & 0xFF, (rows >> 8) & 0xFF,
              runCount & 0xFF, (runCount>>8) & 0xFF, (runCount>>16) & 0xFF, (runCount>>24) & 0xFF]
    return base64Encode(header ++ runs)
```

> **注意 `runCount` 要单独数。** 上面的 `runs` 数组里 `value` 和 varint 的每个字节混在一起，不能直接当 run 数用——必须按 varint 的边界重新走一遍（见参考实现的 `encodeRle()`）。这是最容易写错的地方：把 `runs.length` 当成 `runCount` 会得到一个偏大的数，解码端读到越界就会失败。

**一个可以直接手工验算的最小例子。** `UzEBgABgAAEAAABagGA=` 解出来是：

```
53 31 01 80 00 60 00 01 00 00 00 5A 80 60
│  │  │  └─┬─┘ └─┬─┘ └───┬───┘ │  └──┬──┘
S  1  v  cols   rows   runCount=1   value   varint(12288)
        128    96                  90(基准面)
```

即「128×96 全部是 90」——一块没被碰过的平整沙面。文件只有 14 字节，这正是 RLE 的意义。

（`12288 = 128 × 96`；varint 里 `0x80` 表示「还有后续」，`0x60 = 96`，所以 `0 | 96 << 7 = 12288`。）

### 6.3 `wetness`：`W1` 容器

湿度场是**独立编码**的，头部更短（3 字节）且**不存尺寸**——尺寸从 `cols × rows` 推出来。

| 偏移 | 长度 | 内容 |
| --- | --- | --- |
| 0 | 2 | ASCII `"W1"`（`0x57 0x31`）。 |
| 2 | 1 | 版本号，当前 `1`。 |
| 3 | … | `(value u8, length varint)` 组，**直到写完 `cols*rows` 个格**。 |

```
function decodeWetness(b64, expectedCount):
    bytes = base64Decode(b64)
    if bytes.length < 3:                 return null
    if bytes[0] != 0x57 or bytes[1] != 0x31: return null
    out = new Uint8[expectedCount]
    offset = 3; written = 0
    while offset < bytes.length and written < expectedCount:
        value = bytes[offset]; offset += 1
        length = readVarint(bytes, offset)
        if length <= 0: return null
        end = min(expectedCount, written + length)
        out[written .. end-1] = value
        written = end
    return written == expectedCount ? out : null      # 必须刚好填满
```

语义：`0` = 干，`>96` = 湿（这是心屿渲染用的阈值，不是格式规定；你把 1 当湿也行，只要自己一致）。`wetness` 只在 `waterAdded > 0` 时才写——干燥的会话没有这个字段。

**只有 `height` 是必须的。** 如果你的工具不关心沙子，`surface` 整个字段都可以忽略。

---

## 7. 版本与兼容

### 7.1 我们的承诺

- `format` 字符串在**结构不兼容**时才会变（`sandplay-session/v2`）。
- 在 `v1` 内，我们只**新增可选字段**，不改已有字段的语义、类型、必填性。
- 新增事件类型会同时升级 `version`（因为校验器对未知 `type` 报错）。这意味着：**看到不认识的 `type` 就说明文件来自更新版本**，请走 7.2 的降级路径，不要硬渲染。
- 已有事件类型的 `payload` 可以增加新键——`payload` 内部是开放的，你的解析器应当忽略不认识的键。

### 7.2 遇到未知东西时怎么办

| 情况 | 建议处理 |
| --- | --- |
| `version` > 1 | 提示「文件来自更新版本的心屿」，尝试只读渲染 `items`，禁用以事件流为依赖的功能（逐笔回放、撤销）。 |
| 未知 `event.type` | **跳过这条事件**，在界面上计数提示「N 条事件看不懂，已跳过」。不要中止整个文件。 |
| 未知 `sceneId` | 用中性背景渲染，界面标注未知场景。 |
| 未知 `symbolId` | 渲染占位符，界面标注未知沙具。**不要丢弃摆件。** |
| 未知 `payload.*` 键 | 静默忽略。 |
| 未知顶层/`session` 字段 | 静默忽略（`session` 与顶层是开放的）。 |
| `items[]` 里有未知字段 | 报不兼容。`items[]` 的字段是**封闭**的（见第 9 节），因为摆件会被画出来，多余字段可能意味着别人改了语义。 |

### 7.3 迁移历史

`v1` 之前心屿用过 `sandbox-snapshot/v1`（快照格式，没有事件流）。迁移逻辑在 `src/format/migrate.ts`：

- 生成一条 `t: 0` 的 `session.start`；
- 每个摆件生成一条 `item.add`，`t` 依次为 `1000, 2000, 3000…`；
- 追加一条 `session.import`，`from: "sandbox-snapshot/v1"`；
- 有自述则补一条 `reflection.edit`；
- 坐标 clamp 到 `[0,1]`，`scale` clamp 到 `0.2~4`，`burial` clamp 到 `[0,1]`，`z` 缺失时按序号补。

导出文件里不会出现 `sandbox-snapshot/v1`，你不需要实现这个迁移。

---

## 8. 隐私边界

心屿是纯前端应用：没有后端、没有账号、没有网络请求。导出的文件**只存在于用户的设备上**。

### 8.1 格式层面的硬约束

`meta` 里出现以下任一键名 → **校验失败**（error，不是 warning）：

```
realName   name   phone   idCard   email   address   wechat
```

这条规则的意图很明确：这些字段一旦被写进文件，就再也没法保证它只在用户手里了。文件可能被邮件发出去、上传到云盘、放进案例讨论的 PPT 里。**不允许出现，比「加密」更可靠。**

允许的替代：`meta.alias`（化名）、`meta.clientRef`（本地档案 id）。这两个都是用户自己起的代号。

### 8.2 写外部工具时的责任

- **不要上传。** 如果你的工具需要联网，默认必须是关闭的，且要在界面上明确告诉用户「这次操作会把会话内容发送到 X」。心屿的用户预期是「这东西不上网」。
- **不要写遥测。** 连「会话时长」这种看起来无害的统计也不要发——时长本身是临床信息。
- **不要做 AI 解读。** 不要调 LLM 去「分析这个沙盘」。这不只是合规问题：心屿的全部设计立场是「解释权在用户手里」。你替用户解释，就违背了这个立场。
- **`reflection`、`note`、`annotations[].text` 是用户的原文。** 原样显示，不要自动摘要、不要翻译、不要「润色」。
- **`thumbnail`、`audioNote`、`imageData` 是 dataURL**，可能包含真实人脸或声音。任何展示/导出的二次分发都要重新取得同意（`meta.consentPhoto`）。

### 8.3 关于「这不是医疗设备」

格式里没有任何诊断字段，也不打算有。心屿不是医疗设备，不提供诊断、治疗建议或危机干预。写工具时请同样避免暗示这一点——不要给沙盘打「抑郁倾向」之类的标签，哪怕你自己觉得算法很准。

危机情况请指向 `/safety` 页面列出的心理援助热线。

---

## 9. 校验器

### 9.1 用法

```bash
# 单个文件
node --experimental-strip-types scripts/validate-session.ts samples/example.sandplay.json

# 多个文件 / 通配符（PowerShell、cmd、bash 都能用）
node --experimental-strip-types scripts/validate-session.ts samples/*.sandplay.json

# 严格模式（警告也算失败，推荐 CI 用）
node --experimental-strip-types scripts/validate-session.ts --strict samples/*.sandplay.json

# 机器可读输出
node --experimental-strip-types scripts/validate-session.ts --json samples/example.sandplay.json
```

需要 **Node 22+**（`--experimental-strip-types` 直接跑 TypeScript，无需构建、无需 `npm install`）。`ExperimentalWarning` 打到 stderr，属正常现象。

### 9.2 参数

| 参数 | 说明 |
| --- | --- |
| `<文件...>` | 一个或多个路径。支持 `*` 与 `?`（本工具自己展开，不依赖 shell）。 |
| `--strict` | 把 warning 当 error。 |
| `--json` | 输出 JSON 报告。 |
| `--quiet` / `-q` | 精简输出。 |
| `--help` / `-h` | 帮助。 |

### 9.3 退出码

| 码 | 含义 |
| --- | --- |
| `0` | 全部通过 |
| `1` | 有文件校验未通过（含参数错误） |
| `2` | 有文件无法读取（不存在 / 无权限 / 是目录） |

多个文件时取**最严重**的退出码：读取失败 `2` > 校验失败 `1` > 通过 `0`。

### 9.4 通过时的输出

```
✓ samples/example.sandplay.json
  标题：示例沙盘 · 一棵树和一片海　模式：自助(self)　场景：beach　已封盘
  摆件 1　事件 3　时长 0:16
  沙面 128×96 干沙　喷水 0 次
  自述 20 字　标注 0 条
  导出：心屿 Xinyu 2.0.0　2026-10-26T14:32:10.000Z
```

### 9.5 失败时的输出

问题按 JSON 路径定位，`severity` 为 `error` 或 `warning`：

```
✗ samples/broken.sandplay.json
  5 个错误 / 1 个警告
  error   session.items[0].x
          归一化坐标必须在 0~1 之间。
  error   session.items[1].id
          id "item_0001" 重复。
  error   session.events[1].type
          未知事件类型 "item.fly"。
  warning session.events[2].t
          事件时间戳应单调递增，这里比上一条小。
  error   session.meta.realName
          不允许可识别身份字段（隐私红线）。请使用化名 alias / clientRef。
```

### 9.6 校验器实际查什么

| 检查项 | error / warning |
| --- | --- |
| 顶层不是 JSON 对象 | error `$` |
| `format` ≠ `"sandplay-session/v1"` | error |
| `version` ≠ `1` | error |
| `exportedAt` 不是可解析的时间字符串 | error |
| `producer` 缺失 / `app`、`version` 非非空字符串 | error |
| `session` 不是对象 | error（后续检查中止） |
| `session.id` 空 / `createdAt` 非法 / `title` 非字符串 | error |
| `mode` 不在三值内 | error |
| `sceneId` 空字符串 | error |
| `locked` 非布尔 | error |
| `items` 不是数组 | error |
| 摆件 `id` 空 / 重复 | error |
| 摆件 `symbolId` 空 | error |
| 摆件 `x`/`y` 非数字 或 越出 `[0,1]` | error |
| 摆件 `scale` 越出 `0.1~4` | **warning** |
| 摆件 `z` 非数字 | **warning** |
| 摆件 `rotation` 非数字 | error |
| 摆件 `note` 非字符串 / `affectLabels` 非字符串数组 / `burial` 越界 | error |
| `events` 非数组 | error |
| 事件 `t` 非数字 | error |
| 事件 `t` 比上一条小 | **warning** |
| 事件 `type` 不在 19 种内 | error |
| 事件 `itemId` 非字符串 / `payload` 非对象 | error |
| `surface.cols`/`rows` 非正数 / `height` 空 | error |
| `surface.state` 不是 `dry`/`wet` | error |
| `meta.phase` 非法 / `consent*` 非布尔 | error |
| `meta` 出现隐私红线键名 | error |
| `annotations[].id`/`eventIndex`/`text` 缺失或类型错 | error |
| `reflection` 非字符串 | error |

**校验器不检查的**（别指望它）：`symbolId` 是否存在、`sceneId` 是否认识、`eventIndex` 是否越界、`height` 的 Base64 能否解码、`items` 与 `events` 重放是否一致。这些都是「语义一致性」，属于你的工具该做的额外验证。

### 9.7 关于 `additionalProperties`

`public/schema/sandplay-session-v1.schema.json` 里：

- 顶层与 `session`：**开放**（允许额外字段，向前兼容）；
- `items[]` 与 `events[]`（外层）：**封闭**（`additionalProperties: false`）；
- `payload`、`meta`：**开放**。

这是刻意的不对称。注意 **JSON Schema 与 §9.6 的内置校验器并非逐条等价**：

| 只有内置校验器会查 | 只有 Schema 会查 |
| --- | --- |
| 摆件 `id` 是否重复 | `items[]` / `events[]` 外层的未知字段 |
| 事件 `t` 是否单调不减 | `surface.height` / `wetness` 是否符合 Base64 字符集 |
| `meta` 里的隐私红线键名 | 各类型事件的 `payload` 必填键（`x`/`y`/`scale`/…） |
| `annotations[]` 各字段类型 | `surface.cols`/`rows` 是否为整数 |
| 时间字符串是否可被 `Date.parse()` 解析 | （若校验器启用了 format 断言）时间是否符合 RFC 3339 |

> `format: "date-time"` 在 JSON Schema 里默认只是**注解**，多数校验器不会强制检查，除非显式开启 format 断言。别指望它替你验时间。

**写文件时按 Schema 来，读文件时按内置校验器来**——这是最不容易出事的组合。比如 `samples/broken.sandplay.json` 有 6 处问题，Schema 只抓到 2 处（坐标越界、未知事件类型），另外 4 处（id 重复、时间倒退、两个隐私字段）只有内置校验器抓得到。

---

## 10. 最小可用示例

一份能通过校验的最小文件（1 个摆件、无事件流、无沙面）：

```json
{
  "format": "sandplay-session/v1",
  "version": 1,
  "exportedAt": "2026-10-26T14:32:10.000Z",
  "producer": { "app": "我的小工具", "version": "0.1.0" },
  "session": {
    "id": "s1",
    "createdAt": "2026-10-26T14:20:00.000Z",
    "title": "最小例子",
    "mode": "self",
    "sceneId": "beach",
    "locked": false,
    "items": [
      { "id": "i1", "symbolId": "tree", "x": 0.5, "y": 0.5, "scale": 1, "rotation": 0, "z": 1 }
    ],
    "events": []
  }
}
```

只有这 8 个 `session` 字段 + 4 个顶层字段是必须的，其余全部可选。

仓库里的三个样例：

| 文件 | 内容 |
| --- | --- |
| [`samples/example.sandplay.json`](../samples/example.sandplay.json) | 最小完整例子：1 个摆件、3 条事件、平整沙面、自述。 |
| [`samples/surface-demo.sandplay.json`](../samples/surface-demo.sandplay.json) | 全字段例子：5 个摆件、10 条事件、带湿度场的湿沙、`meta`、`annotations`、`prompts`。 |
| [`samples/broken.sandplay.json`](../samples/broken.sandplay.json) | **故意写坏**，演示 6 类问题（坐标越界、id 重复、未知事件类型、时间倒退、两处隐私字段）。用来验证你的错误处理路径。 |

---

## 11. 参考实现清单

| 位置 | 作用 |
| --- | --- |
| `src/format/sandplay.ts` | 类型定义 + `validateSandplayFile()` + 导入/导出转换。**判定逻辑的唯一来源。** |
| `src/sandbox/surfaceCodec.ts` | 高度场 RLE/Base64 编解码、`heightToCm()`、物理松弛。 |
| `src/sandbox/surfaceState.ts` | 沙面运行时状态 ↔ `SandSurface` 的桥接（含 `W1` 湿度场编解码）。 |
| `src/sandbox/events.ts` | 19 种事件的 `applyEvent()` 归约、`replay()`、命令栈（撤销/重做）。 |
| `src/format/migrate.ts` | 旧快照 → `v2` 会话的迁移。 |
| `scripts/validate-session.ts` | 官方校验器 CLI（本文档第 9 节）。 |
| `public/schema/sandplay-session-v1.schema.json` | JSON Schema（Draft 2020-12）。 |

有疑问、或者发现文档和实现对不上：请**以 `validateSandplayFile()` 为准**，并在仓库里开一个 issue。文档写错是我们的责任，不是你的。

---

## 12. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10 | 首版。19 种事件、`S1`/`W1` 沙面编码、隐私红线字段、校验器 CLI。 |
