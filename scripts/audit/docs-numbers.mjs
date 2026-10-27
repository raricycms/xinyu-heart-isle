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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/* ── 文档里的路径与命令 ────────────────────────────────────────── */
/*
 * 数字对了，不代表文档能用。
 *
 * 同一类幽灵的另一种形态：文档里写着 `npm run some:script` 或
 * `` `scripts/foo.mjs` ``，而那个脚本早被删了 / 从没存在过。
 * 数字审计抓不到它 —— 它不是数字。测试更抓不到 —— 测试不读文档。
 *
 * 新来的人照着做，第一步就撞墙，然后不知道是文档错了还是自己错了。
 */
const DOCS_TO_SCAN = [
  'CONTRIBUTING.md',
  'GOOD_FIRST_ISSUES.md',
  'docs/SYMBOL_PACK.md',
  'docs/FORMAT.md',
  'docs/TESTING.md',
  'docs/VISION.md',
  '.github/ISSUE_TEMPLATE/bug_report.md',
  '.github/ISSUE_TEMPLATE/feature_request.md',
  '.github/ISSUE_TEMPLATE/content_feedback.md',
];

/*
 * 文档里"提议新建"的文件，此刻本不该存在。
 * 白名单必须显式登记，不能靠"找不到就跳过"—— 那样审计就恒真了。
 */
const PROPOSED_FILES = new Set([
  /* GOOD_FIRST_ISSUES.md 任务 5 要新建的示例 */
  'samples/example-image.symbolpack.json',
]);

/*
 * 裸文件名（如 `ghost-fields.mjs`、`stats.ts`）在文档里很常见，
 * 读者靠编辑器搜索能定位到。所以按**递归搜索整个仓库**判断，
 * 而不是只在几个固定目录里找 —— 第一版用了固定目录列表，
 * 结果 `src/sandbox/view/measure.test.ts` 这种四层深的文件全被判成"不存在"，
 * 22 个报告里 21 个是误报。**误报和漏报一样有害**：
 * 一次误报就够让人从此不信这道门禁。
 */
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'tmp', '.git', 'coverage', '.vite']);

/** 仓库内文件名索引（只建一次） */
const fileIndex = new Set();
/** 也存相对路径，用于匹配 `src/lib/storage.ts` 这种带目录的引用 */
const pathIndex = new Set();

function walk(dir, prefix = '') {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const rel = prefix === '' ? entry.name : prefix + '/' + entry.name;
    if (entry.isDirectory()) {
      walk(join(dir, entry.name), rel);
    } else {
      fileIndex.add(entry.name);
      pathIndex.add(rel);
    }
  }
}
walk('.');

/**
 * 判断文档里引用的文件是否存在。
 *
 * 三档匹配，由严到宽：
 *   1. 完整相对路径命中（`src/lib/storage.ts`）
 *   2. 文件名在仓库里任何位置存在（`storage.ts`）
 *   3. 后缀形态的统称（`.sandplay.json` / `.symbolpack.json`）——
 *      这是**格式名**不是文件名，只要有同后缀的样例就算成立
 */
function referenceExists(rel) {
  if (PROPOSED_FILES.has(rel)) return true;
  if (pathIndex.has(rel.replace(/^\.\//, ''))) return true;
  const baseName = rel.split('/').pop() ?? rel;
  if (fileIndex.has(baseName)) return true;
  /* 后缀统称：`.sandplay.json` 这类没有主名的写法 */
  if (/^\.[a-z0-9.]+$/.test(baseName)) {
    return [...fileIndex].some((name) => name.endsWith(baseName));
  }
  return false;
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
let linkFailures = 0;

console.log('');
console.log('文档路径与命令一致性审计');
console.log('');

for (const docPath of DOCS_TO_SCAN) {
  let text;
  try {
    text = readFileSync(docPath, 'utf8');
  } catch {
    console.log('  ✗ ' + docPath + ' 读不到');
    linkFailures += 1;
    continue;
  }

  /* 1. 反引号里形如路径的东西 */
  const referenced = [
    ...text.matchAll(/`([A-Za-z0-9_./@-]+\.(?:md|ts|tsx|mjs|json|yml))`/g),
  ].map((m) => m[1]);

  const missing = [];
  for (const rel of [...new Set(referenced)]) {
    if (!referenceExists(rel)) missing.push(rel);
  }

  /*
   * 2. `npm run xxx` 里的脚本必须真的存在。
   *
   * 注意排除 `npm run audit:` 这种**前缀写法** —— 文档里常写
   * 「`npm run audit:i18n` / `audit:css`」来指一组脚本，
   * 正则会把结尾的冒号吃掉，得到一个叫 `audit:` 的假脚本名。
   * 只要是「一组脚本的统称」，就不该判红。
   */
  const npmScripts = [...text.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)].map((m) => m[1]);
  const missingScripts = [...new Set(npmScripts)].filter(
    (name) =>
      !(name in pkg.scripts) &&
      /* 以冒号结尾 = 一组脚本的前缀，不是具体脚本名 */
      !name.endsWith(':') &&
      /* 或者确实是某几个脚本的公共前缀 */
      !Object.keys(pkg.scripts).some((real) => real.startsWith(name + ':')),
  );

  if (missing.length === 0 && missingScripts.length === 0) {
    console.log('  ✓ ' + docPath);
  } else {
    linkFailures += 1;
    console.log('  ✗ ' + docPath);
    for (const rel of missing) console.log('      引用不存在的文件：' + rel);
    for (const name of missingScripts) console.log('      引用不存在的 npm 脚本：' + name);
  }
}

console.log('');
if (linkFailures > 0) {
  console.error('✗ ' + linkFailures + ' 个文档引用了不存在的东西');
  console.error('');
  console.error('  修法：要么补上被引用的文件/脚本，要么改文档。');
  console.error('  不要往 PROPOSED_FILES 白名单里塞 —— 那是给"提议新建"用的，');
  console.error('  塞错了就等于把这条审计关掉了。');
  process.exit(1);
}

console.log('✓ 全部 ' + checks.length + ' 项文档数字与代码一致，' +
  DOCS_TO_SCAN.length + ' 个文档的引用全部有效');
