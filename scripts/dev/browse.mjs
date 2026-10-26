/**
 * 中文安全浏览器探针。
 *
 * 为什么不用 `Invoke-WebRequest` / curl：
 * 它们没法等待 SPA 渲染完成，也无法捕获 console 错误。
 * 这里用项目已有的 puppeteer-core 驱动本机 Chrome，
 * 既能拿到渲染后文本，也能捕获运行时异常——tsc+build 绿不等于页面能打开。
 *
 * 用法：node scripts/dev/browse.mjs <path> [--wait=1200] [--shot=out.png] [--html]
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { launchPreview } from './_shared/preview.mjs';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith('--')) ?? '/';
const waitMs = Number((args.find((arg) => arg.startsWith('--wait=')) ?? '--wait=1200').split('=')[1]);
const shot = (args.find((arg) => arg.startsWith('--shot=')) ?? '').split('=')[1];
const dumpHtml = args.includes('--html');
const preferredPort = Number(
  (args.find((arg) => arg.startsWith('--port=')) ?? '--port=4173').split('=')[1],
);

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error('找不到 Chrome 或 Edge，无法做浏览器验证。');
  process.exit(2);
}

/*
 * 起 preview 的活全部交给 `_shared/preview.mjs`。
 *
 * 这里原来是自己 `spawn('npx.cmd', [...], { shell: true })` + 收尾
 * `preview.kill()` —— 那是本仓库最贵的一个坑：`shell: true` 会套一层
 * cmd.exe，`kill()` 只杀掉 cmd.exe，**真正的 vite 进程变孤儿继续占着 4173**。
 * 实测修前每次跑完都残留 1 个，端口一直在 Listen。
 *
 * 现在改用公共模块：直接 spawn `node vite.js`（单进程、kill 即真 kill），
 * 并且 `stopPreview` 会等到进程真的退出才返回，连跑两次也不会互相踩。
 */
const preview = await launchPreview({ port: preferredPort, distDir: 'dist' });
const base = preview.base;
console.log(`使用端口 ${preview.port}（首选 ${preferredPort}）`);
let browser;
let failed = false;

try {
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-CN'],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  const errors = [];
  const pageErrors = [];
  const requested = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('request', (request) => requested.push(request.url()));

  const url = `${base}${path}`;
  const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const title = await page.title();
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g, '\n\n').trim());
  const bodyLength = text.length;

  console.log(`URL      : ${url}`);
  console.log(`HTTP     : ${response ? response.status() : 'no-response'}`);
  console.log(`TITLE    : ${title}`);
  console.log(`TEXT LEN : ${bodyLength}`);
  const threeChunk = requested.filter((entry) => /three-[A-Za-z0-9_-]+\.js/.test(entry));
  console.log(`THREE JS : ${threeChunk.length === 0 ? '未加载（正确）' : threeChunk.join(', ')}`);
  console.log('--- 正文 ---');
  console.log(text.slice(0, 3000));

  if (dumpHtml) {
    console.log('--- HTML ---');
    console.log((await page.content()).slice(0, 6000));
  }

  if (errors.length > 0) {
    failed = true;
    console.log('--- console.error ---');
    errors.forEach((entry) => console.log(entry));
  }
  if (pageErrors.length > 0) {
    failed = true;
    console.log('--- pageerror ---');
    pageErrors.forEach((entry) => console.log(entry));
  }

  if (shot) {
    const target = shot === 'true' ? 'scripts/dev/shot.png' : shot;
    mkdirSync(dirname(target), { recursive: true });
    await page.screenshot({ path: target, fullPage: true });
    console.log(`截图已保存：${target}`);
  }

  if (bodyLength < 40) {
    failed = true;
    console.log('!! 页面正文少于 40 字，可能白屏。');
  }
} catch (error) {
  failed = true;
  console.error('探针失败：', error);
} finally {
  if (browser) await browser.close();
  /* 关键：等到 vite 真的断气才返回，否则连跑两次会撞端口/互相踩 */
  await preview.close();
}

process.exit(failed ? 1 : 0);
