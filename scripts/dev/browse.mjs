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
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

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
const port = Number((args.find((arg) => arg.startsWith('--port=')) ?? '--port=4173').split('=')[1]);

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error('找不到 Chrome 或 Edge，无法做浏览器验证。');
  process.exit(2);
}

const base = `http://127.0.0.1:${port}`;

function startPreview() {
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), shell: process.platform === 'win32', stdio: 'ignore' },
  );
  return child;
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

const preview = startPreview();
let browser;
let failed = false;

try {
  if (!(await waitForServer(`${base}/`))) {
    throw new Error(`vite preview 未能在 20s 内启动（${base}）`);
  }

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
  preview.kill();
}

process.exit(failed ? 1 : 0);
