/**
 * 逐格取色探针：把画布上「每格中心」的像素颜色读出来，打成 ASCII 亮度图。
 *
 * 用途：亲眼看到的"方块状色块"到底来自 fill（底色）、wall（立面）、
 * 还是 gloss（高光），只靠整体截图分不清。这里把三者分开看。
 *
 * 用法：node scripts/dev/probe-cell-colors.mjs [--port=4193]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { launchPreview } from './_shared/preview.mjs';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!CHROME) {
  console.error('找不到 Chrome/Edge');
  process.exit(2);
}

const args = process.argv.slice(2);
const preferredPort = Number(
  (args.find((a) => a.startsWith('--port=')) ?? '--port=4193').split('=')[1],
);
const shotDir = (args.find((a) => a.startsWith('--shot-dir=')) ?? '--shot-dir=scripts/dev/shots').split('=')[1];
mkdirSync(shotDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * 起 preview 统一走 `_shared/preview.mjs`。
 *
 * 这里原来是 `spawn('npx.cmd', [...], { shell: true })` + 收尾 `preview.kill()`：
 * Windows 上 `shell: true` 会套一层 cmd.exe，kill 只杀 cmd.exe，
 * **vite 变孤儿继续占着 4193**。实测修前每次跑完残留 1 个、端口仍在 Listen。
 *
 * 现在：直接 spawn `node vite.js`（单进程，kill 即真 kill），
 * 且 `stopPreview` 会等到进程真的退出再返回。
 */
const preview = await launchPreview({ port: preferredPort, distDir: 'dist' });
const base = preview.base;
console.log(`使用端口 ${preview.port}（首选 ${preferredPort}）`);

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--lang=zh-CN'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 20000 });
  await sleep(900);

  /* 平坦状态先取一次样 */
  const sampleFlat = await page.evaluate(() => {
    const canvas = document.querySelector('.iso2d__canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    /* 托盘几何：和 iso2d 的 trayRect 保持一致 */
    const TRAY_W_RATIO = 0.88;
    const TRAY_ASPECT = 0.6;
    const trayW = w * TRAY_W_RATIO;
    const trayH = trayW * TRAY_ASPECT;
    const trayX = (w - trayW) / 2;
    const trayY = (h - trayH) / 2 + trayH * 0.08;
    const COLS = 32;
    const ROWS = 24;
    const cellW = trayW / COLS;
    const cellH = trayH / ROWS;
    const out = [];
    for (let row = 0; row < ROWS; row += 1) {
      const line = [];
      for (let col = 0; col < COLS; col += 1) {
        /* 取格子「正中心偏上」的位置：避开立面（在底边）和高光（左上小矩形） */
        const px = Math.round(trayX + (col + 0.5) * cellW);
        const py = Math.round(trayY + (row + 0.55) * cellH);
        if (px < 0 || py < 0 || px >= w || py >= h) {
          line.push([0, 0, 0]);
          continue;
        }
        const i = (py * w + px) * 4;
        line.push([data[i], data[i + 1], data[i + 2]]);
      }
      out.push(line);
    }
    return out;
  });

  const toAscii = (grid) => {
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const values = grid.flat().map(lum);
    const sorted = [...values].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.02)];
    const hi = sorted[Math.floor(sorted.length * 0.98)];
    const chars = ' .:-=+*#%@';
    return grid
      .map((line, row) => {
        const body = line
          .map((c) => {
            const t = hi > lo ? (lum(c) - lo) / (hi - lo) : 0.5;
            return chars[Math.min(9, Math.max(0, Math.round(t * 9)))];
          })
          .join('');
        return `${String(row).padStart(2)}|${body}|`;
      })
      .join('\n');
  };

  console.log('=== 画布上逐格取色（平坦沙面）===');
  console.log(sampleFlat ? toAscii(sampleFlat) : '读不到画布');
  if (sampleFlat) {
    writeFileSync(`${shotDir}/cell-flat.json`, JSON.stringify(sampleFlat));
  }

  /* 喷水后再取一次 */
  await page.evaluate(() => {
    const btn =
      document.querySelector('[data-testid="sandbox-tool-water"]') ??
      document.querySelector('[data-testid="surface-toolbar-tool-water"]');
    btn?.click();
  });
  await sleep(250);

  const stage = await page.$('[data-testid="sandbox-stage"]');
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i <= 40; i += 1) {
    const angle = (i / 40) * Math.PI * 2;
    await page.mouse.move(cx + Math.cos(angle) * 70, cy + Math.sin(angle) * 42);
    await sleep(12);
  }
  await page.mouse.up();
  await sleep(900);

  const sampleWet = await page.evaluate(() => {
    const canvas = document.querySelector('.iso2d__canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    const trayW = w * 0.88;
    const trayH = trayW * 0.6;
    const trayX = (w - trayW) / 2;
    const trayY = (h - trayH) / 2 + trayH * 0.08;
    const COLS = 32;
    const ROWS = 24;
    const cellW = trayW / COLS;
    const cellH = trayH / ROWS;
    const out = [];
    for (let row = 0; row < ROWS; row += 1) {
      const line = [];
      for (let col = 0; col < COLS; col += 1) {
        const px = Math.round(trayX + (col + 0.5) * cellW);
        const py = Math.round(trayY + (row + 0.55) * cellH);
        const i = (py * w + px) * 4;
        line.push([data[i], data[i + 1], data[i + 2]]);
      }
      out.push(line);
    }
    return out;
  });

  console.log('\n=== 画布上逐格取色（喷水后）===');
  console.log(sampleWet ? toAscii(sampleWet) : '读不到画布');
  if (sampleWet) {
    writeFileSync(`${shotDir}/cell-wet.json`, JSON.stringify(sampleWet));
  }

  /* 逐格亮度差：直接看"变化"本身有没有方块感 */
  if (sampleFlat && sampleWet) {
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const chars = ' .:-=+*#%@';
    const deltaGrid = sampleFlat.map((line, row) =>
      line.map((c, col) => Math.max(0, lum(c) - lum(sampleWet[row][col]))),
    );
    const max = Math.max(...deltaGrid.flat());
    console.log('\n=== 逐格亮度差（喷水后变暗多少，@ 最暗）===');
    console.log(
      deltaGrid
        .map((line, row) => {
          const body = line
            .map((d) => chars[Math.min(9, Math.max(0, Math.round((d / Math.max(1, max)) * 9)))])
            .join('');
          return `${String(row).padStart(2)}|${body}|`;
        })
        .join('\n'),
    );
  }
} catch (error) {
  console.error('探针异常：', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  /* 关键：等到 vite 真的断气才返回，否则连跑两次会撞端口 */
  await preview.close();
}
