/**
 * 沙具包校验器自测（`npm run validate:pack:self-test`）。
 *
 * ── 为什么需要这个自测 ──────────────────────────────────────────
 *
 * 校验器最容易的失败方式不是"判错"，而是**永远说通过**：
 * 比如 `validatePack()` 永远返回 `ok: true`，或者 CLI 拿错了文件、
 * 或者在 JSON.parse 之后就没再看内容。这时：
 *
 *   - 好的示例包 → ✓（符合预期）
 *   - 坏的示例包 → ✗ 应该红，但如果是"永远通过"，它也会绿
 *
 * 所以必须**双向验证**：好包过、坏包红，且崩的条数对得上。
 *
 * ── 顺带守住的一条 ─────────────────────────────────────────────
 *
 * `docs/SYMBOL_PACK.md` 是外部开发者唯一的依据。文档里写的上限
 * （2000 条 / 200KB / 1.5MB / 40 字…）如果和代码不一致，
 * 开发者会做出"按文档合法、但校验不过"的包。
 * 所以这里也核对文档与代码的常量。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NODE_ARGS = [
  '--experimental-strip-types',
  '--no-warnings',
  '--import',
  './scripts/alias-loader.mjs',
  'scripts/validate-pack.ts',
];

/*
 * 夹具放临时目录，**不写进仓库**。
 *
 * 第一版把夹具写死在 `tmp/` 下并假定它们存在 —— 结果在干净 clone 上
 * 第一次跑就失败（`tmp/` 是 gitignored 的）。现在自己创建。
 */
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'xinyu-pack-'));
const emptyPack = join(FIXTURE_DIR, 'empty.symbolpack.json');
const notJson = join(FIXTURE_DIR, 'notjson.symbolpack.json');
writeFileSync(emptyPack, '   \n\n  ', 'utf8');
writeFileSync(notJson, '这不是 JSON，只是一段话。', 'utf8');

process.on('exit', () => {
  try {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结论 */
  }
});

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

/** 跑校验器，返回 { code, out } */
function runValidator(args) {
  try {
    const out = execFileSync(process.execPath, [...NODE_ARGS, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, out };
  } catch (error) {
    const stdout = error.stdout ?? '';
    const stderr = error.stderr ?? '';
    return {
      code: error.status ?? 1,
      out: String(stdout) + String(stderr),
    };
  }
}

/* ── 1. 好包必须通过 ───────────────────────────────────────────── */
{
  const r = runValidator(['samples/example.symbolpack.json']);
  check('示例包通过校验（退出 0）', r.code === 0, 'code=' + r.code + ' ' + r.out.slice(-200));
  check('示例包输出包名', r.out.includes('示例'), r.out.slice(-150));
  check('示例包输出沙具条数', /沙具 3 条/.test(r.out), r.out.slice(-150));
}

/* ── 1b. 内嵌图片的包也必须通过 ─────────────────────────────── */
/*
 * `image` 字段是新手最容易写错的地方（base64 抄错、前缀写错、
 * 用 http 链接）。示例包必须真的能过，否则文档教的是错的。
 */
{
  const r = runValidator(['samples/example-image.symbolpack.json']);
  check('内嵌图片示例通过（退出 0）', r.code === 0, 'code=' + r.code + ' ' + r.out.slice(-250));
  check('  正确统计出 2 条用图片', /其中 2 条用内嵌图片/.test(r.out), r.out.slice(-250));

  const json = runValidator(['samples/example-image.symbolpack.json', '--json']);
  let parsed = null;
  try {
    parsed = JSON.parse(json.out);
  } catch {
    /* 下面判定 */
  }
  check('  --json 报告 imageCount = 2', parsed?.files?.[0]?.summary?.imageCount === 2,
    'imageCount=' + parsed?.files?.[0]?.summary?.imageCount);
  check('  --json 报告 symbolCount = 3', parsed?.files?.[0]?.summary?.symbolCount === 3);
}

/* ── 2. 坏包必须红，且条数对得上 ─────────────────────────────── */
{
  const r = runValidator(['samples/broken.symbolpack.json']);
  check('坏样例不通过（退出 1）', r.code === 1, 'code=' + r.code);

  /*
   * 坏样例里埋了 12 类错误。不要求逐条精确匹配文案
   * （文案会随措辞调整），但要求**数量级对得上** ——
   * 如果只报 1 条就说明校验器提前退出了。
   */
  const issueLines = r.out.split('\n').filter((l) => /^\s{4}\S/.test(l));
  check('坏样例报出 ≥ 10 条问题', issueLines.length >= 10, '实报 ' + issueLines.length + ' 条');

  /* 抽几条关键错误，确认没有被漏掉 */
  const mustCatch = [
    ['format 字面量错误', /format 必须/],
    ['缺少包名', /缺少包名称/],
    ['license 非法', /license 必须/],
    ['缺命名空间', /不合法：必须形如/],
    ['与内置重名', /与内置沙具重名/],
    ['未知子类', /不是已知子类/],
    ['大类与子类不一致', /与子类.*不一致/],
    ['缺 glyph 和 image', /需要 glyph 或 image/],
    ['网络图片地址', /不支持网络地址/],
    ['glyph 过长', /glyph 太长/],
    ['缺 label', /缺少 label/],
    ['tags 含非字符串', /非字符串项/],
  ];
  for (const [label, re] of mustCatch) {
    check('抓到：' + label, re.test(r.out), r.out.slice(0, 120));
  }
}

/* ── 3. 不存在的文件 → 退出 2 ─────────────────────────────────── */
{
  const r = runValidator([join(FIXTURE_DIR, 'definitely-not-here.symbolpack.json')]);
  check('文件不存在时退出 2', r.code === 2, 'code=' + r.code);
  check('提示文件不存在', /不存在/.test(r.out), r.out.slice(0, 150));
}

/* ── 4. 空文件 → 退出 1（不是 0！）──────────────────────────── */
{
  const r = runValidator([emptyPack]);
  check('空文件退出 1', r.code === 1, 'code=' + r.code);
  check('提示文件是空的', /文件是空的/.test(r.out), r.out.slice(0, 150));
}

/* ── 5. 非 JSON → 退出 1 ──────────────────────────────────────── */
{
  const r = runValidator([notJson]);
  check('非 JSON 退出 1', r.code === 1, 'code=' + r.code);
  check('提示不是有效 JSON', /不是有效的 JSON/.test(r.out), r.out.slice(0, 150));
}

/* ── 6. 无参数 → 退出 1 且给用法 ─────────────────────────────── */
{
  const r = runValidator([]);
  check('无参数退出 1', r.code === 1, 'code=' + r.code);
  check('无参数时给出用法', /用法/.test(r.out), r.out.slice(0, 150));
}

/* ── 7. --help → 退出 0 ──────────────────────────────────────── */
{
  const r = runValidator(['--help']);
  check('--help 退出 0', r.code === 0, 'code=' + r.code);
  check('--help 提到退出码', /退出码/.test(r.out), r.out.slice(0, 200));
}

/* ── 8. --json 输出可解析 ────────────────────────────────────── */
{
  const r = runValidator(['samples/example.symbolpack.json', '--json']);
  let parsed = null;
  try {
    parsed = JSON.parse(r.out);
  } catch {
    /* 下面会判定 */
  }
  check('--json 输出是合法 JSON', parsed !== null, r.out.slice(0, 200));
  check('--json 带 validator 字段', parsed?.validator === 'xinyu-validate-pack');
  check('--json 带 ok=true', parsed?.ok === true);
  check('--json 报告内置沙具数 327', parsed?.builtinSymbolCount === 327);
  check('--json 含 summary', typeof parsed?.files?.[0]?.summary?.symbolCount === 'number');
}

/* ── 9. 多个文件一起校验 ─────────────────────────────────────── */
{
  const r = runValidator([
    'samples/example.symbolpack.json',
    'samples/broken.symbolpack.json',
  ]);
  check('多文件混合时退出 1（有一个坏的）', r.code === 1, 'code=' + r.code);
  check('多文件时给出合计', /合计 2 个文件/.test(r.out), r.out.slice(-150));
}

/* ── 10. 文档与代码的常量一致 ────────────────────────────────── */
{
  const doc = readFileSync('docs/SYMBOL_PACK.md', 'utf8');
  const packs = readFileSync('src/sandbox/library/packs.ts', 'utf8');

  const numOf = (re) => {
    const m = packs.match(re);
    return m ? Number(m[1].replaceAll('_', '')) : -1;
  };

  const pairs = [
    ['单包 2000 条', numOf(/MAX_PACK_SYMBOLS\s*=\s*([\d_]+)/) === 2000, '2000'],
    ['单图 200KB', numOf(/MAX_IMAGE_DATA_URI\s*=\s*([\d_]+)/) === 200_000, '200KB'],
    ['整包 1.5MB', numOf(/MAX_PACK_BYTES\s*=\s*([\d_]+)/) === 1_500_000, '1.5MB'],
    ['label 40 字', numOf(/MAX_LABEL\s*=\s*(\d+)/) === 40, '≤ 40 字'],
    ['tags 16 个', numOf(/MAX_TAGS\s*=\s*(\d+)/) === 16, '≤ 16 个'],
    ['tag 24 字', numOf(/MAX_TAG_LENGTH\s*=\s*(\d+)/) === 24, '≤ 24 字'],
    ['包名 80 字', numOf(/MAX_NAME\s*=\s*(\d+)/) === 80, '≤ 80 字'],
  ];
  for (const [label, codeMatches, docText] of pairs) {
    check('文档与代码一致：' + label, codeMatches && doc.includes(docText), '文档含「' + docText + '」=' + doc.includes(docText));
  }

  /* 24 个子类必须全在文档里，否则开发者不知道该填什么 */
  const subBlock = readFileSync('src/sandbox/symbols.ts', 'utf8').match(
    /subcategoryLabels[^{]*\{([\s\S]*?)\n\};/,
  );
  const subs = subBlock ? [...subBlock[1].matchAll(/'([a-z]+-[a-z]+)'\s*:/g)].map((m) => m[1]) : [];
  const missing = subs.filter((s) => !doc.includes('`' + s + '`'));
  check('24 个子类全在文档里', subs.length === 24 && missing.length === 0,
    '共 ' + subs.length + '，缺 ' + (missing.join(',') || '无'));

  /* 示例文件必须真的存在，文档里链接了它们 */
  check('文档引用的字形示例包存在', existsSync('samples/example.symbolpack.json'));
  check('文档引用的图片示例包存在', existsSync('samples/example-image.symbolpack.json'));
  check('文档引用的坏样例存在', existsSync('samples/broken.symbolpack.json'));

  /* 文档里提到的三个样例都要在文档里被引用，否则没人知道它们存在 */
  check('文档提到了图片示例包', doc.includes('example-image.symbolpack.json'));
  check('文档提到了字形示例包', doc.includes('example.symbolpack.json'));
  check('文档提到了坏样例', doc.includes('broken.symbolpack.json'));
}

console.log('');
if (failures > 0) {
  console.error('✗ ' + failures + ' / ' + checks + ' 项自测失败');
  process.exit(1);
}
console.log('✓ ' + checks + ' 项自测全部通过');
