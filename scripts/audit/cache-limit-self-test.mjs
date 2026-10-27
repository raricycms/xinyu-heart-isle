/**
 * `symbolSource-cache.test.ts` 的变异验证（`npm run audit:cache:self-test`）。
 *
 * ── 为什么需要 ──────────────────────────────────────────────────
 *
 * 6 个用例全绿，可能是实现对，也可能是断言写松了。
 * 逐个改坏 LRU 实现，确认对应断言变红。
 *
 * ── 中途抓到的一个假测试（值得记）──────────────────────────────
 *
 * 「不淘汰未完成的图」这条第一版是**假的**：先塞 63 张已完成的，
 * 再塞 2 张 pending，然后加 10 张。变异验证时把"跳过未完成"
 * 那行删掉，测试**照样绿**。
 *
 * 原因：pending 被放在 Map **末尾**，而淘汰从**开头**扫 ——
 * 凑够淘汰量时早就 break 了，那个 `continue` 分支一次都没执行。
 *
 * 断言的形状是对的，但**执行路径没到达**。这比断言写错更隐蔽：
 * 断言写错读起来就觉得不对，路径没到达看起来完全正常。
 *
 * 修法：把 pending 放在最前面（最早插入），淘汰从它们开始扫。
 *
 * ── 这就是变异验证的价值 ────────────────────────────────────────
 *
 * 不做变异验证，这条假测试会一直绿着，直到某天有人重构
 * cacheImage 才发现它什么也没守住。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SRC = 'src/sandbox/render/symbolSource.ts';
const TEST = 'src/sandbox/render/symbolSource-cache.test.ts';
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

console.log('变异验证：imageCache 上限');
console.log('');

/* ── 基线 ────────────────────────────────────────────────────── */
{
  const r = runTests();
  check('基线全绿', r.code === 0 && /6 passed/.test(r.out), 'exit=' + r.code);
}

/* ── 变异 1：去掉上限（回到无条件 set）─────────────────────── */
{
  const mutated = original.replace(
    '  imageCache.set(dataUrl, image);\n  if (imageCache.size <= IMAGE_CACHE_LIMIT) return;',
    '  imageCache.set(dataUrl, image);\n  return;',
  );
  check('变异点 1 已定位（去掉上限）', mutated !== original);
  if (mutated !== original) {
    writeFileSync(SRC, mutated, 'utf8');
    const r = runTests();
    check('  用例变红', r.code !== 0, 'exit=' + r.code);
    restore();
  }
}

/* ── 变异 2：LRU 退化成 FIFO（不刷新命中顺序）──────────────── */
{
  const mutated = original.replace(
    '    /* 命中即刷新"最近使用"顺序，否则 LRU 会退化成 FIFO */\n    touchImage(dataUrl, cached);',
    '    /* FIFO 变异：不刷新顺序 */',
  );
  check('变异点 2 已定位（LRU 退化成 FIFO）', mutated !== original);
  if (mutated !== original) {
    writeFileSync(SRC, mutated, 'utf8');
    const r = runTests();
    check('  「最近用过的不会被淘汰」变红', r.code !== 0, 'exit=' + r.code);
    check('  红的正是 LRU 那条', /LRU|最近用过|FIFO/.test(r.out), r.out.slice(-300));
    restore();
  }
}

/* ── 变异 3：淘汰时不跳过未完成的图 ────────────────────────── */
{
  const mutated = original.replace(
    '    /* 还在解码的留着（见上面注释） */\n    if (!(value.complete && value.naturalWidth > 0)) continue;',
    '    /* 变异：不跳过未完成的 */',
  );
  check('变异点 3 已定位（淘汰未完成的图）', mutated !== original);
  if (mutated !== original) {
    writeFileSync(SRC, mutated, 'utf8');
    const r = runTests();
    check('  「不淘汰未完成的图」变红', r.code !== 0, 'exit=' + r.code);
    restore();
  }
}

/* ── 变异 4：上限改成天文数字（等于没有上限）───────────────── */
{
  const mutated = original.replace(
    'const IMAGE_CACHE_LIMIT = 64;',
    'const IMAGE_CACHE_LIMIT = 100000;',
  );
  check('变异点 4 已定位（上限改成天文数字）', mutated !== original);
  if (mutated !== original) {
    writeFileSync(SRC, mutated, 'utf8');
    const r = runTests();
    check('  淘汰相关用例变红', r.code !== 0, 'exit=' + r.code);
    restore();
  }
}

/* ── 恢复 ────────────────────────────────────────────────────── */
{
  restore();
  const r = runTests();
  check('恢复后重新全绿', r.code === 0 && /6 passed/.test(r.out), 'exit=' + r.code);
  check('源文件逐字节还原', readFileSync(SRC, 'utf8') === original);
}

console.log('');
if (failures > 0) {
  console.error('✗ ' + failures + ' / ' + checks + ' 项失败');
  process.exit(1);
}
console.log('✓ ' + checks + ' 项：四个变异都真的会让用例变红');
