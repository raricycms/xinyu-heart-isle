/**
 * 文档数字一致性审计（`npm run audit:docs`）。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 *
 * `docs/VISION.md` §1.2 的评分卡是**本文档的核心工具**（原话），
 * 里面写着一串具体数字：
 *
 *   327 个沙具 / 24 个子类 / 6 大类 / 19 种事件 / 7 种笔刷
 *
 * 这些是**可核实的事实**，也是"v2.0 达成"这个结论的支撑。问题是：
 * 没有任何机制保证它们和代码一致。
 *
 * 删掉 50 个沙具，VISION 依然写着 327；改成 6 种笔刷，评分卡依然写 7。
 * 而所有测试仍然绿 —— 因为**测试测代码，不测文档**。
 *
 * 这是第八类幽灵，也是最难自查的一类：**文档层的幽灵**。
 * 前七类都在代码里，可以用「删掉被测对象看门禁绿不绿」发现；
 * 文档层的错误没有任何运行时痕迹，只能靠交叉核对。
 *
 * ── 判据 ────────────────────────────────────────────────────────
 *
 * 从**代码里数**，和**文档里写的**比。不一致就红。
 *
 * 刻意不做的事：不去解析 Markdown 表格结构（太脆，一个空格就失效）。
 * 而是把「文档声称的数字」作为**显式常量**写在下面，并注明出处行号。
 * 这样：
 *   - 代码变了 → 这里红，提醒你去更新文档
 *   - 文档变了 → 这里也得跟着改，改的时候必须看一眼代码
 * 两边互相钉住。
 */
import { readFileSync } from 'node:fs';

/* ── 文档声称的数字（出处见注释，改动时请同步 docs/VISION.md）── */
const CLAIMS = {
  /* VISION §1.2 D2：「327 个沙具 / 24 子类 / 6 大类」 */
  symbolCount: { value: 327, source: 'VISION §1.2 D2' },
  subcategoryCount: { value: 24, source: 'VISION §1.2 D2' },
  categoryCount: { value: 6, source: 'VISION §1.2 D2' },

  /* VISION §1.2 D1：「7 种笔刷」 */
  brushCount: { value: 7, source: 'VISION §1.2 D1' },

  /* VISION §1.2 D3：「事件流」；ROADMAP v2.0「19 种事件」 */
  eventKindCount: { value: 19, source: 'ROADMAP v2.0' },
};

/* ── 从代码里数 ────────────────────────────────────────────────── */

const symbolsSrc = readFileSync('src/sandbox/symbols.ts', 'utf8');

/*
 * 沙具定义形如：s('id', '名称', '子类', '字形', ...)
 * 只数行首缩进后的 s( —— 避免数到注释或其它同名调用。
 */
const symbolMatches = [...symbolsSrc.matchAll(/^\s*s\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/gm)];
const actualSymbolCount = symbolMatches.length;
const subcategories = new Set(symbolMatches.map((m) => m[3]));
const actualSubcategoryCount = subcategories.size;

/*
 * 大类 = 子类名的第一个连字符之前的部分。
 * 例：animal-wild → animal；person-adult → person。
 * 这与 symbols.ts 里的 CATEGORIES 常量应当一致，也顺便交叉验证了它。
 */
const categories = new Set([...subcategories].map((s) => s.split('-')[0]));
const actualCategoryCount = categories.size;

/* 笔刷：SurfaceTool 联合类型 */
const typesSrc = readFileSync('src/lib/types.ts', 'utf8');
const toolUnion = typesSrc.match(/export type SurfaceTool\s*=([\s\S]{0,400}?);/);
const actualBrushCount = toolUnion
  ? [...toolUnion[1].matchAll(/'([a-z-]+)'/g)].length
  : 0;

/* 事件种类：EventPayload 的 kind 联合 */
const eventsSrc = readFileSync('src/sandbox/events.ts', 'utf8');
/*
 * 不能用 `EventPayload =([\s\S]{0,2000}?);` —— 联合类型第一个成员内部
 * 就有分号（`{ kind: 'item.add'; item: SandboxItem }`），非贪婪匹配
 * 会在那里截断，只数到 1 个。
 *
 * 改为：从 `export type EventPayload` 起，一直取到**行首不是 `|` 或空行**为止。
 * 这对联合类型的书写格式是稳健的，也不怕成员数量变化。
 */
const eventUnionStart = eventsSrc.indexOf('export type EventPayload');
let eventUnionText = '';
if (eventUnionStart !== -1) {
  const rest = eventsSrc.slice(eventUnionStart).split('\n');
  for (let i = 1; i < rest.length; i += 1) {
    const line = rest[i];
    /* 联合结束：既不是续行 `|` 也不是空行 */
    if (line.trim() !== '' && !line.trimStart().startsWith('|')) break;
    eventUnionText += line + '\n';
  }
}
const actualEventKindCount = [...eventUnionText.matchAll(/kind:\s*'([a-z.]+)'/g)].length;

/* ── 比对 ──────────────────────────────────────────────────────── */

const checks = [
  ['沙具数量', CLAIMS.symbolCount, actualSymbolCount],
  ['子类数量', CLAIMS.subcategoryCount, actualSubcategoryCount],
  ['大类数量', CLAIMS.categoryCount, actualCategoryCount],
  ['笔刷数量', CLAIMS.brushCount, actualBrushCount],
  ['事件种类', CLAIMS.eventKindCount, actualEventKindCount],
];

console.log('文档数字一致性审计（docs/VISION.md §1.2 评分卡）');
console.log('');

let failures = 0;
for (const [label, claim, actual] of checks) {
  const ok = claim.value === actual;
  if (!ok) failures += 1;
  console.log(
    '  ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(10) +
      '文档 ' + String(claim.value).padStart(3) + '  ｜  代码 ' + String(actual).padStart(3) +
      '  （' + claim.source + '）',
  );
}

console.log('');

if (failures > 0) {
  console.error('✗ ' + failures + ' 项文档数字与代码不一致');
  console.error('');
  console.error('  修法二选一：');
  console.error('    - 代码是对的那就更新 docs/VISION.md，并同步本脚本的 CLAIMS');
  console.error('    - 文档是对的那就补回代码里缺的东西');
  console.error('');
  console.error('  不要只改本脚本的数字 —— 那样只是把矛盾藏起来。');
  process.exit(1);
}

console.log('✓ 全部 ' + checks.length + ' 项文档数字与代码一致');
