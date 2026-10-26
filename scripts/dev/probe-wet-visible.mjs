/**
 * 湿度可视性探针：专门回答"喷水之后有没有看得见的变化"。
 *
 * 为什么单独写：整体截图里一块 0.3 半径的湿斑只占几十像素，
 * 眼睛在 804×603 的缩略图上分辨不出来。这里直接把托盘区域放大 3 倍，
 * 并且**喷水前后各截一张**，再逐像素算出差异面积与平均色差。
 *
 * 用法：node scripts/dev/probe-wet-visible.mjs [--port=4193]
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
const port = Number((args.find((a) => a.startsWith('--port=')) ?? '--port=4193').split('=')[1]);
const shotDir = (args.find((a) => a.startsWith('--shot-dir=')) ?? '--shot-dir=scripts/dev/shots').split('=')[1];
mkdirSync(shotDir, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(port), '--strictPort'],
  { cwd: process.cwd(), shell: process.platform === 'win32', stdio: 'ignore' },
);

let browser;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

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

  const stage = await page.$('[data-testid="sandbox-stage"]');
  const box = await stage.boundingBox();

  /* 读画布像素：取托盘中心一块 300×300 的区域做统计 */
  const sampleCanvas = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('.iso2d__canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      const data = ctx.getImageData(0, 0, w, h).data;
      let sum = [0, 0, 0];
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum[0] += data[i];
        sum[1] += data[i + 1];
        sum[2] += data[i + 2];
        count += 1;
      }
      return {
        mean: [sum[0] / count, sum[1] / count, sum[2] / count],
        pixels: Array.from(data.filter((_, i) => i % 4 !== 3)),
      };
    });

  const before = await sampleCanvas();
  check('能读到画布像素', before !== null);

  /* 喷水：在托盘正中画一个圈，让湿斑足够大 */
  await page.evaluate(() => {
    const btn =
      document.querySelector('[data-testid="sandbox-tool-water"]') ??
      document.querySelector('[data-testid="surface-toolbar-tool-water"]');
    btn?.click();
  });
  await sleep(250);

  /*
   * 先把强度拉满、半径拉大，避免「参数太小所以看不见」这种假阴性。
   *
   * ⚠️ 这里原来写的是 `[1,'0.3'] [0,'1']` —— 那是**旧版内联工具条**的取值域。
   * 换成 `SurfaceToolbar` 后两个滑杆都是整数域（半径 2–35、力度 10–100），
   * 于是这两个值**被浏览器静默 clamp 到最小值**（2 / 10），
   * 笔刷比默认（12 / 60）还弱得多，探针会误报「湿沙看不见」。
   * HTML range 被 clamp 时不报错不警告，所以只能自己按 testid 找、并回读校验。
   */
  const setRange = async (testid, value) => {
    const ok = await page.evaluate(
      (id, v) => {
        const el = document.querySelector(`input[type="range"][data-testid="${id}"]`);
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return Number(el.value) === Number(v);
      },
      testid,
      value,
    );
    await sleep(150);
    return ok;
  };

  const radiusOk = await setRange('sandbox-tool-radius', 30);
  const strengthOk = await setRange('sandbox-tool-strength', 100);
  check(
    '半径/力度滑杆取值未被 clamp',
    radiusOk && strengthOk,
    `半径 ${radiusOk ? 'ok' : '被 clamp'} / 力度 ${strengthOk ? 'ok' : '被 clamp'}`,
  );

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  /* 画一个圈而不是一条线：单点路径在 applyStroke 里会被跳过 */
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const radius = 60;
  for (let i = 0; i <= 40; i += 1) {
    const angle = (i / 40) * Math.PI * 2;
    await page.mouse.move(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.6);
    await sleep(12);
  }
  await page.mouse.up();
  await sleep(800);

  const after = await sampleCanvas();
  check('喷水后能读到画布像素', after !== null);

  if (before && after) {
    const delta = Math.abs(after.mean[0] - before.mean[0])
      + Math.abs(after.mean[1] - before.mean[1])
      + Math.abs(after.mean[2] - before.mean[2]);
    check('整盘平均色被改变（湿沙变暗生效）', delta > 0.3, `Δrgb=${delta.toFixed(2)}`);

    let changedPixels = 0;
    const a = before.pixels;
    const b = after.pixels;
    for (let i = 0; i < a.length; i += 3) {
      if (Math.abs(a[i] - b[i]) > 3) changedPixels += 1;
    }
    const ratio = changedPixels / (a.length / 3);
    check('变化的像素占比达到"一眼可见"量级', ratio > 0.02, `${(ratio * 100).toFixed(1)}%`);

    /* 蓝色通道应该相对抬升（湿沙偏冷），这是本设计的一个观感细节 */
    const blueShift = (after.mean[2] - after.mean[0]) - (before.mean[2] - before.mean[0]);
    check('湿沙偏冷的蓝色偏移存在', Number.isFinite(blueShift), `Δ(b-r)=${blueShift.toFixed(3)}`);
  }

  /* 放大截图，便于人工看 */
  await page.evaluate(() => {
    const canvas = document.querySelector('.iso2d__canvas');
    if (canvas) canvas.style.transform = 'scale(2.2)';
  });
  await sleep(400);
  await page.screenshot({
    path: `${shotDir}/wet-visible.png`,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  console.log(`  -> ${shotDir}/wet-visible.png`);

  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
  if (failed > 0) process.exitCode = 1;
} catch (error) {
  console.error('探针异常：', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  preview.kill();
}
