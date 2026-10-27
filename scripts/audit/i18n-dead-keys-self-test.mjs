#!/usr/bin/env node
/**
 * i18n 死键检测器的自检：注入死键，确认它真的会红。
 *
 * ---- 为什么这个检测器尤其需要自检 ----
 *
 * 它的判定逻辑有**两条互相拉扯的路径**：
 *   1. 字面量命中（`'sandbox.tool.dig'`）；
 *   2. 动态前缀命中（`` t(`sandbox.scene.${id}`) ``）。
 *
 * 第 2 条一旦写松（比如把前缀比较写成 startsWith 而不管边界），
 * 整个 `sandbox.*` 命名空间都会被判成「在用」—— 检测器从此永远绿，
 * 而它本该守的东西（有没有人真的用这个键）已经失效。
 *
 * 第一版就踩过同类坑：`collect()` 排除了整个 src/i18n 目录，把
 * `const { locale } = usePreferences()` 也跳过了，导致 `locale` 被误报。
 *
 * ---- 用例 ----
 *
 *   I1: 字面量在用          → 必须判「在用」（不误报）
 *   I2: 动态前缀在用        → 必须判「在用」（不误报）
 *   I3: 完全没人用          → 必须判「死键」
 *   I4: 前缀相近但不同（sandbox.sceneX vs sandbox.scene.*）→ 必须判「死键」
 *       —— 这条专打前缀边界写松的情况
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const MUT_ROOT = path.join(ROOT, 'tmp', 'i18n-mut');
const DETECTOR = path.join(ROOT, 'scripts/audit/i18n-dead-keys.mjs');

let failures = 0;
/** @param {string} name @param {boolean} ok @param {string} detail */
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/**
 * 造一棵迷你树跑检测器。
 * @param {string} consumerSource 消费者源码
 * @returns {string} 检测器输出
 */
function runDetector(consumerSource) {
  rmSync(MUT_ROOT, { recursive: true, force: true });
  mkdirSync(path.join(MUT_ROOT, 'src/i18n'), { recursive: true });
  mkdirSync(path.join(MUT_ROOT, 'src/pages'), { recursive: true });

  writeFileSync(
    path.join(MUT_ROOT, 'src/i18n/zh-CN.ts'),
    `export const zhCN = {
  'sandbox.tool.dig': '挖',
  'sandbox.scene.beach': '沙滩',
  'sandbox.orphan': '没人用',
  'sandbox.sceneX.ghost': '前缀相近但是另一个命名空间',
};
`,
    'utf8',
  );
  writeFileSync(path.join(MUT_ROOT, 'src/pages/consumer.tsx'), consumerSource, 'utf8');

  return execFileSync(process.execPath, [DETECTOR], {
    cwd: MUT_ROOT,
    encoding: 'utf8',
    env: { ...process.env, I18N_ROOT: MUT_ROOT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

console.log('i18n 死键检测器自检\n');

// I1 + I2：字面量与动态前缀都必须判「在用」，死键必须被抓到
{
  const out = runDetector(
    `import { useI18n } from '../i18n';
export function C({ sceneId }: { sceneId: string }) {
  const { t } = useI18n();
  return <span>{t('sandbox.tool.dig')}{t(\`sandbox.scene.\${sceneId}\`)}</span>;
}
`,
  );
  const literalOk = !/^\s+✗ sandbox\.tool\.dig$/m.test(out);
  const dynamicOk = !/^\s+✗ sandbox\.scene\.beach$/m.test(out);
  const orphanCaught = /^\s+✗ sandbox\.orphan$/m.test(out);
  check('I1 字面量在用的键不误报', literalOk);
  check('I2 动态前缀在用的键不误报', dynamicOk);
  check('I3 无人用的键被抓到', orphanCaught);
}

// I4：前缀边界 —— sandbox.sceneX 不该被 sandbox.scene 的前缀覆盖
{
  const out = runDetector(
    `import { useI18n } from '../i18n';
export function C({ sceneId }: { sceneId: string }) {
  const { t } = useI18n();
  return <span>{t(\`sandbox.scene.\${sceneId}\`)}</span>;
}
`,
  );
  // sandbox.sceneX.ghost 的最后一段之前是 sandbox.sceneX，
  // 它不该匹配 sandbox.scene 前缀
  const boundaryOk = /^\s+✗ sandbox\.sceneX\.ghost$/m.test(out);
  check('I4 前缀相近但不同命名空间不被误判为在用', boundaryOk, boundaryOk ? '' : '被漏放了');
}

rmSync(MUT_ROOT, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n✗ ${failures} 项失败 —— 检测器不可信`);
  process.exit(1);
}
console.log('\n✓ 全部用例通过');
process.exit(0);
