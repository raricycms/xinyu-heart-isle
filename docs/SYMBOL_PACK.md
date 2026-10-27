# 沙具包规范 `symbol-pack/v1`

> 这份文档给**想给心屿加沙具的人**看。
> 会话文件格式见 [`FORMAT.md`](FORMAT.md)；本文只管沙具包。

---

## 0. 一句话概括

一个沙具包是**一个 JSON 文件**，里面是若干沙具条目（字形或内嵌图片）。
用户把它导入心屿，就多了这些沙具。**包不上传任何地方，全部留在本机。**

```bash
# 校验你自己做的包（不需要装依赖）
npm run validate:pack -- mypack.symbolpack.json
```

---

## 1. 为什么要"包"而不是"改代码"

心屿内置 327 个沙具。内置库是**编译进代码**的，改它要重新发布。
但沙具是个人化的东西 —— 有人在沙盘里放外婆的缝纫机，有人放船，
有人放一把钥匙。这些不该等版本更新。

沙具包让你**自己加**，而且：

- 别人做的包你可以直接用（只要授权清楚）
- 你做的包别人也能用
- 卸载包不影响内置库，也不影响你的历史会话

---

## 2. 文件长什么样

```json
{
  "format": "symbol-pack/v1",
  "id": "my-pack",
  "name": "我的沙具",
  "version": "1.0.0",
  "license": "CC0-1.0",
  "author": "某人",
  "description": "几个自己画的沙具",
  "symbols": [
    {
      "id": "my-pack.sewing-machine",
      "label": "缝纫机",
      "labelEn": "Sewing Machine",
      "category": "object",
      "subcategory": "object-tool",
      "glyph": "🧵",
      "tags": ["外婆", "旧物", "针线"]
    }
  ]
}
```

完整可用示例：[`samples/example.symbolpack.json`](../samples/example.symbolpack.json)
故意做坏的示例（列了 12 类错误）：[`samples/broken.symbolpack.json`](../samples/broken.symbolpack.json)

---

## 3. 顶层字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `format` | ✅ | 固定 `"symbol-pack/v1"`。也接受 `"sandbox-symbol-pack/v1"`（同义） |
| `name` | ✅ | 包名，≤ 80 字。会显示在「已安装的包」列表里 |
| `license` | ✅ | SPDX 标识，如 `CC0-1.0` / `CC-BY-4.0` / `MIT` / `Apache-2.0`，或 `proprietary`。**不能留空、不能写 unknown/none** |
| `symbols` | ✅ | 沙具数组，1 ~ 2000 条 |
| `id` | ⬜ | 包 id。缺省时从沙具 id 的公共前缀推导 |
| `version` | ⬜ | 版本号，默认 `1.0.0`。**同 id 再导入 = 升级覆盖** |
| `author` | ⬜ | 作者，默认「未署名」 |
| `description` | ⬜ | 说明，≤ 400 字 |
| `homepage` | ⬜ | 主页链接（只作为文字记录，不会被访问） |

> **`license` 为什么必填且严格？**
> 沙具包是**别人会拿去用**的东西。一个授权不明的包，用的人不知道
> 自己有没有权利，机构不敢用。所以这里宁可拒绝，也不默认放行：
> `unknown` / `none` / `todo` / `n/a` / `-` 全被拒。
>
> 只有 `proprietary` 是例外 —— 它明确表示"我有版权，不授权他人再分发"，
> 是诚实的声明，不是含糊。

---

## 4. 沙具条目

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | **必须带命名空间**，形如 `mypack.tree`（至少一个 `.`）；不能与内置库重名；包内不能重复 |
| `label` | ✅ | 中文名，≤ 40 字 |
| `subcategory` | ✅ | 24 个子类之一，见下表 |
| `glyph` | ⚠️ | 一个 emoji 或单字符，≤ 16 个 UTF-16 单元。与 `image` **二选一** |
| `image` | ⚠️ | `data:image/...;base64,...` 内嵌图片。**禁止 http(s) 地址** |
| `category` | ⬜ | 大类。**可省略**；若填写则必须与 `subcategory` 一致 |
| `labelEn` | ⬜ | 英文名，≤ 40 字 |
| `tags` | ⬜ | 检索词数组，≤ 16 个，每个 ≤ 24 字 |

### 4.1 `id` 的命名空间规则

```jsonc
"id": "my-pack.tree"        // ✅ 合法
"id": "tree"                // ❌ 缺命名空间
"id": "my-pack.tree"        // ❌ 如果内置库里已经有 my-pack.tree（不会有，但规则是这样）
```

**为什么强制命名空间？** 两个人各做了一个「树」，都用 `tree` 就会撞。
加了前缀 `alice.tree` / `bob.tree` 就永远不撞，而且**卸载一个包
不会误删另一个包的沙具**。

内置库的 327 个 id 都没有点号，所以只要你的 id 带点号且前缀不是它们的，
就不可能重名。校验器会实际查一遍，撞了会明确告诉你。

### 4.2 24 个子类

| 大类 | 子类 |
| --- | --- |
| `nature` 自然 | `nature-land` `nature-water` `nature-sky` `nature-plant` |
| `creature` 生灵 | `animal-wild` `animal-farm` `animal-water` `animal-insect` |
| `person` 人物 | `person-adult` `person-child` `person-family` `person-role` `person-myth` |
| `building` 建筑 | `building-home` `building-public` `building-religious` `building-ruin` |
| `object` 物件 | `object-daily` `object-tool` `object-food` `object-vehicle` `object-treasure` |
| `abstract` 抽象 | `abstract-symbol` `abstract-element` |

**不能自定义子类。** 子类决定沙具在托盘里的分组，任意新增会让
筛选器变得没法用。如果你的东西实在放不进去，选最接近的那个 ——
沙具的**含义**不该由分类决定，那是来访者自己的事。

### 4.3 `glyph` 还是 `image`

| | `glyph` | `image` |
| --- | --- | --- |
| 体积 | 极小（一个字符） | 大（base64 膨胀 33%） |
| 观感 | emoji，跨平台不一致 | 你完全控制 |
| 适用 | 快速补充、原型 | 真实沙具照片、手绘图 |

`image` 必须是 **data URI**：

```
data:image/png;base64,iVBORw0KGgoAAAANS...
```

支持 `png` / `jpeg` / `webp` / `gif` / `svg+xml`。
**单条 ≤ 200KB，整个包 ≤ 1.5MB。**

> **为什么禁止 http(s) 图片？**
> 加载网络图片意味着：① 你的设备会向那个服务器发请求，暴露你在用
> 这个应用、什么时候用；② 那个图随时可能消失，你的沙盘就缺一块。
> 心屿的承诺是「数据不出本地」，所以图片必须**装在包里**。

---

## 5. 安全边界（这些是硬约束）

| 约束 | 值 | 为什么 |
| --- | --- | --- |
| 单包沙具数 | ≤ 2000 | 防止一个包把托盘撑爆 |
| 单个 `image` | ≤ 200KB | 防止单条过大 |
| 整个包序列化后 | ≤ 1.5MB | localStorage 有配额，撑爆会导致**所有本地数据写入失败** |
| 网络地址 | 一律拒绝 | 见 4.3 |
| 与内置 id 冲突 | 一律拒绝 | 否则卸载包会牵连内置库 |

超限时校验器会告诉你超了多少，并建议缩小内嵌图片。

---

## 6. 校验

```bash
npm run validate:pack -- samples/example.symbolpack.json
```

输出：

```
✓ samples/example.symbolpack.json
    示例 · 自然补遗　包 id：example-nature　版本：1.0.0
    授权：CC0-1.0　作者：心屿示例
    沙具 3 条（全部用字形）　文件 1KB
```

失败时**逐条列出问题**，每条都指出是第几个条目、哪个字段：

```
✗ samples/broken.symbolpack.json
    format 必须是 "sandbox-symbol-pack/v1"。
    第 1 条的 id「zzz-namespaceless」不合法：必须形如「mypack.tree」…
    第 4 条（broken.alien）的 subcategory「nature-alien」不是已知子类。
    …
```

### 6.1 退出码

| 码 | 含义 |
| --- | --- |
| `0` | 全部通过 |
| `1` | 有文件未通过校验（含参数错误） |
| `2` | 有文件无法读取（不存在 / 无权限 / 是目录） |

### 6.2 `--json`

给 CI 或自己的工具用：

```bash
npm run validate:pack -- mypack.symbolpack.json --json
```

```json
{
  "validator": "xinyu-validate-pack",
  "format": "sandbox-symbol-pack/v1",
  "acceptedFormats": ["sandbox-symbol-pack/v1", "symbol-pack/v1"],
  "builtinSymbolCount": 327,
  "ok": true,
  "exitCode": 0,
  "totals": { "files": 1, "passed": 1, "failed": 0 },
  "files": [ { "file": "…", "ok": true, "summary": { … } } ]
}
```

---

## 7. 导入到应用里

编辑器/界面上「沙具库 → 导入沙具包」，选文件即可。

导入后的行为：

- 同 `id` 的包**覆盖升级**（不会出现两份）
- 卸载包只删这个包带的沙具，内置库与其它包不受影响
- **已经摆进沙盘的沙具不会消失** —— 会话里存的是 `symbolId`，
  包被删后那个位置会显示占位符，重新装回同一个包就恢复
- 包存在 `localStorage['xinyu.symbolPacks']`

---

## 8. 常见问题

**Q：我能用真实沙具的照片吗？**
能，但必须：① 你有权使用（自己拍的，或 CC0 等明确授权）；
② 转成 data URI 内嵌；③ 在 `license` 里如实声明。
校验器只检查格式合法，**不检查你有没有权利** —— 那是你的责任。

**Q：一个包能放多少沙具？**
技术上 2000 条。实际上如果你要放几百个**图片**沙具，
很可能先撞上 1.5MB 总大小限制。建议一个包专注一个主题。

**Q：包会同步到别的设备吗？**
**不会。** 心屿没有后端，没有账号。换设备需要自己把文件带过去重新导入。

**Q：我可以把包发给别人吗？**
取决于你的 `license`。你写 `CC0-1.0` 就是放弃权利、谁都能用；
写 `proprietary` 就是保留权利、别人不该再分发。

**Q：内置的 327 个沙具能改吗？**
不能通过包改。包只能**新增**。改动内置库需要改 `src/sandbox/symbols.ts`
并重新发布。

---

## 9. 给工具作者：格式的两个名字

历史原因，这个格式有两个字面量，**都接受**：

| 字面量 | 出处 |
| --- | --- |
| `sandbox-symbol-pack/v1` | `src/sandbox/library/packs.ts` 的 `SYMBOL_PACK_FORMAT` |
| `symbol-pack/v1` | `src/lib/types.ts` 的 `SymbolPackManifest`、`docs/VISION.md` §5.8 |

`docs/VISION.md` 里写的是 `symbol-pack/v1`，实现里主用
`sandbox-symbol-pack/v1`。校验器两个都收，输出时归一化为
`sandbox-symbol-pack/v1`。**写新包建议用 `symbol-pack/v1`**（更短、
与 VISION 一致）。

---

## 10. 这份规范没承诺什么

- **不承诺 API 稳定**：`symbol-pack/v1` 的字段会向后兼容地增加，
  但**不保证**未来版本能读所有 v1 包（可能新增必填字段）。
  真要改，会升到 `v2` 并保留 v1 读取。
- **校验器不检查内容质量**：它只保证"结构合法、不会撑爆存储、
  不会联网"。一个合法但画得很差的包，它照样放行。
- **不检查授权真实性**：见 Q1。

---

## 相关文档

- [`FORMAT.md`](FORMAT.md) —— `.sandplay.json` 会话文件格式
- [`VISION.md`](VISION.md) §5.8 —— 生态层的整体设想
- [`TESTING.md`](TESTING.md) —— 怎么跑校验和测试
