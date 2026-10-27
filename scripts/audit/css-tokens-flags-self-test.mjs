/**
 * css-tokens.mjs 的自测（`npm run audit:css:self-test`）。
 *
 * ── 这个自测存在的理由 ──────────────────────────────────────────
 *
 * 这个审计脚本本来就有 12 项自测（C1–C12）。但它们测的是**判定逻辑**
 * （哪个 var() 该报、哪个不该报），测的是"分析函数对不对"。
 *
 * 后来给它加了 `--strict` / `--report-only` 两个开关，发现一个尴尬的事实：
 * **当前仓库里「有 fallback 的未定义引用」是 0 处**，
 * 所以 `--strict` 那条分支**永远不执行**。一个永不执行的分支，
 * 和没写是一样的 —— 它就是幽灵：代码里看着有严格模式，
 * 实际上谁也验证不了它会不会红。
 *
 * 所以这个文件专门验**开关**：造临时 CSS 逼它走每条路。
 *
 * ── 为什么不用假仓库 ────────────────────────────────────────────
 *
 * 因为 `STYLE_DIR` 写死指向 `src/styles`。要造假仓库得改脚本支持
 * 注入路径 —— 那是为测试改产品代码。改为在 `src/styles` 下放一个
 * 临时探针文件，用完删掉，思路更简单，测的也更是真实路径。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';

const SCRIPT = 'scripts/audit/css-tokens.mjs';
const PROBE = 'src/styles/__strict_probe.css';

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

function run(args) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: String(error.stdout ?? '') + String(error.stderr ?? '') };
  }
}

/* 无论如何都要删掉探针 —— 否则它会留在仓库里污染下一次运行 */
function cleanup() {
  try {
    if (existsSync(PROBE)) unlinkSync(PROBE);
  } catch {
    /* 清理失败不改变结论 */
  }
}
process.on('exit', cleanup);

console.log('css-tokens.mjs 开关自测');
console.log('');

/* ── 基线 ─────────────────────────────────────────────────────── */
{
  const r = run([]);
  check('当前仓库通过（退出 0）', r.code === 0, 'exit=' + r.code);
  check('报告了扫描规模', /扫描：\d+ 个 CSS 文件/.test(r.out), r.out.slice(0, 200));
}

/* ── 未知参数必须报错，不能静默忽略 ─────────────────────────── */
/*
 * 这条被自己的 bug 教会：加参数解析之前，传 --strict 毫无反应，
 * 使用者以为严格模式生效了。**静默忽略参数**是最坏的一种接口不一致。
 */
{
  const r = run(['--definitely-not-a-flag']);
  check('未知参数退出 1', r.code === 1, 'exit=' + r.code);
  check('  明确提示未知参数', /未知参数/.test(r.out), r.out.slice(0, 150));
}

{
  const r = run(['--help']);
  check('--help 退出 0', r.code === 0, 'exit=' + r.code);
  check('  --help 列出 --strict', /--strict/.test(r.out), r.out.slice(0, 300));
  check('  --help 列出 --report-only', /--report-only/.test(r.out), r.out.slice(0, 300));
}

/* ── 无害引用：非严格放过，严格变红 ─────────────────────────── */
{
  writeFileSync(
    PROBE,
    '/* 探针：未定义但有 fallback */\n.__probe {\n  color: var(--xinyu-probe-undefined, red);\n}\n',
    'utf8',
  );
  try {
    const loose = run([]);
    check('非严格模式放过无害引用（退出 0）', loose.code === 0, 'exit=' + loose.code);
    check('  计数为 1', /有 fallback 的未定义引用（无害）：1 处/.test(loose.out), loose.out.slice(0, 250));

    const strict = run(['--strict']);
    check('--strict 让无害引用变红（退出 1）', strict.code === 1, 'exit=' + strict.code);
    check('  说明了判据', /--strict：仍有 1 处/.test(strict.out), strict.out.slice(0, 300));
    check('  解释了为什么要管', /设计 token 体系有缺口/.test(strict.out), strict.out.slice(0, 400));

    const reportOnly = run(['--strict', '--report-only']);
    check('--report-only 压过 --strict（退出 0）', reportOnly.code === 0, 'exit=' + reportOnly.code);
    check('  但仍如实报告', /--strict：仍有 1 处/.test(reportOnly.out), reportOnly.out.slice(0, 300));
  } finally {
    cleanup();
  }
}

/* ── 真失效：必须无条件红 ───────────────────────────────────── */
{
  writeFileSync(
    PROBE,
    '/* 探针：未定义且无 fallback */\n.__probe {\n  font-size: var(--xinyu-probe-missing);\n}\n',
    'utf8',
  );
  try {
    const r = run([]);
    check('真失效无条件红（退出 1）', r.code === 1, 'exit=' + r.code);
    check('  报出变量名', r.out.includes('--xinyu-probe-missing'), r.out.slice(-300));
    check('  报出文件名与行号', /__strict_probe\.css:\d+/.test(r.out), r.out.slice(-300));
    check('  给出两种修法', /修复方式二选一/.test(r.out), r.out.slice(-300));

    const reportOnly = run(['--report-only']);
    check('--report-only 下真失效也退出 0', reportOnly.code === 0, 'exit=' + reportOnly.code);
    check('  但仍列出问题', reportOnly.out.includes('--xinyu-probe-missing'), reportOnly.out.slice(-300));
  } finally {
    cleanup();
  }
}

/* ── 探针必须被清掉 ─────────────────────────────────────────── */
{
  check('探针文件已删除', !existsSync(PROBE));
  const r = run([]);
  check('清理后回到绿', r.code === 0, 'exit=' + r.code);
}

console.log('');
if (failures > 0) {
  console.error('✗ ' + failures + ' / ' + checks + ' 项自测失败');
  process.exit(1);
}
console.log('✓ ' + checks + ' 项自测全部通过（--strict 真的会红）');
