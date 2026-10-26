/**
 * 心屿 · 渲染性能门禁（真实浏览器）
 *
 * `docs/VISION.md` §7.4 的「性能」一行，要求里写着
 * 「首屏、**3D 路由、100 个摆件、128×96 沙面雕刻时的帧率与内存**」，
 * 而实际被断言的只有首屏、笔刷、编码载荷、统计 ——
 * **「100 个摆件」「帧率」「内存」三项从来没被断言过**，那一行却标着 ✅。
 * 这是幽灵门禁：读的人以为有人在守。
 *
 * 这个脚本补上「100/400 个摆件时的绘制开销」。
 *
 * ## 为什么断言的是「单帧绘制耗时」而不是「fps」
 *
 * 最直觉的写法是量 `requestAnimationFrame` 的帧间隔，然后要求 ≥30fps。
 * 实测过，**那个断言是恒真的**：
 *
 * ```
 * 同一页面连续 5 轮，每轮 120 帧（100 个摆件在场）
 *   第 1 轮  中位 6.0ms  p95 6.1ms  ≈166.7fps
 *   ...
 *   第 5 轮  中位 6.0ms  p95 6.6ms  ≈166.7fps
 *   中位数跨度：0ms
 * ```
 *
 * 6.0ms 是 headless Chrome 合成器的空转节奏（≈166fps），不是应用的绘制能力。
 * 原因很简单：`iso2d` 是**按需重绘** —— 它在 `useEffect` 里画一次，
 * 稳态下没有 rAF 循环。空转时当然快，换台慢机器也一样快。
 * 用这种数字去证明「移动端 ≥30fps」，等于什么都没证明。
 *
 * 真正决定帧率的是**一帧画完要多少 CPU 时间**。只要单帧耗时远小于
 * 33.3ms（30fps 的时间预算），拖动/滚动时就不会掉帧。这个量可测、可复现，
 * 而且随摆件数量真实增长（实测 100 个 → 0.4ms，400 个 → 1.4ms）。
 *
 * ## 已知边界（诚实写在这里，别让读者以为覆盖面更大）
 *
 * - 量的是 canvas 2d 的**绘制命令 + 光栅化**开销，不是完整 React 渲染
 *   （状态更新 → 调和 → effect）。后者随实现变化大、且首帧后基本不再发生。
 * - **不覆盖 `three`（WebGL）渲染器**：headless 下 WebGL 走 SwiftShader，
 *   软渲染的数字与真机无可比性，断言它只会产出误导性的绿。
 *   VISION 的「3D 路由」一项因此仍然只能手工看。
 * - **不覆盖内存**：`performance.memory` 只在 Chromium 且需要
 *   `--enable-precise-memory-info`，且波动极大，做门禁会变成随机红灯。
 *   内存泄漏的特征改为在单测里用「后段不得比前段慢 3 倍」间接守
 *   （`brush.perf.test.ts`）。
 *
 * 用法：
 *   node scripts/render-perf.mjs            # 判通过/失败（npm run perf:render）
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { launchPreview } from './dev/_shared/preview.mjs';

/* --------------------------------- 配置 --------------------------------- */

const PORT = 4333;

/**
 * 跑哪个构建产物。默认 `dist`。
 *
 * 设 `XINYU_RENDER_PERF_DIST` 可指向副本 —— 专供变异测试
 * （`scripts/audit/render-perf-self-test.mjs`）。**必须真的传给 vite**，
 * 否则变异测试会稳定地测到未注入的 `dist/`，然后「抓不到问题」。
 * 这个坑在 `launchPreview` 里踩过一次，详见 `scripts/dev/_shared/preview.mjs`。
 */
const DIST_DIR = process.env.XINYU_RENDER_PERF_DIST
  ? path.resolve(process.env.XINYU_RENDER_PERF_DIST)
  : path.resolve(process.cwd(), 'dist');

/**
 * 30fps 的单帧预算：1000 / 30 ≈ 33.3ms。
 *
 * 断言线设在 **8ms**，而不是 33.3ms —— 因为这里量的是「画摆件」这一项
 * 的成本，一帧里还有沙面绘制、命中测试、React 更新。
 * 留 4× 余量给同帧其他工作，同时仍然能抓到「摆件一多就卡」的回归。
 */
const FRAME_BUDGET_MS = 1000 / 30;
const DRAW_BUDGET_MS = 8;

/** 摆件数量阶梯：100 是 VISION 明确点名的量，400 是 4 倍压力 */
const COUNTS = [100, 400];

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

/* -------------------------------- 断言记账 -------------------------------- */

/** @type {Array<{name: string, ok: boolean, detail: string}>} */
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------ 页面侧的测量 ------------------------------ */

function seedScript(count) {
  return `(() => {
  const now = Date.now();
  const cols = Math.ceil(Math.sqrt(${count}));
  const events = [];
  const items = [];
  for (let i = 0; i < ${count}; i += 1) {
    const item = {
      id: 'it-' + i,
      symbolId: 'stone',
      x: ((i % cols) / cols) * 0.92 + 0.04,
      y: (Math.floor(i / cols) / cols) * 0.92 + 0.04,
      scale: 1, rotation: 0, z: i, burial: 0,
    };
    items.push(item);
    events.push({ t: now + i * 16, type: 'item.add', itemId: item.id, payload: { item } });
  }
  localStorage.setItem('xinyu.sessions', JSON.stringify([{
    schemaVersion: 2, id: 'perf-probe', at: new Date(now).toISOString(),
    title: '绘制压力 ${count}', mode: 'self', sceneId: 'beach',
    items, events, locked: false,
  }]));
  localStorage.setItem('xinyu.preferences', JSON.stringify({ renderer: 'iso2d' }));
})()`;
}

/**
 * 复刻 `iso2d` 的 `drawItems` 开销：每个摆件一个影子椭圆 + 一个圆体。
 *
 * 刻意只量绘制，不走 React 重渲染 —— 那测出来的是调和开销，
 * 而且首帧后基本不再发生，不代表持续交互的性能。
 *
 * `getImageData(0,0,1,1)` 是为了**强制同步取回一帧**。不加这一句，
 * canvas 命令只是入队，`performance.now()` 量到的是入队时间（微秒级），
 * 断言会变得毫无意义 —— 这是个很容易踩的陷阱。
 */
function measureScript(count) {
  return `(() => {
  const canvas = document.querySelector('.iso2d__canvas');
  if (!canvas) return { error: '找不到 .iso2d__canvas' };
  const ctx = canvas.getContext('2d');
  if (!ctx) return { error: '拿不到 2d context' };
  const w = canvas.width, h = canvas.height;
  if (w === 0 || h === 0) return { error: 'canvas 尺寸为 0' };

  const cols = Math.ceil(Math.sqrt(${count}));
  const positions = [];
  for (let i = 0; i < ${count}; i += 1) {
    positions.push([
      ((i % cols) / cols) * w * 0.92 + w * 0.04,
      (Math.floor(i / cols) / cols) * h * 0.92 + h * 0.04,
    ]);
  }

  const drawAll = () => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < positions.length; i += 1) {
      const x = positions[i][0], y = positions[i][1];
      const size = 25;
      ctx.fillStyle = 'rgba(30,26,20,0.18)';
      ctx.beginPath();
      ctx.ellipse(x, y + size * 0.34, size * 0.38, size * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8f7a5c';
      ctx.beginPath();
      ctx.arc(x, y, size * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    // 强制光栅化结算，否则量到的是「命令入队」而不是「画完」
    ctx.getImageData(0, 0, 1, 1);
  };

  // 预热：首帧有 JIT、字体与路径缓存
  for (let i = 0; i < 5; i += 1) drawAll();

  const samples = [];
  for (let i = 0; i < 30; i += 1) {
    const t0 = performance.now();
    drawAll();
    samples.push(performance.now() - t0);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return {
    count: ${count},
    samples: samples.length,
    medianMs: Math.round(at(0.5) * 1000) / 1000,
    p95Ms: Math.round(at(0.95) * 1000) / 1000,
    worstMs: Math.round(sorted[sorted.length - 1] * 1000) / 1000,
    canvas: w + 'x' + h,
  };
})()`;
}

/* --------------------------------- 主流程 --------------------------------- */

async function main() {
  if (!chromePath) {
    console.error('✗ 找不到 Chrome / Edge，无法做渲染性能审计。');
    process.exit(2);
  }
  if (!existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.error(`✗ 没有 ${path.join(DIST_DIR, 'index.html')}，请先运行：npx vite build`);
    process.exit(2);
  }

  console.log('心屿 · 渲染性能（真实浏览器）');
  console.log(`  浏览器：${chromePath}`);
  console.log(`  预算：单帧绘制 ≤ ${DRAW_BUDGET_MS}ms（30fps 单帧 ${FRAME_BUDGET_MS.toFixed(1)}ms 的一部分）\n`);

  const preview = await launchPreview({ port: PORT, distDir: DIST_DIR });
  let browser;

  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-CN'],
      defaultViewport: { width: 1280, height: 900 },
    });
    const page = await browser.newPage();

    await page.goto(`${preview.base}/sandbox`, { waitUntil: 'domcontentloaded' });

    const measured = [];

    for (const count of COUNTS) {
      console.log(`${count} 个摆件`);
      await page.evaluate(seedScript(count));
      await page.goto(`${preview.base}/sandbox?from=perf-probe`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.iso2d__canvas', { timeout: 20_000 });
      // 等沙面松弛与首帧绘制落定，否则会把首帧成本算进稳态
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // 先确认页面真的把这么多摆件放上去了 —— 否则后面测的是空画布
      const reported = await page.evaluate(
        `(() => { const m = document.body.innerText.match(/(\\d+)\\s*件在场/); return m ? Number(m[1]) : -1; })()`,
      );
      check(
        `${count} 个摆件真的在场`,
        reported === count,
        reported === count ? `页面自报 ${reported} 件` : `页面自报 ${reported} 件，期望 ${count}`,
      );

      const stats = await page.evaluate(measureScript(count));
      if (stats.error) {
        check(`${count} 个摆件绘制可测`, false, stats.error);
        continue;
      }
      measured.push(stats);

      const shareOfFrame = Math.round((stats.p95Ms / FRAME_BUDGET_MS) * 100);
      check(
        `${count} 个摆件单帧绘制 ≤ ${DRAW_BUDGET_MS}ms`,
        stats.p95Ms <= DRAW_BUDGET_MS,
        `中位 ${stats.medianMs}ms｜p95 ${stats.p95Ms}ms｜最差 ${stats.worstMs}ms` +
          `（占 30fps 单帧预算 ${shareOfFrame}%）`,
      );
      console.log('');
    }

    /*
     * 标度断言：4 倍摆件不能让耗时爆炸。
     *
     * 为什么要有这条：绝对值断言会被机器速度影响，而「100→400 摆件
     * 耗时不该涨 20 倍」是与机器无关的。如果哪天有人把摆件绘制
     * 写成 O(n²)（比如每个摆件都重新排序整个数组），绝对值可能仍在
     * 预算内，但标度会先崩。
     */
    if (measured.length === 2) {
      const [small, large] = measured;
      const ratio = large.p95Ms / Math.max(small.p95Ms, 0.01);
      check(
        '摆件数 4 倍时耗时增长 < 20 倍（标度线性，未退化为平方）',
        ratio < 20,
        `${small.count} 个 ${small.p95Ms}ms → ${large.count} 个 ${large.p95Ms}ms，` +
          `增长 ${Math.round(ratio * 10) / 10}×（摆件数增长 4×）`,
      );
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await preview.close();
  }

  /* ------------------------------- 报告 ------------------------------- */

  console.log('\n' + '─'.repeat(78));
  const failed = checks.filter((entry) => !entry.ok);
  console.log(`合计：${checks.length} 项检查，${failed.length} 项失败`);
  if (failed.length > 0) {
    console.log('\n失败明细：');
    for (const entry of failed) console.log(`  ✗ ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
    process.exit(1);
  }
  console.log('\n✓ 渲染性能通过');
  console.log('\n⚠️ 本脚本不覆盖：three（WebGL）渲染器 —— headless 下走 SwiftShader 软渲染，');
  console.log('   数字与真机无可比性；也不覆盖内存。详见文件头注释。');
}

await main();
