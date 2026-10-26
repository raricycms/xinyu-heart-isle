# 样例文件

三个 `.sandplay.json` 样例，用于测试外部工具的**通过路径**和**失败路径**。

格式规范见 [`docs/FORMAT.md`](../docs/FORMAT.md)。JSON Schema 见 [`public/schema/sandplay-session-v1.schema.json`](../public/schema/sandplay-session-v1.schema.json)。

---

## 文件清单

| 文件 | 应当的结果 | 内容 |
| --- | --- | --- |
| [`example.sandplay.json`](./example.sandplay.json) | ✅ 通过 | 最小完整例子：1 个摆件、3 条事件、平整沙面、用户自述。适合作为「第一个能跑通的输入」。 |
| [`surface-demo.sandplay.json`](./surface-demo.sandplay.json) | ✅ 通过 | 全字段例子：5 个摆件、10 条事件、带湿度场的湿沙、`meta`、`annotations`、`prompts`。适合测试渲染与沙面解码。 |
| [`broken.sandplay.json`](./broken.sandplay.json) | ❌ 失败（5 error / 1 warning） | **故意写坏**，用来验证你的错误处理不会崩。 |

---

## 用官方校验器验证

需要 Node 22+，无需 `npm install`：

```bash
# 逐个跑
node --experimental-strip-types scripts/validate-session.ts samples/example.sandplay.json

# 一次跑全部（通配符由校验器自己展开，PowerShell 下也能用）
node --experimental-strip-types scripts/validate-session.ts samples/*.sandplay.json
```

预期：

- `example.sandplay.json` 和 `surface-demo.sandplay.json` → 退出码 `0`；
- `broken.sandplay.json` → 退出码 `1`。

所以上面那条「跑全部」的命令**整体退出码是 `1`**，这是对的——它证明错误路径确实会被抓到。

想只跑通过的那两个：

```bash
node --experimental-strip-types scripts/validate-session.ts \
  samples/example.sandplay.json samples/surface-demo.sandplay.json
```

---

## `broken.sandplay.json` 里的 6 个问题

| # | 位置 | 问题 | 级别 |
| --- | --- | --- | --- |
| 1 | `session.items[0].x` | `1.42` 越出归一化范围 `[0,1]` | error |
| 2 | `session.items[1].id` | `"item_0001"` 与上一个摆件重复 | error |
| 3 | `session.events[1].type` | `"item.fly"` 不是 19 种事件类型之一 | error |
| 4 | `session.events[2].t` | `1500` 比上一条的 `3000` 小（时间倒退） | warning |
| 5 | `session.meta.realName` | 隐私红线字段 | error |
| 6 | `session.meta.phone` | 隐私红线字段 | error |

其中 5、6 是**隐私红线**：只要键名命中 `realName` / `name` / `phone` / `idCard` / `email` / `address` / `wechat`，校验就报 error 而不是 warning。理由见 [`docs/FORMAT.md`](../docs/FORMAT.md) 第 8 节。

第 4 条是 warning 而不是 error，因为时间倒退通常是「合并了两段会话」的结果，数据本身还能读。加 `--strict` 时会升级成 error：

```bash
node --experimental-strip-types scripts/validate-session.ts --strict samples/broken.sandplay.json
# → 6 个错误（--strict：警告已按错误处理）
```

---

## 关于 `surface-demo.sandplay.json` 里的沙面

它的 `surface.height` 和 `surface.wetness` 是用心屿自己的编解码器（`src/sandbox/surfaceCodec.ts`）真实生成的，不是编造的字符串：

- `height`：128×96，含一座沙丘和一条挖出来的沟，RLE 后约 3.9 KB 原始字节 / 5.2 KB Base64；
- `wetness`：沙丘右侧一块润湿区域，`W1` 编码后 175 字节。

如果你在实现第 6 节的解码器，这个文件是最合适的自测输入：解出来的 `data.length` 必须是 `128 * 96 = 12288`，湿度解码后也必须是 `12288` 个字节（一个不多一个不少）。

`example.sandplay.json` 里的 `UzEBgABgAAEAAABagGA=` 是「全部是基准值 90 的平整沙面」，14 字节。可以手工逐字节验算，见 [`docs/FORMAT.md`](../docs/FORMAT.md) 第 6.2 节末尾。

---

## 自己造样例时的提示

1. **先只写必填字段**，跑校验器确认通过，再逐步加可选字段——比一次写完再 debug 快。
2. **`events` 可以是空数组**，但不能缺字段。如果你只想测渲染，空数组最省事。
3. **`surface` 整个可以省略**，表示「没碰过沙子」。
4. **`items` 与 `events` 的重放一致性校验器不查**，但心屿内部会查。如果你的工具依赖事件流，请自己实现这条断言：从空状态依次 `apply` 全部事件，结果必须与 `items` 逐字段相等。
5. **别用编辑器保存成带 BOM 的 UTF-8**。校验器会剥掉 BOM 容错，但别的工具不一定。
