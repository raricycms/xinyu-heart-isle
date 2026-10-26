/**
 * 变异验证：键盘全流程场景真的能抓到「方向键失效」吗？
 *
 * 这条场景抓出过一个**真实且用户可见**的 bug：
 * `SandboxPage` 的 `onItemCommit` 只取 `id`，from/to 都用当前坐标，
 * 于是「移动」被提交成原地不动。拖动时 `onItemDrag` 会实时改坐标，
 * 把问题掩盖住了；但**键盘方向键微调没有中间态**，它唯一的落点就是
 * `onItemCommit` —— 按了没反应。
 *
 * 最要命的是：**tsc 完全放行**。少写参数在 TypeScript 里是合法的，
 * 所以这个 bug 能一路通过类型检查、构建、547 条单测。
 * 只有端到端真的按下方向键、再读坐标，才能发现。
 *
 * 变异方式：不改源码（那要重新 build，慢且会动工作区），
 * 而是在副本的 `index.html` 注一段捕获阶段监听，把方向键吞掉 ——
 * 等价于「键盘处理逻辑断了」，且只作用于目标元素，不影响其他路径。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'dist');
const MUT = join(ROOT, 'tmp', 'mut-dist-kb');
const INDEX = join(MUT, 'index.html');

rmSync(MUT, { recursive: true, force: true });
mkdirSync(MUT, { recursive: true });
cpSync(SRC, MUT, { recursive: true });
const pristine = readFileSync(INDEX, 'utf8');

/**
 * K1：让 dom2d 摆件上的方向键 keydown 被吞掉（等价于 handleKeyDown 失效）。
 * 只拦 `.dom2d__item` 上的事件，不影响沙具库网格的 roving tabindex。
 */
const K1 = `<script>
document.addEventListener('keydown', function (event) {
  var t = event.target;
  if (t && t.classList && t.classList.contains('dom2d__item')) {
    if (event.key.indexOf('Arrow') === 0) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }
}, true);
</script>`;

/** K2：让沙具库网格的方向键失效（roving tabindex 不移动）。 */
const K2 = `<script>
document.addEventListener('keydown', function (event) {
  var t = event.target;
  if (t && t.hasAttribute && t.hasAttribute('data-lib-item')) {
    if (event.key.indexOf('Arrow') === 0) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }
}, true);
</script>`;

const MUTATIONS = [
  { name: 'K1 摆件方向键失效', inject: K1, expectText: '方向键移动了摆件' },
  { name: 'K2 沙具库方向键失效', inject: K2, expectText: '方向键换了一个沙具' },
];

function runE2E() {
  try {
    const out = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', 'scripts/e2e/smoke.ts', 'keyboard-flow'],
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
  const mutated = pristine.replace('</head>', `${mutation.inject}\n</head>`);
  if (mutated === pristine) {
    console.log('  ✗ 注入没生效（找不到 </head>？）');
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
console.log(`\n${failures === 0 ? '✓ 键盘断言全部有效' : `✗ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
