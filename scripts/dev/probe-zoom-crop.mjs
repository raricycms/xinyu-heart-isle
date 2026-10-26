/**
 * 高倍特写探针：只截湿斑周围一小块（默认 220×140 CSS px），
 * 设备像素比 4，用来判断"方块感"到底是什么元素造成的。
 *
 * 为什么要这么抠：在 804×603 的整体截图里，20px 的格子和 8px 的
 * 高光矩形都太小，肉眼分不清是"底色块"还是"高光块"。
 *
 * 用法：node scripts/dev/probe-zoom-crop.mjs [--port=4193] [--w=220] [--h=140]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!CHROME) {
  console.error('找不到 Chrome/Edge');
  process.exit(2);
}

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
};
const port = Number(arg('port', '4193'));
const shotDir = arg('shot-dir', 'scripts/dev/shots');
const cropW = Number(arg('w', '220'));
const cropH = Number(arg('h', '140'));
mkdirSync(shotDir, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(port), '--strictPort'],
  { cwd: process.cwd(), shell: process.platform === 'win32', stdio: 'ignore' },
);

let browser;
try {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${base}/`)).ok) break;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--lang=zh-CN', '--force-device-scale-factor=4'],
    defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 4 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 20000 });
  await sleep(900);

  const stage = await page.$('[data-testid="sandbox-stage"]');
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const clip = {
    x: cx - cropW / 2,
    y: cy - cropH / 2,
    width: cropW,
    height: cropH,
  };

  await page.screenshot({ path: `${shotDir}/crop-0-flat.png`, clip });
  console.log(`  -> ${shotDir}/crop-0-flat.png`);

  const pickTool = async (tool) => {
    await page.evaluate((name) => {
      const btn =
        document.querySelector(`[data-testid="sandbox-tool-${name}"]`)
        ?? document.querySelector(`[data-testid="surface-toolbar-tool-${name}"]`);
      btn?.click();
    }, tool);
    await sleep(250);
  };

  /* 喷水：画一个圈覆盖整个裁剪区域 */
  await pickTool('water');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i <= 48; i += 1) {
    const angle = (i / 48) * Math.PI * 2;
    await page.mouse.move(cx + Math.cos(angle) * 55, cy + Math.sin(angle) * 34);
    await sleep(10);
  }
  await page.mouse.up();
  await sleep(900);
  await page.screenshot({ path: `${shotDir}/crop-1-wet.png`, clip });
  console.log(`  -> ${shotDir}/crop-1-wet.png`);

  /* 挖沙：看立面到底是硬边还是坡 */
  await pickTool('dig');
  await page.mouse.move(cx - 90, cy - 10);
  await page.mouse.down();
  for (let i = 1; i <= 30; i += 1) {
    await page.mouse.move(cx - 90 + i * 6, cy - 10);
    await sleep(14);
  }
  await page.mouse.up();
  await sleep(900);
  await page.screenshot({ path: `${shotDir}/crop-2-dig.png`, clip });
  console.log(`  -> ${shotDir}/crop-2-dig.png`);

  /* 推沙：看沙丘的体积感 */
  await pickTool('raise');
  await page.mouse.move(cx - 90, cy + 40);
  await page.mouse.down();
  for (let i = 1; i <= 30; i += 1) {
    await page.mouse.move(cx - 90 + i * 6, cy + 40);
    await sleep(14);
  }
  await page.mouse.up();
  await sleep(900);
  await page.screenshot({ path: `${shotDir}/crop-3-raise.png`, clip });
  console.log(`  -> ${shotDir}/crop-3-raise.png`);
} catch (error) {
  console.error('探针异常：', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  preview.kill();
}
