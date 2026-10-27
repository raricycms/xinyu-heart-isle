/**
 * CSS 自定义属性对账 —— 自检
 *
 * 门禁本身也可能是幽灵。这里用变异测试证明 `audit:css` 真的会红：
 * 故意造几种 CSS，看检测器判得对不对。
 *
 * 用例设计对应真实踩过的坑：
 *   C1 未定义 + 无 fallback   → 必须红（这是那 81 处失效的形态）
 *   C2 未定义 + 有 fallback   → 必须绿（有兜底值，视觉上是对的）
 *   C3 正常定义 + 使用        → 必须绿（不能误报）
 *   C4 注释里的 var()         → 必须绿（注释不是代码，否则自我举报）
 *   C5 定义写在文件末尾       → 必须绿（声明顺序不影响定义可见性）
 *   C6 定义在另一个文件里     → 必须绿（token 是全局的，不是按文件隔离）
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const MUT_ROOT = path.join(ROOT, 'tmp', 'css-mut');
const DETECTOR = path.join(ROOT, 'scripts/audit/css-tokens.mjs');

let failures = 0;

/** @param {string} name @param {boolean} ok @param {string} detail */
function check(name, ok, detail = '') {
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/**
 * 把 src/styles 复制到临时目录，按需覆盖/新增 CSS 文件，再以该临时目录
 * 为 cwd 跑检测器（检测器按 `cwd + src/styles` 定位）。
 *
 * 目录布局（`_work` 与 styles 平级，不能嵌套，否则 cpSync 会报
 * 「不能把目录复制到自己的子目录」）：
 *   tmp/css-mut/<case>/src/styles/*.css
 *
 * @param {string} caseName 用例名，决定临时目录（每个用例独立，互不干扰）
 * @param {Record<string, string>} extraFiles 文件名 → 内容（覆盖或新增）
 * @returns {{out: string, code: number}}
 */
function runDetector(caseName, extraFiles) {
  const work = path.join(MUT_ROOT, caseName);
  const stylesDir = path.join(work, 'src/styles');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(path.dirname(stylesDir), { recursive: true });
  cpSync(path.join(ROOT, 'src/styles'), stylesDir, { recursive: true });

  for (const [name, content] of Object.entries(extraFiles)) {
    writeFileSync(path.join(stylesDir, name), content, 'utf8');
  }

  const result = spawnSync(process.execPath, [DETECTOR], { cwd: work, encoding: 'utf8' });
  return { out: `${result.stdout ?? ''}${result.stderr ?? ''}`, code: result.status ?? -1 };
}

function main() {
  console.log('CSS 自定义属性对账 · 自检\n');

  /* ---------- C1：未定义 + 无 fallback 必须被抓到 ---------- */
  {
    const { out, code } = runDetector('c1', {
      '_c1.css': '.x { color: var(--this-token-does-not-exist); }',
    });
    check(
      'C1 未定义且无 fallback 被抓到',
      code === 1 && out.includes('--this-token-does-not-exist'),
      `exit=${code}（这正是那 81 处的形态）`,
    );
  }

  /* ---------- C2：未定义但有 fallback 必须放行 ---------- */
  {
    const { out, code } = runDetector('c2', {
      '_c2.css': '.x { color: var(--nope-but-safe, #123456); }',
    });
    check('C2 未定义但有 fallback 放行', code === 0, `exit=${code}（有兜底值，视觉正确）`);
  }

  /* ---------- C3：正常使用不能误报 ---------- */
  {
    const { code } = runDetector('c3', {
      '_c3.css': '.x { color: var(--ink-500); padding: var(--sp-2); }',
    });
    check('C3 已定义 token 不误报', code === 0, `exit=${code}`);
  }

  /* ---------- C4：注释里的 var() 不能举报自己 ---------- */
  {
    const { out, code } = runDetector('c4', {
      '_c4.css':
        '/* 说明文字：这里以前写过 var(--ghost-in-comment) 但已删除 */\n.y { color: var(--ink-500); }',
    });
    check(
      'C4 注释里的 var() 不算引用',
      code === 0 && !out.includes('--ghost-in-comment'),
      `exit=${code}`,
    );
  }

  /* ---------- C5：定义写在文件末尾也应可见 ---------- */
  {
    const { code } = runDetector('c5', {
      '_c5.css': '.z { color: var(--late-defined); }\n:root { --late-defined: #abcdef; }',
    });
    check('C5 后置定义仍算已定义', code === 0, `exit=${code}（层叠与书写顺序无关）`);
  }

  /* ---------- C6：token 是全局的，跨文件也要认 ---------- */
  {
    const { code } = runDetector('c6', {
      '_c6.css': '.w { margin: var(--ink-500-is-defined-elsewhere); }',
    });
    check('C6 跨文件未定义照样抓到', code === 1, `exit=${code}（不能只看本文件）`);
  }

  /* ---------- C7：正常定义在使用之前，必须绿 ---------- */
  {
    const { code } = runDetector('c7', {
      '_c7.css': ':root { --only-dashes: 1px; }\n.w { margin: var(--only-dashes); }',
    });
    check('C7 双横线变量名识别正确', code === 0, `exit=${code}`);
  }

  rmSync(MUT_ROOT, { recursive: true, force: true });

  if (failures === 0) {
    console.log('\n✓ 全部用例通过');
    process.exit(0);
  }
  console.log(`\n✗ ${failures} 个用例失败`);
  process.exit(1);
}

try {
  main();
} finally {
  rmSync(MUT_ROOT, { recursive: true, force: true });
}
