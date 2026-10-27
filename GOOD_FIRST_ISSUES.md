# 先从这些开始（good first issue）

> 这里的每一条都**不需要读完整套架构**就能做完，也不碰核心文件
> （`src/App.tsx`、`src/lib/**`、`src/sandbox/events.ts` 等）。
> 动手前请先读 [`CONTRIBUTING.md`](CONTRIBUTING.md) 的「先读这三条」。

---

## 文档类（改 Markdown 就行）

### 1. 给 `docs/SYMBOL_PACK.md` 补一段"手把手做成功第一个包"

现在这份文档把**格式**讲全了，但没有一条从零开始的完整步骤。
补一段：打开文本编辑器 → 复制示例 → 改两个字段 → 跑校验 → 导入。
目标读者是**没写过 JSON 的沙盘师**。

验收：照着做能成功；`npm run validate:pack:self-test` 仍然全绿。

---

### 2. 给 `docs/FORMAT.md` 的每个字段加一个"最小合法值"

外部工具作者最常卡住的地方是"这个字段到底能不能省、省了会怎样"。
逐字段补一句"必填/可选，省了会默认成什么"。

验收：任取三个字段，都能从文档里直接查到答案。

---

### 3. 把 `docs/TESTING.md` §6「已知缺口」逐个标注影响面

现在每条缺口只写了"缺什么"，没写"所以用户会遇到什么"。
比如「视觉门禁不是基线图对比」——实际后果是什么？
补上「所以可能漏掉什么 bug」，按影响排序。

验收：每条缺口都有"实际后果"一句话。

---

## 代码类（小而独立）

### 4. `audit:css` 补 `--strict`，与 ghost / i18n 对齐

`ghost-fields.mjs` 和 `i18n-dead-keys.mjs` 都有 `--strict`，
`css-tokens.mjs` 没有。目前它默认就是严格模式，但**接口不一致**
会让人以为它不支持。

验收：加 `--strict`（等价于当前行为）+ `--report-only`；
自测里各加一条用例；`npm run check` 仍绿。

---

### 5. 给 `samples/` 加一个"用内嵌图片的沙具包"示例

现在 `example.symbolpack.json` 只用 emoji（1KB）。
但真实需求是放照片，而 base64 data URI 是新手最容易写错的地方。

验收：新增 `samples/example-image.symbolpack.json`（一张极小的真实
data URI，比如 1×1 的 PNG），`npm run validate:pack` 通过；
在 `docs/SYMBOL_PACK.md` §4.3 加一句指向它。

---

### 6. 把 `MAX_EVENTS = 4000` 的截断行为写成测试

现在这个上限存在，但"超了之后发生什么"没有断言。

验收：新增测试，构造 4001 条事件，断言截断后仍能回放、
且保留的是**近期**事件（不是早期事件）；变异验证（把上限改大、
断言必须红）。

---

## 不建议新手碰的（说明一下原因）

| 文件 | 原因 |
| --- | --- |
| `src/sandbox/events.ts` | 事件模型是回放/统计/导出的共同基础，改一个字段会连带四处 |
| `src/lib/storage.ts` | 所有本地数据的读写都走它，改错会**静默丢数据** |
| `src/sandbox/surfaceCodec.ts` | 沙面编解码有明确的二进制格式与兼容性要求（`docs/FORMAT.md` §6） |
| `src/App.tsx` | 首屏体积被门禁卡着 |

---

## 提交前请跑

```bash
npm run typecheck
npm run test
npm run check      # 全部门禁；大约几分钟
```

改了文档就至少跑 `npm run audit:docs`（核对文档里的数字与代码一致）。
