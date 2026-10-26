/**
 * 探针：headless Chrome 里的 rAF 帧间隔稳不稳定？
 *
 * 结论（已实测，保留这个脚本是为了让结论可复现）：
 * **稳定到没有信息量** —— 100 个摆件在场，连续 5 轮 × 120 帧，
 * 中位间隔全是 6.0ms（≈166.7fps），5 轮跨度 0ms。
 *
 * 因为 `iso2d` 是**按需重绘**（`useEffect` 里画一次），稳态下没有 rAF 循环。
 * 6.0ms 是 Chrome 合成器的空转节奏，换台慢十倍的机器还是这个数。
 *
 * ⚠️ 所以**不要**用 rAF 帧间隔去断言「移动端 ≥30fps」或「3D 路由帧率」——
 * 那是一条恒真断言。真正有意义的量是单帧绘制耗时，
 * 见 `scripts/render-perf.mjs` 与 `scripts/dev/probe-draw-cost.mjs`。
 *
 *   node scripts/dev/probe-frame-timing.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { launchPreview } from './_shared/preview.mjs';

const PORT = 4331;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

if (!existsSync(CHROME)) {
  console.error('✗ 找不到 Chrome');
  process.exit(2);
}

/**
 * 在页面里量 N 帧的间隔。用 rAF 连续采样，取中位数与 p95。
 * 中位数抗抖动，p95 反映卡顿。
 */
const MEASURE = `(async (frames) => {
  const deltas = [];
  let last = performance.now();
  await new Promise((resolve) => {
    let count = 0;
    const tick = () => {
      const now = performance.now();
      deltas.push(now - last);
      last = now;
      count += 1;
      if (count >= frames) { resolve(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const mean = deltas.reduce((sum, v) => sum + v, 0) / deltas.length;
  return {
    frames: deltas.length,
    meanMs: Math.round(mean * 100) / 100,
    medianMs: Math.round(at(0.5) * 100) / 100,
    p95Ms: Math.round(at(0.95) * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
    impliedFpsMedian: Math.round((1000 / at(0.5)) * 10) / 10,
  };
})`;

/** 造一个 100 摆件的会话，量「有 100 摆件时」的帧间隔 */
const SEED_100 = `(() => {
  const now = Date.now();
  const events = [];
  const items = [];
  for (let i = 0; i < 100; i += 1) {
    const item = {
      id: 'it-' + i,
      symbolId: 'stone',
      x: (i % 10) / 10 + 0.05,
      y: Math.floor(i / 10) / 10 + 0.05,
      scale: 1, rotation: 0, z: i, burial: 0,
    };
    items.push(item);
    events.push({ t: now + i * 16, type: 'item.add', itemId: item.id, payload: { item } });
  }
  localStorage.setItem('xinyu.sessions', JSON.stringify([{
    schemaVersion: 2, id: 'probe-100', at: new Date(now).toISOString(),
    title: '100 摆件', mode: 'self', sceneId: 'beach',
    items, events, locked: false,
  }]));
  localStorage.setItem('xinyu.preferences', JSON.stringify({ renderer: 'iso2d' }));
})()`;

async function main() {
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
    await page.evaluate(SEED_100);
    await page.goto(`${preview.base}/sandbox?from=probe-100`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.iso2d__canvas', { timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 2000));

    const placed = await page.evaluate(`document.querySelector('[data-testid="sandbox-stage"]') ? document.body.innerText.match(/(\\d+)\\s*件在场/) : null`);
    console.log(`摆件数（页面自报）：${placed ? placed[0] : '读不到'}`);

    console.log('\n同一页面连续 5 轮，每轮 120 帧：');
    const rounds = [];
    for (let i = 0; i < 5; i += 1) {
      const stats = await page.evaluate(`${MEASURE}(120)`);
      rounds.push(stats);
      console.log(
        `  第 ${i + 1} 轮  中位 ${String(stats.medianMs).padStart(6)}ms  p95 ${String(stats.p95Ms).padStart(6)}ms  ` +
          `max ${String(stats.maxMs).padStart(7)}ms  ≈${String(stats.impliedFpsMedian).padStart(6)}fps`,
      );
    }

    const medians = rounds.map((r) => r.medianMs);
    const spread = Math.max(...medians) - Math.min(...medians);
    console.log(`\n中位数跨度：${Math.round(spread * 100) / 100}ms（越小越可信）`);
    console.log(`中位数均值：${Math.round((medians.reduce((a, b) => a + b, 0) / medians.length) * 100) / 100}ms`);

    /*
     * 移动端视口再量一次 —— VISION 要求「移动端 ≥30fps」。
     * 注意 deviceScaleFactor 不改帧率，但 isMobile 会改布局与手势路径。
     */
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 800));
    const mobile = await page.evaluate(`${MEASURE}(120)`);
    console.log(
      `\n390px 移动端视口：中位 ${mobile.medianMs}ms  p95 ${mobile.p95Ms}ms  ≈${mobile.impliedFpsMedian}fps`,
    );

    writeFileSync(
      path.resolve(process.cwd(), 'tmp', 'frame-timing.json'),
      JSON.stringify({ desktop: rounds, mobile }, null, 2),
      'utf8',
    );
    console.log('\n明细已写入 tmp/frame-timing.json');
  } finally {
    await browser.close().catch(() => undefined);
    await preview.close();
  }
}

await main();
