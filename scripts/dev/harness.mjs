/**
 * 浏览器核查脚本的公共底座。
 *
 * 存在的理由（踩过的坑）：
 * 1. `spawn('npx.cmd', ...)` 在 Windows 上会在 `npx` 与 `vite` 之间多一层进程，
 *    直接 `child.kill()` 只杀掉 npx，vite preview 会变成孤儿进程占住端口，
 *    下一次跑脚本就 `ERR_CONNECTION_REFUSED` 或连到旧构建。
 *    这里在退出前用 `taskkill /T /F` 杀整棵进程树。
 * 2. 等待服务器就绪要显式失败，不能静默 fallthrough——
 *    否则报错信息会变成「页面打不开」，掩盖真正原因。
 * 3. 端口在用时要能自动让路，而不是让脚本互相踩。
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer-core';

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

/** 从 startPort 起找一个空闲端口 */
export async function pickPort(startPort = 4200, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const port = startPort + i;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`从 ${startPort} 起连续 ${tries} 个端口都被占用`);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 杀掉整棵进程树（Windows 必须用 /T，否则 vite 会残留） */
function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    /* 已经死了 */
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
}

/**
 * 启动 vite preview 并等待就绪。
 * 返回 { base, close }。
 */
export async function startPreview({ port, distDir = 'dist', timeoutMs = 40000 } = {}) {
  if (!existsSync(distDir)) {
    throw new Error(`找不到 ${distDir}/，请先跑 \`npx vite build\``);
  }
  const chosen = port ?? (await pickPort());
  const base = `http://127.0.0.1:${chosen}`;

  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(chosen), '--strictPort'],
    {
      cwd: process.cwd(),
      shell: process.platform === 'win32',
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    },
  );

  const deadline = Date.now() + timeoutMs;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }

  if (!ready) {
    killTree(child);
    throw new Error(`vite preview 未能在 ${timeoutMs}ms 内就绪（${base}）`);
  }

  return {
    base,
    close: async () => {
      killTree(child);
      // 给 OS 一点时间释放端口
      await sleep(250);
    },
  };
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
