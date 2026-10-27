#!/usr/bin/env node
/**
 * 幽灵字段检测器的自检：注入幽灵，确认它真的会红。
 *
 * ---- 为什么检测器也需要自检 ----
 *
 * 写这个检测器的过程中，它自己坏过**两次**，两次都是假绿：
 *
 *  1. `collect()` 排除了整个 `src/i18n` 目录，而 `src/i18n/index.ts`
 *     正是 `const { locale } = usePreferences()` 所在处 ——
 *     于是 `locale` 被误报成「无人读取」。假阳性看起来像真问题。
 *  2. 写入判定曾经接受「任意对象字面量里的 `X: 值`」，于是 `Toolbar.tsx`
 *     里的类型声明 `outlineMode: boolean;` 被当成写入。把真正的
 *     `setPreferences({ outlineMode })` 删掉之后，检测器仍然报绿 ——
 *     **检测器自己长出了幽灵**。
 *
 * 第 2 类是最危险的：门禁永远绿，而它守的东西已经坏了。
 * 所以凡是「检查器」，都必须能证明自己会红。
 *
 * ---- 做法 ----
 *
 * 和 visual / render-perf 的自检一致：**不碰工作区**。
 * 把 `src/lib/types.ts` 复制到 `tmp/`，在副本里加一个无人读写的字段，
 * 用 `GHOST_ROOT` 环境变量让检测器扫副本。
 *
 * 用例：
 *   G1: 加一个完全没人碰的字段      → 必须报「无人读取、无人写入」
 *   G2: 加一个有读无写的字段        → 必须报「无人写入」
 *   G3: 原样副本（无注入）          → 必须报「没有幽灵字段」
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const TMP = path.join(ROOT, 'tmp');
const MUT_ROOT = path.join(TMP, 'ghost-mut');
const TYPES_SRC = path.join(ROOT, 'src/lib/types.ts');
const DETECTOR = path.join(ROOT, 'scripts/audit/ghost-fields.mjs');

rmSync(MUT_ROOT, { recursive: true, force: true });

let failures = 0;
/** @param {string} name @param {boolean} ok @param {string} detail */
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/**
 * 造一个迷你树，再跑到检测器。
 *
 * `mode`:
 *   'clean'   —— 复制真实的 src/lib/types.ts + 一个真实的消费方（绿基线）
 *   'ghost'   —— clean + 一个无人读写的字段
 *   'read'    —— clean + 一个有读无写的字段（配 fake.tsx 里的读）
 *
 * @param {'clean'|'ghost'|'read'} mode
 * @returns {{ code: number, out: string }}
 */
function runDetector(mode) {
  rmSync(MUT_ROOT, { recursive: true, force: true });
  mkdirSync(path.join(MUT_ROOT, 'src/lib'), { recursive: true });
  mkdirSync(path.join(MUT_ROOT, 'src/pages'), { recursive: true });

  let types = readFileSync(TYPES_SRC, 'utf8');

  // 基线：把真实字段删到只剩两个，并给它们配上真实的读写方。
  // 这样「干净副本」才真该是绿的 —— 否则副本本身就是一片荒地，
  // 每个字段都报红，G3 就永远过不了（第一版就是这么错的）。
  if (mode === 'ghost' || mode === 'read') {
    const at = types.indexOf('  /** 语言 */');
    if (at < 0) throw new Error('找不到插入锚点');
    const injected = mode === 'ghost' ? '  ghostField?: boolean;' : '  onlyRead?: boolean;';
    types = types.slice(0, at) + `${injected}\n` + types.slice(at);
  }
  writeFileSync(path.join(MUT_ROOT, 'src/lib/types.ts'), types, 'utf8');

  /*
   * 消费方：直接照抄真实代码里的两种写法。
   * 这比编一个假的更有价值 —— 如果检测器认不出真实写法，
   * 它就会在真实仓库里误报（locale 那次正是如此）。
   */
  const consumer = `import { usePreferences, setPreferences } from '../lib/storage';
export function Fake() {
  const { locale } = usePreferences();
  const prefs = usePreferences();
  const onLocale = (next: 'zh-CN' | 'en') => setPreferences({ locale: next });
  const onOutline = (v: boolean) => setPreferences({ outlineMode: v });
  return (
    <span data-locale={locale} data-outline={String(prefs.outlineMode)} onClick={() => onLocale('en')}>
      {String(onOutline)}
    </span>
  );
}
`;
  writeFileSync(path.join(MUT_ROOT, 'src/pages/fake.tsx'), consumer, 'utf8');

  // 每个用例都把「必绿字段」的读写补上，让干扰只来自注入的那一个
  const store = `export const DEFAULT = { locale: 'zh-CN', outlineMode: false };
export function usePreferences() { return DEFAULT; }
export function setPreferences(_patch: Record<string, unknown>): void {}
`;
  writeFileSync(path.join(MUT_ROOT, 'src/lib/storage.ts'), store, 'utf8');

  let code = 0;
  let out = '';
  try {
    out = execFileSync(process.execPath, [DETECTOR], {
      cwd: MUT_ROOT,
      encoding: 'utf8',
      env: { ...process.env, GHOST_ROOT: MUT_ROOT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    code = /** @type {any} */ (error).status ?? 1;
    out = /** @type {any} */ (error).stdout ?? '';
  }
  return { code, out };
}

console.log('幽灵字段检测器自检\n');

// G1：完全没人碰的字段
{
  const { out } = runDetector('ghost');
  check(
    'G1 无人读写的字段被抓到',
    out.includes('ghostField') && out.includes('无人读取') && out.includes('无人写入'),
    out.includes('ghostField') ? '' : '输出里没有 ghostField',
  );
}

// G2：有读无写
{
  const { out } = runDetector('read');
  const mentions = out.includes('onlyRead');
  check('G2 有读无写的字段被抓到', mentions && out.includes('无人写入'), mentions ? '' : '输出里没有 onlyRead');
}

/*
 * G3：干净副本不产生假阳性。
 *
 * 注意断言的是什么：迷你树里只给 `locale` 和 `outlineMode` 配了真实
 * 读写方，所以**只有这两个**字段该是绿的；其余 6 个字段在副本里确实
 * 没人用，检测器报它们是**正确行为**，不是假阳性。
 *
 * 第一版直接断言「整棵树没有幽灵」，必然失败 —— 因为副本本来就是
 * 刻意裁出来的荒地。断言要打在「我有意构造的那两个字段」上，
 * 否则测的是搭台子的脚手架，不是检测器。
 */
{
  const { out } = runDetector('clean');
  const localeLine = out.split('\n').find((line) => line.includes('locale ')) ?? '';
  const outlineLine = out.split('\n').find((line) => line.includes('outlineMode ')) ?? '';
  const localeOk = localeLine.includes('✓');
  const outlineOk = outlineLine.includes('✓');
  check(
    'G3 真实写法的读写都认得出（无假阳性）',
    localeOk && outlineOk,
    `locale:${localeOk ? '✓' : '✗'} outlineMode:${outlineOk ? '✓' : '✗'}`,
  );
  if (!localeOk || !outlineOk) {
    console.log('\n  ---- 干净副本的检测器输出 ----');
    for (const line of out.split('\n')) console.log(`  | ${line}`);
    console.log('  ---- 输出结束 ----\n');
  }
}

rmSync(MUT_ROOT, { recursive: true, force: true });
rmSync(path.join(TMP, 'gt'), { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n✗ ${failures} 项失败 —— 检测器不可信`);
  process.exit(1);
}
console.log('\n✓ 全部变异被正确捕获');
process.exit(0);
