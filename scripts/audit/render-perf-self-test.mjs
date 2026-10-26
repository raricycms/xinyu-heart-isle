/**
 * 变异验证：渲染性能门禁真的会红吗？
 *
 * 性能断言的失效方式比功能断言更隐蔽：写成恒真也照样打印
 * 「✓ ≤ 8ms」，因为空画布当然快。所以必须注入缺陷。
 *
 *   R1 让「100 个摆件真的在场」失败 —— 种子只放 10 个摆件，
 *      页面自报 10 件，必须报「真的在场」不符。
 *   R2 让「单帧绘制 ≤ 8ms」失败 —— 每画一个摆件插入一段重活
 *      （阴影模糊 + 大量路径），使绘制耗时远超预算。
 *
 * 注入方式沿用统一纪律：把 `dist` 复制到 `tmp/`，在副本上注入，
 * 工作区 `dist/` 全程只读。
 *
 * 用法：node scripts/audit/render-perf-self-test.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'dist');
const MUT = join(ROOT, 'tmp', 'mut-dist-renderperf');
const INDEX = join(MUT, 'index.html');

rmSync(MUT, { recursive: true, force: true });
mkdirSync(MUT, { recursive: true });
cpSync(SRC, MUT, { recursive: true });
const pristine = readFileSync(INDEX, 'utf8');

/**
 * R1：把「在场摆件数」改小。
 *
 * 直接改 DOM 文本最简单：把侧栏「N 件在场」改成 10。
 * 门禁读的就是这段文本，所以这是一个**真实的失效模式** ——
 * 如果哪天种子注入坏了、页面只放了 10 个摆件，断言必须能发现。
 *
 * ⚠️ 必须**轮询**而不是「load 后延时改一次」。
 * 第一版写成 `setTimeout(..., 1500)`，而门禁在 `waitForSelector` 之后
 * 等 1200ms 就读文本 —— 变异发生在读取之后，于是稳定地「抓不到」。
 * 变异脚本自己的时序错误，和被测代码的缺陷长得一模一样：
 * 都是「断言没红」。所以这里持续改写，保证读取时一定是变异后的值。
 *
 * ⚠️ 还必须**按元素改**，不能按文本节点改。
 * 第二版按文本节点匹配 `/\d+\s*件在场/`，仍然抓不到 —— 实测那段 DOM 是
 *   `<span>100</span><span> 件在场</span>`
 * 数字和「件在场」**在两个不同的文本节点里**，任何单节点上的正则都永远
 * 匹配不到。改成「找叶子元素、看它的 textContent、改它的 textContent」。
 */
const R1_FEWER = `<script>
(function () {
  var rewrite = function () {
    var nodes = document.body.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      // 只看叶子元素：有子元素的跳过，避免把整页文字一次改坏
      if (el.childElementCount !== 0) continue;
      if (/\\d+\\s*件在场/.test(el.textContent)) {
        el.textContent = el.textContent.replace(/(\\d+)(\\s*件在场)/, '10$2');
      }
    }
  };
  setInterval(rewrite, 80);
  window.addEventListener('load', rewrite);
})();
</script>`;

/**
 * R2：拖慢绘制。
 *
 * 在 canvas 的 2d context 上包一层 `fill`，每次调用额外做一堆路径运算 ——
 * 模拟「有人给每个摆件加了昂贵的阴影/模糊/渐变」。不动被测源码，
 * 只让绘制真的变慢，检验预算断言是否还会绿。
 */
const R2_SLOW = `<script>
(function () {
  var originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    var ctx = originalGetContext.call(this, type, ...rest);
    if (type !== '2d' || !ctx || ctx.__slowed) return ctx;
    ctx.__slowed = true;
    var originalFill = ctx.fill.bind(ctx);
    ctx.fill = function (...args) {
      // 每次填充前做 400 次路径运算（模拟昂贵的阴影/模糊）
      for (var i = 0; i < 400; i += 1) {
        ctx.beginPath();
        for (var k = 0; k < 8; k += 1) {
          ctx.moveTo((i % 50) + k, (k % 40) + i);
          ctx.lineTo((i % 30) + k * 2, k + i);
        }
      }
      return originalFill(...args);
    };
    return ctx;
  };
})();
</script>`;

const MUTATIONS = [
  { name: 'R1 摆件数不符（种子只放 10 个）', inject: R1_FEWER, expectText: '真的在场' },
  { name: 'R2 绘制被拖慢（模拟昂贵阴影）', inject: R2_SLOW, expectText: '单帧绘制' },
];

function run() {
  try {
    const out = execFileSync(process.execPath, ['scripts/render-perf.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600_000,
      env: { ...process.env, XINYU_RENDER_PERF_DIST: MUT },
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? -1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

let failures = 0;

const baseline = run();
console.log(`前置（未变异应通过）：exit=${baseline.code} ${baseline.code === 0 ? '✓' : '✗'}`);
if (baseline.code !== 0) {
  console.log(baseline.out.split('\n').slice(-14).join('\n'));
  failures += 1;
}

for (const mutation of MUTATIONS) {
  console.log(`\n变异：${mutation.name}`);
  const mutated = pristine.replace('</body>', `${mutation.inject}\n</body>`);
  if (mutated === pristine) {
    console.log('  ✗ 注入没生效（找不到 </body>？）');
    failures += 1;
    continue;
  }
  writeFileSync(INDEX, mutated, 'utf8');
  const result = run();
  // 命中 = 退出码 1 且失败明细里出现期望的断言名
  const caught = result.code === 1 && result.out.includes(mutation.expectText);
  console.log(`  命中「${mutation.expectText}」=${caught} exit=${result.code}（期望 1） ${caught ? '✓' : '✗'}`);
  if (!caught) {
    console.log(result.out.split('\n').slice(-14).join('\n'));
    failures += 1;
  }
  writeFileSync(INDEX, pristine, 'utf8');
}

const restored = run();
console.log(`\n收尾（副本复原应通过）：exit=${restored.code} ${restored.code === 0 ? '✓' : '✗'}`);
if (restored.code !== 0) failures += 1;

rmSync(MUT, { recursive: true, force: true });
console.log(`\n${failures === 0 ? '✓ 渲染性能断言全部有效' : `✗ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
