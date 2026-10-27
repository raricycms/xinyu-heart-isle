/**
 * `idb-fallback.test.ts` 的变异验证（`npm run test:idb-self-test`）。
 *
 * ── 这个脚本存在的原因 ──────────────────────────────────────────
 *
 * 13 个降级用例全绿，可能是：
 *   A. 降级逻辑真的对
 *   B. 断言写松了，改坏也照样绿
 *
 * 逐个改坏降级逻辑，确认对应断言变红 —— 这是本仓库的标准做法
 * （见 docs/TESTING.md §4.6 的"假测试"与 §4.7 的"幽灵门禁"）。
 *
 * ── 一个有价值的中途发现：等价变异 ──────────────────────────────
 *
 * 「去掉 `if (typeof indexedDB === 'undefined') return null`」
 * 这个变异**不会**让用例变红。原因：代码随后会执行
 * `indexedDB.open(...)`，在 node 里抛 ReferenceError，
 * 而紧接着的 try/catch 捕获它，照样 `done(null)` —— 行为等价。
 *
 * 这件事值得记，因为「变异没变红」有两种完全不同的含义：
 *
 *   A. 测试太松 → 要补断言
 *   B. 变异等价 → 改了等于没改
 *
 * 混为一谈的人会去给等价变异补无意义的断言，把测试写脏。
 * 本脚本明确把这条标成等价变异，并断言"它应该保持绿"——
 * 如果哪天它变红了，说明有人动了 try/catch 的覆盖范围，
 * 那反而是一条值得看的信号。
 *
 * ── 另一个教训：调用方式 ────────────────────────────────────────
 *
 * 第一版用 `spawnSync('npx.cmd', ['vitest', ...])`，在这个环境里
 * 拿不到任何输出，于是"基线全绿"那条直接红了 ——
 * 而产品代码和用例都没问题。
 *
 * **验证脚本的调用方式错了，不是被测对象错了。** 改用
 * `process.execPath` + 具体 `.mjs` 路径，最稳、不受 shell 解析影响。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SRC = 'src/lib/idb.ts';
const TEST = 'src/lib/idb-fallback.test.ts';
const original = readFileSync(SRC, 'utf8');

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

function runTests() {
  const r = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', TEST], {
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: String(r.stdout ?? '') + String(r.stderr ?? '') };
}

function restore() {
  writeFileSync(SRC, original, 'utf8');
}
process.on('exit', restore);

console.log('变异验证：idb 降级路径');
console.log('');

/* ── 基线 ────────────────────────────────────────────────────── */
{
  const r = runTests();
  check('基线全绿', r.code === 0 && /13 passed/.test(r.out), 'exit=' + r.code);
}

/* ── 变异 1：idbAvailable 恒返回 true ────────────────────────── */
{
  const mutated = original.replace(
    /export async function idbAvailable\(\): Promise<boolean> \{\n  const db = await openDb\(\);\n  return db !== null;\n\}/,
    'export async function idbAvailable(): Promise<boolean> {\n  return true;\n}',
  );
  check('变异点 1 已定位（idbAvailable 恒真）', mutated !== original);
  if (mutated !== original) {
    writeFileSync(SRC, mutated, 'utf8');
    const r = runTests();
    check('  用例变红', r.code !== 0, 'exit=' + r.code);
    restore();
  }
}

/* ── 变异 2：等价变异（预期保持绿，见文件头）─────────────────── */
{
  const mutated = original.replace(
    "if (typeof indexedDB === 'undefined') return Promise.resolve(null);",
    '',
  );
  check('变异点 2 已定位（去掉 indexedDB 存在性检查）', mutated !== original);
  if (mutated !== original) {
    writeFileSync(SRC, mutated, 'utf8');
    const r = runTests();
    check('  等价变异：行为不变、仍然全绿（符合预期）', r.code === 0, 'exit=' + r.code);
    restore();
  }
}

/* ── 变异 3：去掉 open 的 try/catch ─────────────────────────── */
{
  const mutated = original.replace(
    /    let request: IDBOpenDBRequest;\n    try \{\n      request = indexedDB\.open\(DB_NAME, DB_VERSION\);\n    \} catch \{\n      done\(null\);\n      return;\n    \}/,
    '    const request: IDBOpenDBRequest = indexedDB.open(DB_NAME, DB_VERSION);',
  );
  check('变异点 3 已定位（去掉 open 的 try/catch）', mutated !== original);
  if (mutated !== original) {
    writeFileSync(SRC, mutated, 'utf8');
    const r = runTests();
    check('  用例变红', r.code !== 0, 'exit=' + r.code);
    check('  报错含 SecurityError 或 failed', /SecurityError|failed/.test(r.out), r.out.slice(-300));
    restore();
  }
}

/* ── 变异 4：把 window.setTimeout 改回去（钉住这个真实修复）──── */
{
  const mutated = original.replace(
    'setTimeout(() => done(null), 3000);',
    'window.setTimeout(() => done(null), 3000);',
  );
  check('变异点 4 已定位（window.setTimeout 回归）', mutated !== original);
  if (mutated !== original) {
    writeFileSync(SRC, mutated, 'utf8');
    const r = runTests();
    check('  用例变红（node 下没有 window）', r.code !== 0, 'exit=' + r.code);
    check('  报错含 "window is not defined"', /window is not defined/.test(r.out), r.out.slice(-400));
    restore();
  }
}

/* ── 恢复 ────────────────────────────────────────────────────── */
{
  restore();
  const r = runTests();
  check('恢复后重新全绿', r.code === 0 && /13 passed/.test(r.out), 'exit=' + r.code);
  check('源文件逐字节还原', readFileSync(SRC, 'utf8') === original);
}

console.log('');
if (failures > 0) {
  console.error('✗ ' + failures + ' / ' + checks + ' 项失败');
  process.exit(1);
}
console.log('✓ ' + checks + ' 项：三个变异真的会红，一个被判明为等价变异');
