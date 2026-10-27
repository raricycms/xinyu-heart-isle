/**
 * 死组件门禁（`npm run audit:dead`）。
 *
 * ── 为什么这条门禁差点没做成 ────────────────────────────────────
 *
 * `docs/TESTING.md` §9 长期写着「死组件扫描有假阳性风险，需要先设计
 * 白名单机制再纳入」。这句话让它搁置了很久。
 *
 * 先探查了一次真实数据：147 个 export 里 11 个「无外部引用」，
 * 逐个看 —— **全是常量/配置表，一个真死组件都没有**。
 *
 * 也就是说那条"假阳性风险"的担忧，被夸大了。真正的风险是另一种：
 * **把常量误判成组件**。所以判据要收紧到只看 React 组件。
 *
 * ── 判据 ────────────────────────────────────────────────────────
 *
 * 同时满足四条才报「死」：
 *
 *   1. 在 `.tsx` 文件里（`.ts` 里的全是常量/函数，不在此列）
 *   2. 名字以大写开头（React 组件惯例）
 *   3. 在别的文件里**一次都没出现**
 *   4. 在本文件里除了 export 声明之外**没有被使用**
 *
 * 第 4 条是关键。`export function Foo()` 后面如果本文件里
 * 没有再出现 `Foo`，那它既没被外部用、也没被内部用 —— 真死。
 * 如果本文件里还在用（比如组合成更大的组件），它活着。
 *
 * ── 为什么不用 TypeScript 的 AST ────────────────────────────────
 *
 * 因为不需要。这个判据的本质是「这个名字在别处出现过吗」，
 * 用词边界匹配就够了，而且没有依赖、跑得快、易读。
 *
 * AST 精确但会让门禁依赖 `typescript` 包的内部 API ——
 * 升级 TS 时门禁可能先坏，那是最难受的一种维护负担。
 *
 * ── 已知局限 ────────────────────────────────────────────────────
 *
 * 动态引用会漏判：如果某个组件是拼字符串 `import('./' + name)` 加载的，
 * 会被误报成死。所以白名单机制存在，且必须写明理由。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'src';

/*
 * 白名单：组件名 → 为什么它活着，尽管静态分析看不见引用。
 *
 * 每一条都必须写清理由。写「临时」或「先放着」不算理由 ——
 * 那种条目会在半年后变成没人敢删的僵尸。
 */
const ALLOWLIST = new Map([
  /*
   * 用法示例文件。它存在的意义是给人看「这个 API 怎么用」，
   * 不被任何产品代码 import 是**正确状态**，不是死代码。
   *
   * 它本身有 JSDoc 警告说「不要 import 这个文件」。
   */
  [
    'SurfaceWorkbenchExample',
    'src/sandbox/surface/usage.example.tsx 是用法示例，设计上不被引用',
  ],
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const allFiles = walk(SRC);
const sourceFiles = allFiles.filter(
  (f) => !f.includes('__tests__') && !/\.test\.tsx?$/.test(f),
);
const testFiles = allFiles.filter(
  (f) => f.includes('__tests__') || /\.test\.tsx?$/.test(f),
);

/* 所有可能「引用」到组件的语料 */
const corpus = [...sourceFiles, ...testFiles].map((f) => ({
  file: relative('.', f),
  text: readFileSync(f, 'utf8'),
}));

/* 只扫 .tsx —— 组件必须渲染 JSX */
const tsxSources = sourceFiles.filter((f) => f.endsWith('.tsx'));

const dead = [];

for (const file of tsxSources) {
  const rel = relative('.', file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    /* 只认组件的三种常见声明形态 */
    let name = null;
    let m = line.match(/^export\s+function\s+([A-Z]\w*)\s*[(<]/);
    if (m) name = m[1];
    m = line.match(/^export\s+const\s+([A-Z]\w*)\s*(?::[^=]+)?=\s*(?:memo\(|forwardRef\(|\(|function)/);
    if (m) name = m[1];

    if (!name) continue;
    if (ALLOWLIST.has(name)) continue;

    /* 1. 别的文件里出现过吗 */
    const wordBoundary = new RegExp(`\\b${name}\\b`);
    const referencedElsewhere = corpus.some((c) => c.file !== rel && wordBoundary.test(c.text));
    if (referencedElsewhere) continue;

    /*
     * 2. 本文件里除声明行之外还有用到吗？
     *    统计全文出现次数，减去声明行那一处。
     */
    const total = (text.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
    if (total > 1) continue;

    dead.push({ name, file: rel, line: i + 1 });
  }
}

const reportOnly = process.argv.includes('--report-only');
const strict = process.argv.includes('--strict');

console.log('死组件门禁（.tsx 里既没被外部引用、也没被本文件使用的组件）');
console.log('');
console.log(
  '  扫描：' + tsxSources.length + ' 个 .tsx 文件，' +
    corpus.length + ' 个文件参与引用判定',
);
console.log('  白名单：' + ALLOWLIST.size + ' 项（每项都有理由）');
console.log('');

if (dead.length === 0) {
  console.log('✓ 没有死组件');
  console.log('  —— 每个导出的组件要么被别处使用，要么在本文件里被组合进去。');
  process.exit(0);
}

console.error('✗ ' + dead.length + ' 个组件既没被引用、也没在本文件内使用：');
console.error('');
for (const d of dead) {
  console.error('  ' + d.name);
  console.error('    ' + d.file + ':' + d.line);
}
console.error('');
console.error('  可能的原因：');
console.error('    1. 它真的没人用了 → 删掉。留着就是下一次「幽灵」的原料。');
console.error('    2. 它被动态引用（拼字符串 import）→ 加进本脚本的白名单，');
console.error('       **并写明为什么静态分析看不见它**。');
console.error('    3. 它是给别人看的示例 → 加白名单，理由写「示例文件」。');
console.error('');
console.error('  不要为了让它变绿而临时加白名单 —— 半年后没人敢删那种条目。');

if (reportOnly) {
  console.log('');
  console.log('  模式：--report-only（不影响退出码）');
  process.exit(0);
}
process.exit(1);
