/**
 * 变异验证：视觉回归门禁真的会红吗？
 *
 * 「两次渲染逐像素一致」这类断言天然容易写成恒真 ——
 * 如果两次读到的其实是同一张缓存图，它就永远是绿的。
 * 所以必须注入缺陷，确认它真的会红。
 *
 *   V1 每帧往 canvas 上撒随机噪点 → 必须报「两次渲染逐像素一致」
 *   V2 把摆件整个擦掉（只留底色）→ 必须报「三个场景画面互不相同」
 *
 * 注入方式：改 `dist` 副本的 `index.html`，在工作区之外的 `tmp/` 里做。
 * 工作区 `dist/` 全程只读 —— 这条纪律是被坑出来的：
 * 早期变异脚本直接改 `dist/index.html`，恢复时与并发 build 撞车，
 * 后续审计读到过期 bundle，假报了 7 个不存在的缺陷。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'dist');
const MUT = join(ROOT, 'tmp', 'mut-dist-visual');
const INDEX = join(MUT, 'index.html');

rmSync(MUT, { recursive: true, force: true });
mkdirSync(MUT, { recursive: true });
cpSync(SRC, MUT, { recursive: true });
const pristine = readFileSync(INDEX, 'utf8');

/**
 * 等页面画完之后再开始干扰，否则连「画面非空白」都会失败，
 * 变异就没命中我们要验证的那条断言。
 */
const V1_NOISE = `<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var canvas = document.querySelector('.iso2d__canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    // 每 100ms 撒一次噪点 —— 让「同一场景两次渲染」不再逐像素一致
    setInterval(function () {
      var w = canvas.width, h = canvas.height;
      var image = ctx.getImageData(0, 0, w, h);
      for (var i = 0; i < 400; i += 1) {
        var x = Math.floor(Math.random() * w);
        var y = Math.floor(Math.random() * h);
        var offset = (y * w + x) * 4;
        image.data[offset] = 255;
        image.data[offset + 1] = 0;
        image.data[offset + 2] = 0;
      }
      ctx.putImageData(image, 0, 0);
    }, 100);
  }, 1500);
});
</script>`;

/**
 * 把摆件擦掉：持续用底色覆盖整块 canvas。
 * 这会让三个场景看起来一模一样 → 「互不相同」应失败。
 */
const V2_ERASE = `<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var canvas = document.querySelector('.iso2d__canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    setInterval(function () {
      ctx.fillStyle = '#c8b7a0';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }, 60);
  }, 1500);
});
</script>`;

const MUTATIONS = [
  { name: 'V1 撒随机噪点（破坏确定性）', inject: V1_NOISE, expectText: '两次渲染逐像素一致' },
  { name: 'V2 擦掉画面（三场景变同图）', inject: V2_ERASE, expectText: '三个场景画面互不相同' },
];

function runVisual() {
  try {
    const out = execFileSync(process.execPath, ['scripts/visual-regression.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600_000,
      env: { ...process.env, XINYU_VISUAL_DIST: MUT },
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? -1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

let failures = 0;

const baseline = runVisual();
console.log(`前置（未变异应通过）：exit=${baseline.code} ${baseline.code === 0 ? '✓' : '✗'}`);
if (baseline.code !== 0) {
  console.log(baseline.out.split('\n').slice(-12).join('\n'));
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
  const result = runVisual();
  const caught = result.out.includes(mutation.expectText) && result.code === 1;
  console.log(`  命中「${mutation.expectText}」=${caught} exit=${result.code}（期望 1） ${caught ? '✓' : '✗'}`);
  if (!caught) {
    console.log(result.out.split('\n').slice(-12).join('\n'));
    failures += 1;
  }
  writeFileSync(INDEX, pristine, 'utf8');
}

const restored = runVisual();
console.log(`\n收尾（副本复原应通过）：exit=${restored.code} ${restored.code === 0 ? '✓' : '✗'}`);
if (restored.code !== 0) failures += 1;

rmSync(MUT, { recursive: true, force: true });
console.log(`\n${failures === 0 ? '✓ 视觉断言全部有效' : `✗ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
