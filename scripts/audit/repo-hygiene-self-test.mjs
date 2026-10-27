/**
 * repo-hygiene.mjs 的变异验证：
 * 重现当初那次真实的泄漏，看门禁能否抓到。
 */
import { writeFileSync, existsSync, unlinkSync, readFileSync, rmdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const PROBE = 'src/lib/__net-probe.ts';
const SELFTEST = 'scripts/audit/security-claims-self-test.mjs';
const selftestOrig = readFileSync(SELFTEST, 'utf8');

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log('  ✓ ' + name);
  else { failures += 1; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function runGate() {
  const r = spawnSync(process.execPath, ['scripts/audit/repo-hygiene.mjs'], { encoding: 'utf8' });
  return { code: r.status ?? 1, out: String(r.stdout ?? '') + String(r.stderr ?? '') };
}
function clean() {
  if (existsSync(PROBE)) unlinkSync(PROBE);
  writeFileSync(SELFTEST, selftestOrig, 'utf8');
}
process.on('exit', clean);

console.log('');
console.log('变异验证：仓库卫生门禁');
console.log('');

{
  const r = runGate();
  check('基线全绿', r.code === 0, 'exit=' + r.code);
}

/* 变异 1：重现当初那个泄漏 —— 一个 0 字节的 __net-probe.ts */
{
  writeFileSync(PROBE, '', 'utf8');
  check('已注入 0 字节探针文件（重现真实事故）', existsSync(PROBE));
  const r = runGate();
  check('  门禁变红', r.code !== 0, 'exit=' + r.code);
  check('  报出探针命名那条', /探针\/临时文件/.test(r.out), r.out.slice(-300));
  check('  报出 0 字节那条', /0 字节/.test(r.out), r.out.slice(-300));
  check('  指出具体文件', /__net-probe\.ts/.test(r.out), r.out.slice(-300));
  unlinkSync(PROBE);
}

/* 变异 2：带内容的探针文件（模拟 fetch 探针没清理） */
{
  writeFileSync(PROBE, 'export const send = () => fetch("https://evil.example");\n', 'utf8');
  const r = runGate();
  check('带内容的探针文件也会被抓', r.code !== 0, 'exit=' + r.code);
  unlinkSync(PROBE);
}

/* 变异 3：tmp- 命名的临时文件 */
{
  writeFileSync('src/lib/tmp-debug.ts', 'export const x = 1;\n', 'utf8');
  const r = runGate();
  check('tmp- 命名的文件被抓', r.code !== 0, 'exit=' + r.code);
  unlinkSync('src/lib/tmp-debug.ts');
}

/* 变异 3b：.mjs 探针 —— 第一版门禁漏掉的就是这个后缀 */
/*
 * ⚠️ 这条变异是补上一个**真实存在过的幽灵**。
 *
 * 门禁第一版的探针正则写的是 `\.[tj]sx?$`，只覆盖 .ts/.tsx/.js/.jsx，
 * **漏了 .mjs** —— 而本仓库脚本全是 .mjs。于是 `scripts/dev/` 里
 * 27 个 `probe-*.mjs` 一个都没被抓到，门禁报告"没有探针文件"。
 *
 * 断言形状是对的（"不该有探针文件"），覆盖范围漏了最该管的一类。
 * 这条变异保证以后不会退化回去。
 */
{
  writeFileSync('scripts/audit/__mjs-probe.mjs', 'export const y = 2;\n', 'utf8');
  const r = runGate();
  check('.mjs 后缀的探针文件也会被抓（第一版漏了这个后缀）', r.code !== 0, 'exit=' + r.code);
  unlinkSync('scripts/audit/__mjs-probe.mjs');
}

/* 变异 3c：scripts/dev/ 下的无主脚本 */
{
  writeFileSync('scripts/dev/probe-nobody-claims-this.mjs', 'export const z = 3;\n', 'utf8');
  const r = runGate();
  check('scripts/dev/ 下无人认领的脚本被抓', r.code !== 0, 'exit=' + r.code);
  check('  报出无主那条', /认领/.test(r.out), r.out.slice(-300));
  unlinkSync('scripts/dev/probe-nobody-claims-this.mjs');
}

/* 变异 4：把当初的 bug 放回 cleanup()，治本那条必须抓到 */
{
  /*
   * ⚠️ 第一次写这个变异时它没有变红，原因值得记下来：
   *
   * 我用的替换锚点是 `/function cleanup\(\) \{/`。而那个自测文件的
   * **注释块里**恰好也贴了这段旧代码（作为"这里是罪魁"的示例），
   * 于是 `String.replace` 替换的是注释里那一次 —— 变异体注入了注释，
   * 门禁跳过注释行，当然不红。
   *
   * 这是「变异自己失效」的第 N 种形态：**锚点匹配到了文档示例，
   * 而不是真实代码**。修法是用真实函数体里独有的下一行做锚点。
   */
  const buggy = selftestOrig.replace(
    'function cleanup() {\n  for (const p of [PROBE, PROBE_TEST]) {',
    "function cleanup() {\n  try { writeFileSync(PROBE, '', 'utf8'); } catch { /* 重现旧 bug */ }\n  for (const p of [PROBE, PROBE_TEST]) {",
  );
  check('变异点 4 已定位（把旧 bug 放回 cleanup 真实函数体）', buggy !== selftestOrig);
  if (buggy !== selftestOrig) {
    writeFileSync(SELFTEST, buggy, 'utf8');
    const r = runGate();
    check('  cleanup 里写探针文件会被抓', r.code !== 0, 'exit=' + r.code);
    check('  报出 cleanup 那条', /cleanup/.test(r.out), r.out.slice(-300));
    writeFileSync(SELFTEST, selftestOrig, 'utf8');
  }
}

/* 反向断言：正常的变异写入不应被误报 */
{
  const r = runGate();
  check('正常状态下不误报（变异体写探针是合法的）', r.code === 0, 'exit=' + r.code + ' ' + r.out.slice(-250));
}

{
  clean();
  const r = runGate();
  check('恢复后全绿', r.code === 0, 'exit=' + r.code);
  check('自测脚本逐字节还原', readFileSync(SELFTEST, 'utf8') === selftestOrig);
  check('无探针残留', !existsSync(PROBE));
}

console.log('');
if (failures > 0) { console.error('✗ ' + failures + ' / ' + checks + ' 项失败'); process.exit(1); }
console.log('✓ ' + checks + ' 项：残留会红，治本条款也有效，正常变异不误报');
