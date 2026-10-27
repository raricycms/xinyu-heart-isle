/**
 * 文档示例可运行性自测。
 *
 * ── 这类测试防的是什么 ──────────────────────────────────────────
 *
 * 「手把手」教程里的代码块,如果抄下来跑不通,读者不会认为是文档错了 ——
 * 会认为是自己做错了,然后放弃。
 *
 * 文档层幽灵（CONTRACT §9.7）的一个具体形态:
 * **文档里的示例从来没被运行过**。它看起来是对的,
 * 因为读代码和读文档时人会自动补全缺失的部分。
 *
 * 所以这里把文档里的代码块**真的抽出来跑一遍**。
 *
 * 顺带核对:文档里列出的「常见报错」表格,它的文案必须和
 * `packs.ts` 实际输出一致。文档说会报 A,代码报的是 B,
 * 读者照文档找 B 找不到。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const doc = readFileSync('docs/SYMBOL_PACK.md', 'utf8');
const packs = readFileSync('src/sandbox/library/packs.ts', 'utf8');

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

const dir = mkdtempSync(join(tmpdir(), 'xinyu-doc-example-'));
process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结论 */
  }
});

function runValidator(args) {
  try {
    const out = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--no-warnings',
        '--import',
        './scripts/alias-loader.mjs',
        'scripts/validate-pack.ts',
        ...args,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: String(error.stdout ?? '') + String(error.stderr ?? '') };
  }
}

console.log('沙具包文档 · 示例可运行性');
console.log('');

/* ── 1. 「手把手」一节必须存在且要素齐全 ─────────────────────── */
const start = doc.indexOf('## 1.5 手把手做第一个包');
const end = doc.indexOf('## 2. 文件长什么样');
const section = start !== -1 && end !== -1 ? doc.slice(start, end) : null;

check('有「手把手」一节', section !== null);
if (section) {
  check('  说明了要改哪几个地方', section.includes('只改两个地方'));
  check('  解释了 id 必须带点', section.includes('必须带一个点'));
  check('  提醒了 UTF-8 编码', section.includes('编码必须是 UTF-8'));
  check('  给了常见错误对照表', section.includes('新手最常撞的五个'));
  check('  说明了怎么校验', section.includes('npm run validate:pack'));
}

/* ── 2. 照抄示例必须真的能过 ─────────────────────────────────── */
{
  const jsonMatch = section?.match(/```json\n([\s\S]*?)```/);
  check('找到示例 JSON 代码块', jsonMatch !== null);

  if (jsonMatch) {
    const file = join(dir, 'first.symbolpack.json');
    writeFileSync(file, jsonMatch[1], 'utf8');
    const r = runValidator([file]);
    check('照抄的示例通过校验（退出 0）', r.code === 0, 'exit=' + r.code + ' ' + r.out.slice(-250));
    check('  输出包名', r.out.includes('我的第一个包'), r.out.slice(-200));
    check('  报出 1 条沙具', /沙具 1 条/.test(r.out), r.out.slice(-200));
  }
}

/* ── 3. 文档列出的每个「常见报错」都必须真的能触发 ───────────── */
{
  const cases = [
    [
      'format 写错',
      { format: 'symbol-pack/v0', name: 'x', license: 'CC0-1.0', symbols: [] },
      /format 必须/,
    ],
    ['缺 name', { format: 'symbol-pack/v1', license: 'CC0-1.0', symbols: [] }, /name/],
    [
      'license 写 unknown',
      { format: 'symbol-pack/v1', name: 'x', license: 'unknown', symbols: [] },
      /license 必须/,
    ],
    [
      'id 没有点',
      {
        format: 'symbol-pack/v1',
        name: 'x',
        license: 'CC0-1.0',
        symbols: [{ id: 'noDot', label: 'X', subcategory: 'abstract-symbol', glyph: '⭐' }],
      },
      /必须形如/,
    ],
  ];

  for (const [label, obj, pattern] of cases) {
    const file = join(dir, 'bad.symbolpack.json');
    writeFileSync(file, JSON.stringify(obj), 'utf8');
    const r = runValidator([file]);
    check('「' + label + '」真的会报', r.code === 1 && pattern.test(r.out),
      'exit=' + r.code + ' ' + r.out.slice(0, 150));
  }

  const file = join(dir, 'syntax.symbolpack.json');
  writeFileSync(file, '{ "format": "symbol-pack/v1", }', 'utf8');
  const r = runValidator([file]);
  check('「不是有效的 JSON」真的会报', r.code === 1 && /不是有效的 JSON/.test(r.out));
}

/* ── 4. 文档引用的报错文案必须与实现一致 ─────────────────────── */
{
  check('实现里有「必须形如」', packs.includes('必须形如'));
  check('实现里有「不是已知子类」', packs.includes('不是已知子类'));
  check('实现里有 SPDX 相关提示', /SPDX|CC0-1\.0/.test(packs));
  check('实现里有「不是有效的 JSON」之外的语法错误提示路径',
    /* 语法错误由 CLI 产生，不在 packs.ts 里；确认 CLI 有这条 */
    readFileSync('scripts/validate-pack.ts', 'utf8').includes('不是有效的 JSON'));
}

console.log('');
if (failures > 0) {
  console.error('✗ ' + failures + ' / ' + checks + ' 项失败');
  process.exit(1);
}
console.log('✓ ' + checks + ' 项：文档里的示例真的能跑');
