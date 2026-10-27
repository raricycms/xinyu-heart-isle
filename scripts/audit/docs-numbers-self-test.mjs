/**
 * docs-numbers.mjs 的自测。
 *
 * 核心担心的不是「数错了」，而是「数的方式太脆」—— 比如正则匹配不到
 * 就返回 0，然后被当成"代码里没有"，报出一个莫名其妙的数字。
 *
 * 所以这里不造假的仓库（那要复制整个 src，太慢），而是**实测真仓库 +
 * 两个定向变异**：
 *
 *   M1 删掉一个沙具 → 文档说 327，代码 326 → 必须红
 *   M2 加一种事件 → 文档说 19，代码 20 → 必须红
 *
 * 每个变异都写临时文件再恢复，全程 try/finally 保证不留痕。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const script = 'scripts/audit/docs-numbers.mjs';
let failures = 0;
let checks = 0;

function runAudit() {
  try {
    const out = execFileSync(process.execPath, [script], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? '') + (error.stderr ?? '') };
  }
}

function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log('  ✓ ' + name);
  else {
    failures += 1;
    console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  }
}

/* ── 用例 1：当前仓库应当通过 ────────────────────────────────── */
{
  const r = runAudit();
  check('当前仓库一致时退出 0', r.code === 0, 'code=' + r.code + ' ' + r.out.slice(-200));

  /*
   * 这里曾经写死「全部 5 项」。后来给 docs-numbers 加了第 6 项检查
   * （i18n 键数），这条自测就红了 —— 而它红得毫无意义：
   * 产品代码和文档都没问题，只是审计多加了一项。
   *
   * 教训：**自测也不该把"项数"写死**。它要断言的是"审计报出了
   * 全部检查且没有不一致"，不是"恰好 5 项"。
   *
   * 现在断言两件事：
   *   1. 输出里说"全部 N 项…一致"，N 是任意正整数
   *   2. 每一项都以 ✓ 开头（不能有 ✗ 混在里面）
   */
  check('输出「全部 N 项…一致」', /全部 \d+ 项文档数字与代码一致/.test(r.out), r.out.slice(-150));
  check('  没有任何 ✗ 行', !/^\s*✗/m.test(r.out), r.out.slice(-200));
}

/* ── 用例 2：删一个沙具 → 必须红 ─────────────────────────────── */
{
  const p = 'src/sandbox/symbols.ts';
  const original = readFileSync(p, 'utf8');
  try {
    /* 删掉第一条沙具定义所在行 */
    const lines = original.split('\n');
    const idx = lines.findIndex((l) => /^\s*s\(\s*'/.test(l));
    if (idx === -1) throw new Error('找不到沙具定义行');
    lines.splice(idx, 1);
    writeFileSync(p, lines.join('\n'), 'utf8');

    const r = runAudit();
    check('删一个沙具后退出 1', r.code === 1, 'code=' + r.code);
    check('报出「沙具数量」不一致', /沙具数量/.test(r.out), r.out.slice(-200));
    check('显示出 326', /326/.test(r.out), r.out.slice(-200));
  } finally {
    writeFileSync(p, original, 'utf8');
  }
}

/* ── 用例 3：加一种事件 → 必须红 ─────────────────────────────── */
{
  const p = 'src/sandbox/events.ts';
  const original = readFileSync(p, 'utf8');
  try {
    const mutated = original.replace(
      "| { kind: 'reflection.edit'; text: string };",
      "| { kind: 'reflection.edit'; text: string }\n  | { kind: 'test.fake'; x: number };",
    );
    if (mutated === original) throw new Error('找不到 reflection.edit 行');
    writeFileSync(p, mutated, 'utf8');

    const r = runAudit();
    check('加一种事件后退出 1', r.code === 1, 'code=' + r.code);
    check('报出「事件种类」不一致', /事件种类/.test(r.out), r.out.slice(-200));
    check('显示出 20', /代码  20/.test(r.out), r.out.slice(-200));
  } finally {
    writeFileSync(p, original, 'utf8');
  }
}

/* ── 用例 4：文档引用了不存在的文件 → 必须红 ──────────────────── */
/*
 * 这一类错误和"数字不对"是同一族幽灵：文档层的事实错误。
 * 但它的检测规则更宽（递归找文件名、后缀统称也算），
 * 宽规则最容易的失败方式是**变成恒真** —— 什么都能匹配上。
 * 所以必须实测三种变体。
 */
{
  const p = 'GOOD_FIRST_ISSUES.md';
  const original = readFileSync(p, 'utf8');
  try {
    /* 4a 引用不存在的文件 */
    writeFileSync(p, original + '\n见 `scripts/no-such-file-abc123.mjs`。\n', 'utf8');
    let r = runAudit();
    check('引用不存在的文件时退出 1', r.code === 1, 'code=' + r.code);
    check('报出缺失的文件名', r.out.includes('no-such-file-abc123'), r.out.slice(-200));

    /* 4b 文件名拼错（真实文件名的近似写法，最容易漏判） */
    writeFileSync(p, original + '\n见 `storage.tsx`（真名 storage.ts）。\n', 'utf8');
    r = runAudit();
    check('文件名拼错时退出 1', r.code === 1, 'code=' + r.code);
    check('报出拼错的名字', r.out.includes('storage.tsx'), r.out.slice(-200));

    /* 4c 引用不存在的 npm 脚本 */
    writeFileSync(p, original + '\n跑 `npm run no:such:script:abc123`。\n', 'utf8');
    r = runAudit();
    check('引用不存在的 npm 脚本时退出 1', r.code === 1, 'code=' + r.code);
    check('报出缺失的脚本名', r.out.includes('no:such:script:abc123'), r.out.slice(-200));
  } finally {
    writeFileSync(p, original, 'utf8');
  }
}

/* ── 用例 6：文档里的「自测项数」漂了必须被抓 ────────────────── */
/*
 * 第三种「文档数字」幽灵：不是常量，而是**另一个脚本的输出**。
 *
 * 文档写「52 项自测」，自测后来加了几条，文档没人改。
 * 它不在 CLAIMS 里，因为要拿到真实项数得把那个自测跑一遍（几十秒），
 * 而 `audit:docs` 是秒级门禁。
 *
 * 所以判据是静态近似：数 check() 调用数，文档数字不得明显小于它。
 */
{
  const VISION = 'docs/VISION.md';
  const originalVision = readFileSync(VISION, 'utf8');

  check('VISION 里确实写了自测项数（否则这条检查是空的）',
    /validate-pack-self-test\.mjs`\s*\d+\s*项/.test(originalVision));

  /* 把 52 改成 10，制造明显漂移 */
  const mutated = originalVision.replace(
    /(validate-pack-self-test\.mjs`\s*)\d+(\s*项)/,
    '$110$2',
  );
  check('变异点已定位', mutated !== originalVision);

  try {
    writeFileSync(VISION, mutated, 'utf8');
    const r = runAudit();
    check('漂移后审计退出 1', r.code === 1, 'code=' + r.code);
    check('  报出文档写的数字', r.out.includes('「10 项」'), r.out.slice(-300));
    check('  报出实际的 check() 数', /个 check\(\) 调用/.test(r.out), r.out.slice(-300));
  } finally {
    writeFileSync(VISION, originalVision, 'utf8');
  }

  check('还原后 VISION 内容完全一致', readFileSync(VISION, 'utf8') === originalVision);
}

/* ── 用例 7：恢复后必须重新变绿 ──────────────────────────────── */
{
  const r = runAudit();
  check('变异全部还原后重新通过', r.code === 0, 'code=' + r.code + ' ' + r.out.slice(-150));
  check('GOOD_FIRST_ISSUES.md 无注入标记残留',
    !readFileSync('GOOD_FIRST_ISSUES.md', 'utf8').includes('<!-- 变异 -->'));
}

console.log('');
if (failures > 0) {
  console.error('✗ ' + failures + ' / ' + checks + ' 项自测失败');
  process.exit(1);
}
console.log('✓ ' + checks + ' 项自测全部通过');
