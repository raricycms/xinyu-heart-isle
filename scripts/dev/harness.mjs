/**
 * 浏览器核查脚本的公共底座。
 *
 * 存在的理由（踩过的坑）：
 * 1. 起预览服务器必须**不产生孤儿进程**。以前这里是
 *    `spawn('npx.cmd', ...)` + `shell: true`，Windows 上会多一层 cmd.exe，
 *    `child.kill()` 只杀掉 cmd.exe，vite preview 变孤儿占住端口，
 *    下一次跑脚本就 `ERR_CONNECTION_REFUSED` 或连到旧构建。
 *    当时的补救是在退出前 `taskkill /T /F` 杀整棵进程树 —— 那是**打补丁**，
 *    根治办法是直接 spawn `node vite.js`（单进程，kill 即真 kill）。
 *    现在统一委托给 `_shared/preview.mjs`，与 scripts/dev 下其他脚本同一套实现。
 * 2. 等待服务器就绪要显式失败，不能静默 fallthrough——
 *    否则报错信息会变成「页面打不开」，掩盖真正原因。
 * 3. 端口在用时要能自动让路，而不是让脚本互相踩。
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer-core';
import { pickFreePort, launchPreview, sleep } from './_shared/preview.mjs';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('找不到 Chrome / Edge');
  return found;
}

/** 端口是否空闲 */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/** 从 startPort 起找一个空闲端口（保留导出，兼容旧调用方） */
export async function pickPort(startPort = 4200, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const port = startPort + i;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`从 ${startPort} 起连续 ${tries} 个端口都被占用`);
}

/*
 * `sleep` 从 `_shared/preview.mjs` 再导出：
 * 二十多个脚本都在 `import { sleep } from './harness.mjs'`，
 * 保持这个出口不破，免得为了统一实现而改一堆无关文件。
 */
export { sleep };

/**
 * 启动 vite preview 并等待就绪。
 * 返回 { base, close }。
 *
 * ⚠️ 这里原来是 `spawn('npx.cmd', ..., { shell: true })` + 收尾 `taskkill /T /F`。
 * `taskkill /T` 确实能把 vite 一起杀掉，所以**这个文件本身不泄漏**（实测 0 残留），
 * 但它是「靠杀进程树来掩盖多进程」的补丁思路：
 *   - 一旦 `close()` 没跑到（异常退出、Ctrl+C），照样留孤儿；
 *   - 每个用 `harness.mjs` 的脚本都在依赖这个脆弱约定。
 * 现在改成委托 `_shared/preview.mjs`：直接 spawn `node vite.js`
 * （单进程，pid 就是 vite 本体），kill 即真 kill，不再需要 /T。
 */
export async function startPreview({ port, distDir = 'dist', timeoutMs = 40000 } = {}) {
  return launchPreview({
    port: port ?? (await pickFreePort()),
    distDir,
    timeoutMs,
  });
}

/** 启动浏览器；调用方负责 close */
export async function launchBrowser() {
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-CN'],
    defaultViewport: { width: 1440, height: 1000 },
  });
}

/**
 * 一次性跑完一个任务：起服务器 → 起浏览器 → 执行 fn → 一定清理干净。
 * fn 接收 ({ base, page, browser })。
 */
export async function withSandboxPage(options, fn) {
  const preview = await startPreview(options);
  let browser;
  const results = { steps: [], fails: [] };

  const record = (name, ok, detail = '') => {
    results.steps.push(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) results.fails.push(`${name}${detail ? `: ${detail}` : ''}`);
    return ok;
  };

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error}`));

    await fn({ base: preview.base, page, browser, record, consoleErrors });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await preview.close();
  }

  return results;
}

/** 统一的收尾输出 + 退出码 */
export function report(results, title) {
  console.log(`\n=== ${title} ===`);
  results.steps.forEach((line) => console.log(line));
  const real = results.fails.filter(Boolean);
  console.log(`\n结果：${real.length === 0 ? '全部通过' : `${real.length} 项失败`}`);
  if (real.length > 0) {
    console.log('失败项：');
    real.forEach((entry) => console.log(`  - ${entry}`));
  }
  return real.length === 0 ? 0 : 1;
}
