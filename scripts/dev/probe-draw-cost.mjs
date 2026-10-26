/**
 * 探针：iso2d 单次完整绘制到底要多久？（100 个摆件 / 400 个摆件）
 *
 * 为什么不用 rAF 帧间隔：`iso2d` 是**按需重绘**（`useEffect` 里画一次），
 * 稳态下没有 rAF 循环。空转时 rAF 间隔就是 Chrome 合成器的节奏
 * （实测稳定 6.0ms ≈ 166fps，5 轮跨度 0ms），跟应用开销无关。
 * 拿它当「移动端 ≥30fps」的证据是**恒真断言**。
 *
 * 真正有意义的量是：**一帧画完要多少 CPU 时间**。
 * 只要单帧耗时 << 33ms（30fps 的预算），滚动/拖动时的帧率就有保障。
 *
 *   node scripts/dev/probe-draw-cost.mjs
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { launchPreview } from './_shared/preview.mjs';

const PORT = 4332;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const SEED = (count) => `(() => {
  const now = Date.now();
  const events = [];
  const items = [];
  const cols = Math.ceil(Math.sqrt(${count}));
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
    schemaVersion: 2, id: 'probe-cost', at: new Date(now).toISOString(),
    title: '画布压力', mode: 'self', sceneId: 'beach',
    items, events, locked: false,
  }]));
  localStorage.setItem('xinyu.preferences', JSON.stringify({ renderer: 'iso2d' }));
})()`;

/**
 * 直接调 canvas 2d API 复刻一次「画 100/400 个摆件」的开销。
 *
 * 为什么不触发整个 React 重渲染：那要经过状态更新、调和、effect，
 * 测出来的是 React 的开销，不是绘制本身。这里只量绘制路径 ——
 * 这正好对应 VISION 说的「阴影/遮挡」那部分成本。
 */
const MEASURE_DRAW = (count) => `(() => {
  const canvas = document.querySelector('.iso2d__canvas');
  if (!canvas) return { error: '没有 canvas' };
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  // 与 iso2d 的 drawItems 同构：每个摆件一个椭圆影子 + 一个圆体
  const drawAll = () => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < ${count}; i += 1) {
      const cols = Math.ceil(Math.sqrt(${count}));
      const x = ((i % cols) / cols) * w * 0.92 + w * 0.04;
      const y = (Math.floor(i / cols) / cols) * h * 0.92 + h * 0.04;
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
    // 强制同步取回一帧，避免只测了「命令入队」而非真正的光栅化
    ctx.getImageData(0, 0, 1, 1);
  };

  // 预热（首帧有 JIT 与字体缓存）
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
    medianMs: Math.round(at(0.5) * 1000) / 1000,
    p95Ms: Math.round(at(0.95) * 1000) / 1000,
    worstMs: Math.round(sorted[sorted.length - 1] * 1000) / 1000,
    canvas: w + 'x' + h,
  };
})()`;

async function main() {
  if (!existsSync(CHROME)) {
    console.error('✗ 找不到 Chrome');
    process.exit(2);
  }
  mkdirSync(path.resolve(process.cwd(), 'tmp'), { recursive: true });
  const preview = await launchPreview({ port: PORT, distDir: 'dist' });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-CN'],
    defaultViewport: { width: 1280, height: 900 },
  });

  try {
    const page = await browser.newPage();
    await page.goto(`${preview.base}/sandbox`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(SEED(100));
    await page.goto(`${preview.base}/sandbox?from=probe-cost`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.iso2d__canvas', { timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 1500));

    const reported = await page.evaluate(`document.body.innerText.match(/(\\d+)\\s*件在场/)?.[0] ?? '读不到'`);
    console.log(`页面自报：${reported}`);
    console.log('\n纯绘制开销（影子椭圆 + 摆件圆体，30 次采样，已预热）：');
    const results = [];
    for (const count of [100, 400]) {
      const stats = await page.evaluate(MEASURE_DRAW(count));
      if (stats.error) {
        console.log(`  ✗ ${stats.error}`);
        continue;
      }
      results.push(stats);
      console.log(
        `  ${String(count).padStart(3)} 个摆件  中位 ${String(stats.medianMs).padStart(7)}ms  ` +
          `p95 ${String(stats.p95Ms).padStart(7)}ms  最差 ${String(stats.worstMs).padStart(7)}ms（canvas ${stats.canvas}）`,
      );
    }

    console.log('\n对照 30fps 预算 33.3ms：');
    for (const stats of results) {
      const headroom = Math.round((33.3 / stats.p95Ms) * 10) / 10;
      console.log(`  ${String(stats.count).padStart(3)} 个：p95 占预算 ${Math.round((stats.p95Ms / 33.3) * 100)}%，余量 ${headroom}×`);
    }

    writeFileSync(
      path.resolve(process.cwd(), 'tmp', 'draw-cost.json'),
      JSON.stringify(results, null, 2),
      'utf8',
    );
    console.log('\n明细已写入 tmp/draw-cost.json');
  } finally {
    await browser.close().catch(() => undefined);
    await preview.close();
  }
}

await main();
