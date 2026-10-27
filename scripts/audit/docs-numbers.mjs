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

  /*
   * VISION §5.8：「沙盘模块全量双语（175 键 × 2）」。
   *
   * 这个数字漂过一次：文档写 166，代码里实际是 175，
   * 而当时没有任何门禁覆盖它 —— 属于典型的「文档里的数字」幽灵
   * （CONTRACT §9.7）。补进这张表的原因就是让它以后不能再漂。
   */
  i18nKeyCount: { value: 175, source: 'VISION §5.8' },
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

/*
 * i18n 键数：数 zh-CN.ts 字典体里形如 `  'a.b': ...` 的行。
 *
 * 为什么只数 zh-CN 一侧：两侧键集合必须完全相同，那是
 * `i18n-dead-keys.mjs` 的职责（它做双向比对）。这里只关心
 * 「文档里写的那个数字」对不对。
 */
const zhSrc = readFileSync('src/i18n/zh-CN.ts', 'utf8');
const zhDictMatch = zhSrc.match(/=\s*\{([\s\S]*?)\n\};/);
const actualI18nKeyCount = zhDictMatch
  ? (zhDictMatch[1].match(/^\s{2}'[^']+'\s*:/gm) ?? []).length
  : 0;

/* ── 比对 ──────────────────────────────────────────────────────── */

const checks = [
  ['沙具数量', CLAIMS.symbolCount, actualSymbolCount],
  ['子类数量', CLAIMS.subcategoryCount, actualSubcategoryCount],
  ['大类数量', CLAIMS.categoryCount, actualCategoryCount],
  ['笔刷数量', CLAIMS.brushCount, actualBrushCount],
  ['事件种类', CLAIMS.eventKindCount, actualEventKindCount],
  ['i18n 键数', CLAIMS.i18nKeyCount, actualI18nKeyCount],
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

/* ── 文档里引用的「自测项数」───────────────────────────────────── */
/*
 * 这是上面「文档数字」的第三种形态，也是最阴的一种。
 *
 * 前两种是「固定的事实」（327 个沙具、19 种事件）—— 它们写在 CLAIMS 里，
 * 代码一变就红。
 *
 * 而这第三种是「动态的计数」：文档写「44 项自测」，自测脚本后来加到 52 项，
 * 文档没人改。它不在 CLAIMS 里，因为它不是从代码里数出来的常量，
 * 而是**另一个脚本的输出**。
 *
 * 为什么不直接跑那个脚本取数字：自测要几十秒（会启动 Chrome、写临时文件），
 * 而 `audit:docs` 是秒级的门禁。让它变慢的直接后果是没人愿意跑它。
 *
 * 所以改用静态近似：数自测脚本里 `check(` 的调用点。
 * 它不是精确的运行期计数（循环里跑 3 次只算 1 个 check），
 * 但它对「数字漂了」这个信号足够敏感 —— 这也是我们要的。
 *
 * ── 反过来说 ────────────────────────────────────────────────────
 * 这条检查有个已知的局限：如果 `check()` 写在循环里，静态计数会**少于**
 * 实际项数。所以判据不是「必须相等」，而是「文档里的数字必须 &&
 * 静态计数相差不超过 3」。超过就认为漂了。
 */
const SELF_TEST_CLAIMS = [
  /* [文档路径, 正则里的数字捕获组序号, 自测脚本, 允许的静态误差] */
  { doc: 'docs/VISION.md', script: 'scripts/validate-pack.ts', selfTest: 'scripts/audit/validate-pack-self-test.mjs' },
];

function countStaticChecks(file) {
  try {
    const src = readFileSync(file, 'utf8');
    /* 数 `check('...'` 或 `check(` 出现在行首缩进后的调用 */
    return (src.match(/^\s*check\(/gm) ?? []).length;
  } catch {
    return -1;
  }
}

/*
 * 目前 VISION 里已经不再写具体项数（改成指向命令名），
 * 所以这条检查主要防的是"未来有人又把数字写回去、然后漂掉"。
 *
 * 只有当文档里真的出现了「<自测脚本名> … N 项」这种表述时才检查。
 */
let selfTestClaimsChecked = 0;
for (const { doc, selfTest } of SELF_TEST_CLAIMS) {
  let docText;
  try {
    docText = readFileSync(doc, 'utf8');
  } catch {
    continue;
  }

  /*
   * 匹配形如「`npm run validate:pack:self-test` … 44 项」
   * 或「… + 44 项自测」，要求同一段落里既有脚本名又有项数。
   */
  const basename = selfTest.split('/').pop();
  const idx = docText.indexOf(basename);
  if (idx === -1) continue;

  /* 在提到该脚本的段落里找「N 项」 */
  const paraStart = docText.lastIndexOf('\n\n', idx);
  const paraEnd = docText.indexOf('\n\n', idx);
  const para = docText.slice(paraStart === -1 ? 0 : paraStart, paraEnd === -1 ? docText.length : paraEnd);
  const claimMatch = para.match(/(\d+)\s*项/);
  if (!claimMatch) continue;

  const claimed = Number(claimMatch[1]);
  const staticCount = countStaticChecks(selfTest);
  selfTestClaimsChecked += 1;

  /*
   * 静态计数通常 <= 运行期项数（循环会重复执行），
   * 所以断言「文档数字 >= 静态计数 - 3」且「文档数字 <= 静态计数 + 3」
   * 太严了。改成：文档数字不得**小于**静态计数的 80%，
   * 否则说明文档明显漏写了。
   *
   * 这条规则故意宽松 —— 宁可漏报也不要误报。
   * 一次误报就足以让人不再相信门禁（见 docs/TESTING.md §8）。
   */
  const ok = staticCount > 0 && claimed >= Math.floor(staticCount * 0.8);
  if (!ok) {
    failures += 1;
    console.error(
      '  ✗ ' + doc + ' 写「' + claimed + ' 项」，但 ' + basename + ' 里有 ' +
        staticCount + ' 个 check() 调用',
    );
    console.error('    文档里的项数明显小于脚本实际检查数，说明漂了。');
  } else {
    console.log(
      '  ✓ 「' + claimed + ' 项」与 ' + basename + ' 的 ' + staticCount + ' 个 check() 大致吻合',
    );
  }
}

if (selfTestClaimsChecked > 0) {
  console.log('');
  if (failures > 0) {
    console.error('✗ 文档里的自测项数已经漂了');
    process.exit(1);
  }
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
 *
 * 目前是**空的**：曾经登记过 `samples/example-image.symbolpack.json`
 * （`GOOD_FIRST_ISSUES.md` 里提议要新建），现在已经做出来了，
 * 所以从白名单移除 —— 留着它等于给这个文件开了永久免检。
 */
const PROPOSED_FILES = new Set();

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
