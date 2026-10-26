/**
 * 变异验证：手机场景真的能抓到「移动端布局塌了」吗？
 *
 * 一个从没红过的断言不算门禁。这里注入两种真实的移动端故障：
 *   M1：塞一个 500px 宽的元素 → 必须报「横向滚动」
 *   M2：塞一个 8×8px 的按钮 → 必须报「触摸目标 < 44px」
 * 然后还原、确认回到绿。
 *
 * 与 `meta-self-test.mjs` 一样注在 dist 的**副本**上，不碰工作区。
 * 用**独立的副本目录**（`tmp/mut-dist-e2e`），避免和 a11y 的自检
 * 抢同一个 `tmp/mut-dist`（两者都会 rmSync 它，并行跑会互相删）。
 *
 * 这次变异直接抓到一个真 bug，值得记下来：
 * 第一版断言用 `documentElement.scrollWidth > window.innerWidth` 判横向溢出，
 * 但 `isMobile: true` 下 Chrome 用布局视口语义，`innerWidth` 会被溢出的内容
 * **撑大**（390 → 501），于是两边恒等，断言永远为真。
 * 一个自己会跟着被测对象变大的基准，等于没有基准。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'dist');
const MUT = join(ROOT, 'tmp', 'mut-dist-e2e');
const INDEX = join(MUT, 'index.html');

rmSync(MUT, { recursive: true, force: true });
mkdirSync(MUT, { recursive: true });
cpSync(SRC, MUT, { recursive: true });
const pristine = readFileSync(INDEX, 'utf8');

const MUTATIONS = [
  {
    name: 'M1 宽 500px 元素（横向滚动）',
    inject: `<div id="mut-wide" style="width:500px;height:20px;background:red"></div>`,
    expectFail: true,
    expectText: '无横向滚动',
  },
  {
    name: 'M2 8×8px 按钮（触摸目标过小）',
    inject: `<button id="mut-tiny" style="width:8px;height:8px;padding:0;border:0">x</button>`,
    expectFail: true,
    expectText: '触摸目标',
  },
];

function runE2E() {
  try {
    const out = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', 'scripts/e2e/smoke.ts', 'mobile-390'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 300_000,
        env: { ...process.env, XINYU_E2E_DIST: MUT },
      },
    );
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? -1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

let failures = 0;

const baseline = runE2E();
console.log(`前置（未变异应通过）：exit=${baseline.code} ${baseline.code === 0 ? '✓' : '✗'}`);
if (baseline.code !== 0) {
  console.log(baseline.out.split('\n').slice(-12).join('\n'));
  failures += 1;
}

for (const mutation of MUTATIONS) {
  console.log(`\n变异：${mutation.name}`);
  const mutated = pristine.replace('</body>', `${mutation.inject}\n</body>`);
  if (mutated === pristine) {
    console.log('  ✗ 注入没生效');
    failures += 1;
    continue;
  }
  writeFileSync(INDEX, mutated, 'utf8');
  const result = runE2E();
  const caught = result.out.includes(mutation.expectText);
  const ok = caught && result.code === 1;
  console.log(`  命中「${mutation.expectText}」=${caught} exit=${result.code}（期望 1） ${ok ? '✓' : '✗'}`);
  if (!ok) {
    console.log(result.out.split('\n').slice(-10).join('\n'));
    failures += 1;
  }
  writeFileSync(INDEX, pristine, 'utf8');
}

const restored = runE2E();
console.log(`\n收尾（副本复原应通过）：exit=${restored.code} ${restored.code === 0 ? '✓' : '✗'}`);
if (restored.code !== 0) failures += 1;

rmSync(MUT, { recursive: true, force: true });
console.log(`\n${failures === 0 ? '✓ 移动端断言全部有效' : `✗ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
