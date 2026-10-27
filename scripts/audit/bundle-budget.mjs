/**
 * 体积预算门禁（VISION §5.9 L344 / CONTRACT §7）。
 *
 * ── 为什么需要这个脚本 ────────────────────────────────────────────
 *
 * 「首屏 JS ≤ 200KB gzip」写在 VISION 里很久了，但**没有任何门禁在量**。
 * 一个没人量的预算等于没有预算 —— v2.0 对账第一次量的时候，
 * 首屏是 145.8KB 却已经把 8 个页面全静态塞进主包（其中 ScaleRunPage +
 * scales/data 就占 55KB 源码）。再往主包塞两三个页面就会悄悄越线，
 * 而所有测试仍然是绿的。
 *
 * ── 度量口径 ────────────────────────────────────────────────────
 *
 * 「首屏 JS」= 打开 `/` 时浏览器实际下载的 JS。
 *
 * 不能简单地把 dist 里所有 chunk 相加 —— 懒加载的 chunk 首屏不下载。
 * 正确做法是**沿着 index chunk 的静态 import 链走一遍**：
 *   - `import"./x.js"` / `from"./x.js"`  → 静态，算首屏
 *   - `import("./x.js")` / `__vitePreload` → 动态，不算
 *
 * 这个口径比「index 单个文件」严格，因为它把共享 chunk 也算进来；
 * 又比「所有 chunk 相加」正确，因为后者会把用户根本没访问的页面算进去。
 *
 * ── 判失败线 ────────────────────────────────────────────────────
 *
 * 预算 200KB，但**超过 210KB 才判失败**（留 5% 抖动）。
 * 理由：gzip 输出会随依赖小版本变化几十字节到一两 KB，
 * 卡在 200.0KB 会让无关的依赖升级把门禁打红，久了就没人看了。
 * 真正要拦的是「又塞了一个页面进去」这种几十 KB 的量级。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_FIRST_SCREEN = 200 * 1024;
const FAIL_FIRST_SCREEN = 210 * 1024;
const BUDGET_THREE = 600 * 1024;

/*
 * 从**当前工作目录**找 dist，而不是从脚本位置找。
 *
 * 这不是随手写的：自测会在临时目录里造假的 dist，然后 `cwd` 切进去跑
 * 本脚本，验证判据在该红时会红。如果这里写死成相对脚本的路径，
 * 自测就只能测到真仓库的体积数字 —— 那种测试会在依赖升级后无故变红，
 * 然后被改成 `toBeGreaterThan(0)` 之类的恒真断言。
 */
const dir = join(process.cwd(), 'dist', 'assets');

let files;
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.js'));
} catch {
  console.error('✗ 找不到 ' + dir + '，请先 `npm run build`');
  process.exit(1);
}

/* 空目录也要判红：否则「构建产物是空的」会被当成「体积很小」而通过 */
if (files.length === 0) {
  console.error('✗ ' + dir + ' 里没有 JS 文件，构建产物异常');
  process.exit(1);
}

const gzipSize = (name) => gzipSync(readFileSync(join(dir, name)), { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1) + 'KB';

const indexName = files.find((f) => /^index-/.test(f));
if (!indexName) {
  console.error('✗ 找不到 index chunk');
  process.exit(1);
}

const indexSrc = readFileSync(join(dir, indexName), 'utf8');

/* 静态 import 链 */
const statics = new Set();
for (const m of indexSrc.matchAll(/import\s*["']\.\/([\w.-]+\.js)["']/g)) statics.add(m[1]);
for (const m of indexSrc.matchAll(/from\s*["']\.\/([\w.-]+\.js)["']/g)) statics.add(m[1]);

const firstScreenSize = [indexName, ...statics].reduce((sum, name) => sum + gzipSize(name), 0);

const threeName = files.find((f) => /^three-/.test(f));
const threeSize = threeName ? gzipSize(threeName) : 0;
const threeInMain = threeName ? statics.has(threeName) : false;

const failures = [];
const checks = [];

/* 1. 首屏体积 */
if (firstScreenSize > FAIL_FIRST_SCREEN) {
  failures.push(
    '首屏 JS ' + kb(firstScreenSize) + ' 超过判失败线 ' + kb(FAIL_FIRST_SCREEN) + '（预算 ' + kb(BUDGET_FIRST_SCREEN) + '）',
  );
  checks.push('✗ 首屏 JS ' + kb(firstScreenSize) + ' / 预算 ' + kb(BUDGET_FIRST_SCREEN));
} else if (firstScreenSize > BUDGET_FIRST_SCREEN) {
  checks.push(
    '⚠ 首屏 JS ' + kb(firstScreenSize) + ' 略超预算 ' + kb(BUDGET_FIRST_SCREEN) +
      '，但未达判失败线 ' + kb(FAIL_FIRST_SCREEN),
  );
} else {
  checks.push(
    '✓ 首屏 JS ' + kb(firstScreenSize) + ' / 预算 ' + kb(BUDGET_FIRST_SCREEN) +
      '（余量 ' + kb(BUDGET_FIRST_SCREEN - firstScreenSize) + '）',
  );
}

/* 2. 3D 路由体积 */
if (threeSize > BUDGET_THREE) {
  failures.push('3D 路由 ' + kb(threeSize) + ' 超过预算 ' + kb(BUDGET_THREE));
  checks.push('✗ 3D 路由 ' + kb(threeSize) + ' / 预算 ' + kb(BUDGET_THREE));
} else {
  checks.push('✓ 3D 路由 ' + kb(threeSize) + ' / 预算 ' + kb(BUDGET_THREE));
}

/* 3. three 必须懒加载（这条比体积更重要：混进主包就没法懒加载了） */
if (threeInMain) {
  failures.push('three 被打进了主 chunk —— 它必须由 SandRendererSwitch 动态 import');
  checks.push('✗ three 在主包里');
} else {
  checks.push('✓ three 不在主包（懒加载生效）');
}

/* 4. 危机页必须是首屏静态可达（拆包不能拿安全性换体积） */
const safetyBundled = files.some((f) => /SafetyPage/.test(f));
if (safetyBundled) {
  failures.push(
    'SafetyPage 被拆成了独立 chunk —— 危机页必须静态可达（CONTRACT §5「≤2 次点击」）',
  );
  checks.push('✗ SafetyPage 被拆包（危机页不应有加载延迟）');
} else {
  checks.push('✓ SafetyPage 仍在主包（危机页零延迟）');
}

console.log('体积预算审计（VISION §5.9 L344 / CONTRACT §7）');
console.log('');
for (const line of checks) console.log('  ' + line);
console.log('');

if (failures.length > 0) {
  console.error('✗ ' + failures.length + ' 项超预算：');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}

console.log('✓ 全部达标');
