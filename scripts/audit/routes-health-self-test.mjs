/**
 * 路由健康门禁的变异验证（`npm run audit:routes:self-test`）。
 *
 * ── 为什么必须做 ────────────────────────────────────────────────
 *
 * 105 项全绿，可能是"所有路由都好"，也可能是"断言太松，
 * 白屏也能绿"。这条门禁存在的全部理由就是抓白屏，
 * 所以必须证明白屏会让它红。
 *
 * ── 三种白屏形态，全都要红 ──────────────────────────────────────
 *
 *   1. `<main>` display:none      —— 整块没显示（最常见）
 *   2. `<main>` visibility:hidden —— 占位但看不见
 *   3. 组件抛异常                  —— 运行时错误
 *
 * ── 这条自测抓到过门禁自己的漏洞，是本轮最有价值的产出 ──────────
 *
 * 门禁第一版用 `main.innerText` 判白屏。直觉上 innerText 会跳过
 * 隐藏元素，所以看起来没问题。
 *
 * 变异 1（display:none）**没有让它变红** —— 60 项检查照样全绿。
 * 实测 Chrome 的真实语义（见 tmp/probe-innertext.mjs）：
 *
 *   display:none 的 <main>  → innerText **37 字**（不为 0！）
 *   visibility:hidden       → innerText 0 字
 *
 * 也就是说最常见的"整块没显示"，用 innerText 判定是绿的。
 * **断言的形状对，但它验证的东西不是用户看到的东西。**
 *
 * 修法：加两条几何断言 —— getBoundingClientRect 非零尺寸 +
 * computedStyle 的 display/visibility/opacity —— 并把文本量改用
 * textContent，让"有没有内容"和"是否可见"成为两个独立维度。
 *
 * ── 为什么不真的注入 §6.2.1 那个 getSnapshot bug ────────────────
 *
 * 那会让页面无限重渲染，浏览器可能直接卡死，变异验证本身不可控。
 * 上面三种形态覆盖了"白屏"的可观测后果，已经足够证明门禁有效。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const APP = 'src/App.tsx';
const SHELL = 'src/components/layout/AppShell.tsx';
const aboutOrig = readFileSync(APP, 'utf8');
const shellOrig = readFileSync(SHELL, 'utf8');

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log('  ✓ ' + name);
  else {
    failures += 1;
    console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  }
}

function build() {
  const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: String(r.stdout ?? '') + String(r.stderr ?? '') };
}

function runGate() {
  const r = spawnSync(process.execPath, ['scripts/audit/routes-health.mjs'], { encoding: 'utf8' });
  return { code: r.status ?? 1, out: String(r.stdout ?? '') + String(r.stderr ?? '') };
}

function restore() {
  writeFileSync(APP, aboutOrig, 'utf8');
  writeFileSync(SHELL, shellOrig, 'utf8');
}
process.on('exit', restore);

console.log('变异验证：路由健康门禁');
console.log('  注意：每次变异都要重新 build（门禁读 dist/）');
console.log('');

/* ── 基线 ────────────────────────────────────────────────────── */
{
  const b = build();
  check('基线 build 成功', b.code === 0, String(b.code));
  const g = runGate();
  check('基线 105 项全绿', g.code === 0 && /105 项检查，0 项失败/.test(g.out), 'exit=' + g.code);
}

/* ── 变异 1：让 <main> 变成 display:none（模拟白屏）──────────── */
{
  /*
   * 最直接地检验核心断言。
   *
   * ── 这条变异曾经抓出过门禁自己的漏洞 ────────────────────────
   *
   * 第一版门禁用 `main.innerText` 判白屏，这条变异**没让它变红**。
   * 实测 Chrome：display:none 的 <main> 的 innerText 仍然有 37 字
   * （只有 visibility:hidden 才是 0）。
   *
   * 也就是说最常见的"整块没显示"用 innerText 判定是绿的 ——
   * 断言的形状对，但它验证的东西不是用户看到的东西。
   *
   * 现在门禁加了 getBoundingClientRect 尺寸 + computedStyle 可见性
   * 两条几何断言，这条变异必须变红才算真的有效。
   */
  const mutated = shellOrig.replace(
    '<main id="main" className="app-main">',
    '<main id="main" className="app-main" style={{ display: \'none\' }}>',
  );
  check('变异点 1 已定位（<main> display:none）', mutated !== shellOrig);
  if (mutated !== shellOrig) {
    writeFileSync(SHELL, mutated, 'utf8');
    const b = build();
    if (b.code !== 0) {
      check('  变异版本能构建', false, '构建失败：' + b.out.slice(-200));
    } else {
      const g = runGate();
      check('  门禁变红', g.code !== 0, 'exit=' + g.code);
      check('  红的正是「尺寸/不可见」那类断言',
        /真的有尺寸|可见（display|非零尺寸子元素/.test(g.out), g.out.slice(-500));
    }
    restore();
  }
}

/* ── 变异 1b：visibility:hidden（innerText 为 0 的那种）────── */
{
  const mutated = shellOrig.replace(
    '<main id="main" className="app-main">',
    '<main id="main" className="app-main" style={{ visibility: \'hidden\' }}>',
  );
  check('变异点 1b 已定位（<main> visibility:hidden）', mutated !== shellOrig);
  if (mutated !== shellOrig) {
    writeFileSync(SHELL, mutated, 'utf8');
    const b = build();
    if (b.code !== 0) {
      check('  变异版本能构建', false, b.out.slice(-200));
    } else {
      const g = runGate();
      check('  门禁变红', g.code !== 0, 'exit=' + g.code);
    }
    restore();
  }
}

/* ── 变异 2：让一个页面组件抛异常 ────────────────────────────── */
{
  /*
   * 模拟"组件内抛异常"—— 这是白屏最常见的真实原因之一。
   * 检验「无未捕获运行时错误」这条断言会不会红。
   */
  const mutated = aboutOrig.replace(
    'const ResourcesPage = lazy(',
    'const __boom = () => { throw new Error("变异注入：故意抛错"); };\nconst ResourcesPage = lazy(',
  );
  /* 需要真的调用它，否则只是声明 */
  const withCall = mutated.replace(
    'export default function App(',
    'export default function App(\n) {\n  __boom();\n}\n\nfunction __AppUnused(',
  );
  check('变异点 2 已定位（组件抛错）', withCall !== aboutOrig);
  if (withCall !== aboutOrig) {
    writeFileSync(APP, withCall, 'utf8');
    const b = build();
    if (b.code !== 0) {
      /*
       * 构建失败也算"门禁有效"吗？不算 —— 我们要验的是
       * 运行时门禁会红。构建失败说明变异手法不合适，
       * 这条记为"跳过"而不是"通过"，避免自欺。
       */
      check('  变异版本能构建（否则无法验运行时门禁）', false, b.out.slice(-200));
    } else {
      const g = runGate();
      check('  门禁变红', g.code !== 0, 'exit=' + g.code);
      check('  红的正是「运行时错误」那条', /运行时错误|pageerror|故意抛错/.test(g.out), g.out.slice(-400));
    }
    restore();
  }
}

/* ── 恢复 ────────────────────────────────────────────────────── */
{
  restore();
  const b = build();
  check('恢复后 build 成功', b.code === 0, String(b.code));
  const g = runGate();
  check('恢复后重新全绿', g.code === 0 && /105 项检查，0 项失败/.test(g.out), 'exit=' + g.code);
  check('两个源文件逐字节还原',
    readFileSync(APP, 'utf8') === aboutOrig && readFileSync(SHELL, 'utf8') === shellOrig);
}

console.log('');
if (failures > 0) {
  console.error('✗ ' + failures + ' / ' + checks + ' 项失败');
  process.exit(1);
}
console.log('✓ ' + checks + ' 项：白屏与运行时错误都会让门禁变红');
