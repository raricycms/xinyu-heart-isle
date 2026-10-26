/**
 * 沙面特写探针：把托盘区域放大截出来，用于人工核对视觉。
 *
 * 为什么需要它：整体截图里沙面只占 1/3，块状瑕疵（尤其是"挖沙后出现
 * 硬边条纹"）在那个尺度下看不出来。这里用 puppeteer 的 clip 直接截
 * 托盘元素，并额外用 CSS transform 放大 2.5 倍再截一次。
 *
 * 用法：node scripts/dev/probe-surface-zoom.mjs [--port=4193]
 */
import { existsSync, mkdirSync } from 'node:fs';
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
    args: ['--no-sandbox', '--lang=zh-CN', '--force-device-scale-factor=2'],
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

  const clipShot = async (name) => {
    const el = await page.$('[data-testid="sandbox-stage"]');
    const box = await el.boundingBox();
    await page.screenshot({
      path: `${shotDir}/${name}.png`,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
    console.log(`  -> ${shotDir}/${name}.png`);
  };

  await clipShot('zoom-0-empty');

  const pickTool = async (tool) => {
    await page.evaluate((name) => {
      const btn =
        document.querySelector(`[data-testid="sandbox-tool-${name}"]`) ??
        document.querySelector(`[data-testid="surface-toolbar-tool-${name}"]`);
      btn?.click();
    }, tool);
    await sleep(300);
  };

  const box = await (await page.$('[data-testid="sandbox-stage"]')).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  /* 一条挖沙痕迹 */
  await pickTool('dig');
  await page.mouse.move(cx - 150, cy);
  await page.mouse.down();
  for (let i = 1; i <= 24; i += 1) {
    await page.mouse.move(cx - 150 + i * 13, cy + Math.sin(i / 4) * 26);
    await sleep(18);
  }
  await page.mouse.up();
  await sleep(700);
  await clipShot('zoom-1-dig');

  /* 一条推沙痕迹（平行、略上） */
  await pickTool('raise');
  await page.mouse.move(cx - 150, cy - 70);
  await page.mouse.down();
  for (let i = 1; i <= 24; i += 1) {
    await page.mouse.move(cx - 150 + i * 13, cy - 70);
    await sleep(18);
  }
  await page.mouse.up();
  await sleep(700);
  await clipShot('zoom-2-raise');

  /* 喷一片水 */
  await pickTool('water');
  await page.mouse.move(cx + 40, cy + 60);
  await page.mouse.down();
  for (let i = 1; i <= 16; i += 1) {
    await page.mouse.move(cx + 40 + i * 12, cy + 60 - i * 4);
    await sleep(18);
  }
  await page.mouse.up();
  await sleep(700);
  await clipShot('zoom-3-water');
  await clipShot('zoom-4-all');
} catch (error) {
  console.error('探针异常：', error);
} finally {
  if (browser) await browser.close();
  /* 关键：等到 vite 真的断气才返回，否则连跑两次会撞端口 */
  await preview.close();
}
