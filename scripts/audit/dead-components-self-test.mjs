/**
 * 死组件门禁的自测（`npm run audit:dead:self-test`）。
 *
 * ── 这个门禁第一次跑就说「✓ 没有死组件」====================
 *
 * 有两种可能：
 *   A. 代码库确实干净
 *   B. 判据写错了，什么都抓不到（幽灵门禁）
 *
 * 光看输出分不出来。所以这里**人为制造死组件**确认能抓到，
 * 再造几种"看起来像死、其实活着"的确认不误报。
 *
 * ── 为什么双向都要验 ────────────────────────────────────────────
 *
 * 只验"能抓到" → 误报会泛滥 → 门禁被关掉。
 * 只验"不误报" → 门禁形同虚设 → 幽灵。
 *
 * docs/TESTING.md §4.7.2 那句话在这里最适用：
 * **误报和漏报一样有害。**
 *
 * ── 一个关于测试自身的教训 ──────────────────────────────────────
 *
 * 第一版用 `execFileSync`，成功时只返回 stdout，拿不到 stderr。
 * 而 `--report-only` 的设计是「问题列表走 stderr、退出码仍为 0」——
 * 于是自测看到「退出 0 且无输出」，误判成"没列出问题"，
 * 红了一条。
 *
 * 产品代码是对的，**测试的捕获方式错了**。
 * 改用 spawnSync 同时拿 stdout + stderr。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

const PROBE = 'src/__dead_probe.tsx';
const TEST_PROBE = 'src/__dead_probe.test.tsx';
const GATE = 'scripts/audit/dead-components.mjs';

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

function run(args = []) {
  const result = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
  return {
    code: result.status ?? 1,
    out: String(result.stdout ?? '') + String(result.stderr ?? ''),
  };
}

function cleanup() {
  for (const f of [PROBE, TEST_PROBE]) {
    try {
      unlinkSync(f);
    } catch {
      /* 已删 */
    }
  }
}
process.on('exit', cleanup);

console.log('死组件门禁 · 自测');
console.log('');

/* ── 1. 基线 ──────────────────────────────────────────────────── */
{
  const r = run();
  check('当前仓库通过（退出 0）', r.code === 0, 'exit=' + r.code);
  check('  报告扫描规模', /扫描：\d+ 个 \.tsx 文件/.test(r.out), r.out.slice(0, 200));
  check('  报告白名单数量', /白名单：\d+ 项/.test(r.out), r.out.slice(0, 250));
}

/* ── 2. 漏报：真死组件必须被抓到 ─────────────────────────────── */
{
  writeFileSync(
    PROBE,
    '/* 探针：真正没人用的组件 */\nexport function TotallyDeadProbe() {\n  return <div>x</div>;\n}\n',
    'utf8',
  );
  const r = run();
  check('死组件被抓到（退出 1）', r.code === 1, 'exit=' + r.code);
  check('  报出组件名', r.out.includes('TotallyDeadProbe'), r.out.slice(0, 300));
  check('  报出文件与行号', /__dead_probe\.tsx:\d+/.test(r.out), r.out.slice(0, 300));
  check('  给出三种处理建议', r.out.includes('可能的原因') && r.out.includes('白名单'));
  cleanup();
}

/* ── 3. 误报：内部使用的组件不该报 ───────────────────────────── */
{
  writeFileSync(
    PROBE,
    '/* 探针：内部辅助组件 */\nfunction InnerProbe() {\n  return <span>used</span>;\n}\n\nexport function OuterProbe() {\n  return <div><InnerProbe /></div>;\n}\n',
    'utf8',
  );
  const r = run();
  check('非 export 的内部组件不在扫描范围', !r.out.includes('InnerProbe'), r.out.slice(0, 300));
  cleanup();
}

/* ── 4. 误报：被别的文件引用的不该报 ─────────────────────────── */
{
  writeFileSync(
    PROBE,
    '/* 探针：会被测试引用 */\nexport function ReferencedProbe() {\n  return <div>x</div>;\n}\n',
    'utf8',
  );
  writeFileSync(
    TEST_PROBE,
    "import { ReferencedProbe } from './__dead_probe';\nexport const _use = ReferencedProbe;\n",
    'utf8',
  );
  try {
    const r = run();
    check('被其他文件引用的组件不误报', !r.out.includes('ReferencedProbe'), r.out.slice(0, 300));
    check('  此时门禁为绿', r.code === 0, 'exit=' + r.code);
  } finally {
    cleanup();
  }
}

/* ── 5. 误报：常量不该被当作组件 ─────────────────────────────── */
{
  writeFileSync(
    PROBE,
    '/* 探针：常量 + 组件 */\nexport const SOME_CONSTANT = { a: 1 };\nexport function ContainerProbe() {\n  return <div>{SOME_CONSTANT.a}</div>;\n}\n',
    'utf8',
  );
  const r = run();
  check('SCREAMING_CASE 常量不误报', !r.out.includes('SOME_CONSTANT'), r.out.slice(0, 300));
  cleanup();
}

/* ── 6. 白名单里的示例组件不误报 ─────────────────────────────── */
{
  const r = run();
  check('白名单里的 SurfaceWorkbenchExample 不误报',
    !r.out.includes('SurfaceWorkbenchExample'), r.out.slice(0, 300));
}

/* ── 7. --report-only 必须压过红，但仍列出问题 ───────────────── */
{
  writeFileSync(
    PROBE,
    'export function ReportOnlyProbe() {\n  return <div>x</div>;\n}\n',
    'utf8',
  );
  try {
    const r = run(['--report-only']);
    check('--report-only 下退出 0', r.code === 0, 'exit=' + r.code);
    /*
     * 这条曾经因为用 execFileSync 而假红 —— 问题列表走 stderr，
     * execFileSync 成功时不返回 stderr。详见文件头注释。
     */
    check('  但仍列出问题（问题列表走 stderr）',
      r.out.includes('ReportOnlyProbe'), r.out.slice(0, 400));
    check('  说明是 report-only 模式', r.out.includes('--report-only'), r.out.slice(-300));
  } finally {
    cleanup();
  }
}

/* ── 8. 清理后必须回到绿 ─────────────────────────────────────── */
{
  cleanup();
  const r = run();
  check('清理后回到绿', r.code === 0, 'exit=' + r.code);
  let exists = true;
  try {
    readFileSync(PROBE, 'utf8');
  } catch {
    exists = false;
  }
  check('探针文件已删除', !exists);
}

console.log('');
if (failures > 0) {
  console.error('✗ ' + failures + ' / ' + checks + ' 项自测失败');
  process.exit(1);
}
console.log('✓ ' + checks + ' 项自测全部通过（漏报与误报都验过）');
