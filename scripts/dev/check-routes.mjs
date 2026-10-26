/**
 * 全路由渲染核查。
 *
 * 为什么需要它：`tsc` + `vite build` 全绿并不能证明页面能打开。
 * 懒加载的路由、深链直访、Canvas 绘制失败、i18n 键缺失，
 * 这些问题只有真的在浏览器里跑一遍才暴露得出来。
 *
 * 用法：node scripts/dev/check-routes.mjs [--shot-dir=dir]
 * 退出码：0 = 全部通过；1 = 有路由失败
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const args = process.argv.slice(2);
const shotDir = (args.find((arg) => arg.startsWith('--shot-dir=')) ?? '').split('=')[1] || '';
/*
 * 端口默认**由系统分配**（不传 --port 时），避免并发/残留实例互相抢。
 * 需要固定端口时显式传 `--port=4174`。
 */
const preferredPortArg = args.find((arg) => arg.startsWith('--port='));
let port = preferredPortArg ? Number(preferredPortArg.split('=')[1]) : 0;
let base = `http://127.0.0.1:${port}`;

/** 每个路由：期望 URL、最低正文字数、必须出现的文本片段、不能出现的片段 */
/*
 * 路由清单。
 *
 * ⚠️ 两条踩过的坑，都是「绿得没有意义」：
 *
 * 1) `/scales/phq9` 是错的，真实 id 是 **`phq-9`**（见 `src/scales/data.ts`）。
 *    因为 `/scales/:scaleId` 是通配路由，错误 id 照样渲染出一个页面
 *    ——只是内容是「找不到这份量表」。而这里 `must: []` 什么都没要求，
 *    `minLen: 150` 又刚好被导航+页脚撑满，于是**它一直是绿的**。
 *
 * 2) 凡是 `must: []` 的路由，实际只验证了「页面不是空白」。
 *    对动态路由来说这几乎等于没测：任何无效 id 都满足这个条件。
 *    所以动态路由必须配上 `must`，断言**内容里真的出现了该 id 对应的东西**。
 */
const ROUTES = [
  { path: '/', minLen: 200, must: ['心屿', '心理量表', '赛博沙盘'], name: 'home' },
  { path: '/scales', minLen: 150, must: ['心理量表'], name: 'scales' },
  /*
   * 真实 id 是 phq-9（不是 phq9）。
   *
   * 断言的词要选**首屏就有**的：量表页第一屏是「说明页」（时间范围/计分方式/
   * 知情同意），**题目文字要点了「开始作答」才一题一题出现**。
   * 第一版断言写了题目原文「做事时提不起劲」，结果误报失败 —— 页面本身是对的。
   * 所以改断言这页确实渲染出来的东西：量表名 + 免责声明关键词。
   * （免责声明是红线要求，出现在这里正好一并锁住。）
   */
  {
    path: '/scales/phq-9',
    minLen: 150,
    must: ['PHQ-9', '不是诊断', '两周'],
    name: 'scale-phq9',
  },
  { path: '/toolbox', minLen: 120, must: ['情绪工具箱'], name: 'toolbox' },
  { path: '/sandbox', minLen: 150, must: ['沙具', '推沙', '封盘'], name: 'sandbox' },
  { path: '/sandbox/compare', minLen: 60, must: ['对比'], name: 'sandbox-compare' },
  { path: '/sandbox/clients', minLen: 60, must: ['档案'], name: 'sandbox-clients' },
  { path: '/resources', minLen: 120, must: ['资源地图'], name: 'resources' },
  { path: '/records', minLen: 120, must: ['我的记录'], name: 'records' },
  { path: '/safety', minLen: 150, must: ['危机'], name: 'safety', requireTel: true },
  { path: '/about', minLen: 150, must: ['关于'], name: 'about' },
  /*
   * 404 路由例外：它**应该**是「找不到」页面，所以这里不能要求任何内容词。
   * 但至少要断言页面真的渲染了外壳（导航在），否则空白页也会通过。
   */
  {
    path: '/this-route-does-not-exist',
    minLen: 30,
    must: ['心屿'],
    name: 'notfound',
  },
];

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error('找不到 Chrome / Edge。');
  process.exit(2);
}

function startPreview() {
  /*
   * 这里踩过两个坑，都关于「怎么在 Windows 上起 vite preview」：
   *
   * 1) `shell: true` + `npx.cmd`：会在外面套一层 cmd.exe，
   *    `child.kill()` 只杀掉 cmd.exe，**真正的 vite 进程变孤儿继续占端口**。
   *    症状：下次运行 --strictPort 起不来，或者更坏——连到上一次残留的
   *    旧 dist 上，测的是过期构建。
   *
   * 2) 去掉 shell 直接 spawn `npx.cmd`：Node 18+ 的安全变更禁止直接
   *    spawn .cmd/.bat，报 `Error: spawn EINVAL`。
   *
   * 正确做法：**绕过 npx 这层壳**，直接用当前 node 跑 vite 的入口 JS。
   * 这样只有一个进程，kill 就是真 kill，端口不会泄漏。
   */
  const viteBin = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteBin)) {
    throw new Error(`找不到 vite 入口：${viteBin}（先 npm install）`);
  }
  return spawn(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(),
    /*
     * `stdio: 'ignore'` 是**刻意**的，不是图省事。
     *
     * 我一度改成 `['pipe','pipe','pipe']` 想把 vite 的输出收集起来便于诊断，
     * 结果导致 preview **稳定地在中途以 code=-1 退出**（4294967295），
     * 表现为「单独跑通过、连着跑必挂」，失败位置每次还不一样。
     *
     * 原因：管道有缓冲区，父进程这边一旦读取节奏跟不上（我们在跑 puppeteer，
     * 主线程被大量占用），写入端就会阻塞/EPIPE，vite 于是异常退出。
     * 用 `ignore` 把输出丢到 devnull 就完全没有这个问题。
     *
     * 诊断信息改用「退出码 + 端口」来传达，足够了 —— 不需要它的日志。
     */
    stdio: 'ignore',
    windowsHide: true,
  });
}

/**
 * 停掉 preview。
 *
 * 只 kill 自己 spawn 的那个进程就够 —— 因为我们**直接跑 node**（不经过
 * cmd.exe / npx 外壳），pid 就是 vite 本体。早先按端口 `taskkill /T /F`
 * 那套是在「有孤儿进程」的前提下打补丁，结果并发时误杀别人的服务器，
 * 反而制造了 `code=-1` 的诡异失败。现在从源头保证不产生孤儿。
 */
async function stopPreview(child) {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill();
  } catch {
    /* 忽略 */
  }
}

/**
 * 挑一个空闲端口。
 *
 * 让系统分配（listen(0)）而不是写死 4174：并发的两次校验、或上一次运行
 * 留下的残留进程，都不会再互相踩。「固定端口 + 起来前先清干净」这套
 * 思路的毛病是它默认了单实例，一旦并发就会互杀。
 */
async function pickFreePort(preferred) {
  if (preferred) return preferred;
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port: chosen } = server.address();
      server.close(() => resolve(chosen));
    });
  });
}

async function isPortListening() {
  try {
    await fetch(`${base}/`, { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

async function waitForServer(child, url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    /*
     * 关键：child 已经退出就立刻报错。
     * 否则我们会连上「别人的」（残留的）服务器，然后在一台
     * 即将消失的进程上做完整套校验。
     */
    if (child.exitCode !== null) {
      throw new Error(
        `vite preview 启动即退出（exitCode=${child.exitCode}）。端口 ${port} 可能被占用。`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

port = await pickFreePort(port);
base = `http://127.0.0.1:${port}`;
console.log(`使用端口 ${port}${preferredPortArg ? '（--port 指定）' : '（系统分配，避免并发冲突）'}`);
const preview = startPreview();
/* 留存 preview 的输出，失败时打印出来，否则「服务中途消失」无从诊断 */
const previewLog = [];
preview.stdout?.on('data', (chunk) => previewLog.push(String(chunk)));
preview.stderr?.on('data', (chunk) => previewLog.push(String(chunk)));
preview.on('exit', (code, signal) => {
  previewLog.push(`\n[preview 于 ${new Date().toISOString()} 退出 code=${code} signal=${signal}]`);
});
let browser;
const failures = [];
const warnings = [];

try {
  if (!(await waitForServer(preview, `${base}/`))) throw new Error('vite preview 启动超时');
  if (shotDir) mkdirSync(shotDir, { recursive: true });

  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--lang=zh-CN'],
    defaultViewport: { width: 1440, height: 1000 },
  });

  const page = await browser.newPage();

  for (const route of ROUTES) {
    const consoleErrors = [];
    const pageErrors = [];
    const onConsole = (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    };
    const onPageError = (error) => pageErrors.push(String(error));
    page.on('console', onConsole);
    page.on('pageerror', onPageError);

    const notes = [];
    try {
      const response = await page.goto(`${base}${route.path}`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      // 懒加载路由需要多等一拍
      await new Promise((resolve) => setTimeout(resolve, 900));

      const status = response ? response.status() : 0;
      if (status >= 400) notes.push(`HTTP ${status}`);

      const text = await page.evaluate(() => document.body.innerText);
      if (text.length < route.minLen) notes.push(`正文仅 ${text.length} 字（期望 ≥ ${route.minLen}）`);

      for (const fragment of route.must) {
        if (!text.includes(fragment)) notes.push(`缺少文本「${fragment}」`);
      }

      if (route.requireTel) {
        const telCount = await page.evaluate(
          () => document.querySelectorAll('a[href^="tel:"]').length,
        );
        if (telCount === 0) notes.push('红线：危机页没有 tel: 链接');
        else notes.push(`tel 链接 ${telCount} 个`);
      }

      // 空白页检测：主体高度过小
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      if (bodyHeight < 300) notes.push(`页面高度仅 ${bodyHeight}px，疑似白屏`);

      if (consoleErrors.length > 0) notes.push(`console.error × ${consoleErrors.length}`);
      if (pageErrors.length > 0) notes.push(`pageerror × ${pageErrors.length}`);

      if (shotDir) {
        await page.screenshot({ path: join(shotDir, `${route.name}.png`), fullPage: false });
      }

      const failed =
        notes.some((note) => /HTTP|字（期望|缺少文本|红线|疑似白屏|console\.error|pageerror/.test(note));
      const line = `${failed ? 'FAIL' : ' OK '}  ${route.path.padEnd(32)} ${notes.join(' | ')}`;
      if (failed) {
        failures.push(line);
        console.log(line);
        consoleErrors.slice(0, 3).forEach((entry) => console.log(`        console: ${entry.slice(0, 200)}`));
        pageErrors.slice(0, 3).forEach((entry) => console.log(`        pageerror: ${entry.slice(0, 200)}`));
      } else {
        console.log(line);
        if (notes.length > 0) warnings.push(`${route.path}: ${notes.join(' | ')}`);
      }
    } catch (error) {
      failures.push(`${route.path} 抛异常: ${error}`);
      console.log(`FAIL  ${route.path}  ${error}`);
    } finally {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    }
  }

  /* ------------------------- 深链刷新（SPA fallback） ------------------------ */
  console.log('\n--- 深链刷新验证（验证 base:"/" + SPA fallback） ---');
  /*
   * 这里原来是独立硬编码的一份列表 `['/sandbox','/sandbox/compare','/scales/phq9','/safety']`，
   * 而且判据只有 `text.length > 60` —— 也就是说**任何非空白页都算通过**。
   *
   * 后果：上面 ROUTES 里的 `phq9` 拼写错误被修好之后，这里仍然写着 `phq9`，
   * 而它照样天天绿（「找不到这份量表」页面也有 200+ 字）。
   *
   * 现在改成从 ROUTES 取，并复用同一套 `must` 断言：
   * 一处定义、两处验证，不会再出现「主清单改了、副清单忘了」。
   */
  const deepLinks = ROUTES.filter(
    (route) => route.path !== '/this-route-does-not-exist' && (route.must?.length ?? 0) > 0,
  ).map((route) => ({ path: route.path, must: route.must ?? [] }));
  for (const link of deepLinks) {
    try {
      await page.goto(`${base}${link.path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.reload({ waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise((resolve) => setTimeout(resolve, 700));
      const text = await page.evaluate(() => document.body.innerText);
      const missing = link.must.filter((word) => !text.includes(word));
      const ok = text.length > 60 && missing.length === 0;
      console.log(
        `${ok ? ' OK ' : 'FAIL'}  刷新 ${link.path.padEnd(24)} 正文 ${text.length} 字` +
          (missing.length ? ` | 缺少「${missing.join('」「')}」` : ''),
      );
      if (!ok) failures.push(`深链刷新失败: ${link.path}${missing.length ? `（缺 ${missing.join('/')}）` : ''}`);
    } catch (error) {
      console.log(`FAIL  刷新 ${link.path}  ${error}`);
      failures.push(`深链刷新异常: ${link.path}`);
    }
  }

  /* ---------------------------- 视口自适应检查 ---------------------------- */
  console.log('\n--- 移动端视口（390×844）溢出检查 ---');
  await page.setViewport({ width: 390, height: 844 });
  for (const link of ['/sandbox', '/scales', '/records']) {
    await page.goto(`${base}${link}`, { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const ok = overflow <= 2;
    console.log(`${ok ? ' OK ' : 'FAIL'}  ${link.padEnd(16)} 横向溢出 ${overflow}px`);
    if (!ok) failures.push(`移动端横向溢出 ${overflow}px @ ${link}`);
    if (shotDir) await page.screenshot({ path: join(shotDir, `m-${link.replace(/\//g, '_')}.png`) });
  }
} catch (error) {
  console.error('核查脚本失败：', error);
  failures.push(String(error));
} finally {
  if (browser) await browser.close();
  /* 失败时把 preview 自己的输出打出来（成功时保持安静） */
  if (failures.length > 0 && previewLog.length > 0) {
    console.log('\n--- vite preview 输出 ---');
    console.log(previewLog.join('').slice(-2000));
  }
  await stopPreview(preview);
  /*
   * 等 preview 真的断气再往下走。
   *
   * 之前 stopPreview 里 kill 完立刻返回，下一个进程可能马上起来抢同一个
   * 端口或残留 socket；更常见的是**上一个脚本还在退出过程中**，
   * 连续运行时两个实例短暂并存，互相把对方的服务器打死。
   * 表现就是「单独跑通过、连着跑必挂」。
   */
  for (let i = 0; i < 50 && preview.exitCode === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

console.log(`\n结果：${failures.length === 0 ? '全部通过' : `${failures.length} 项失败`}`);
if (warnings.length > 0) {
  console.log('提示：');
  warnings.forEach((entry) => console.log(`  - ${entry}`));
}
if (failures.length > 0) {
  console.log('失败项：');
  failures.forEach((entry) => console.log(`  - ${entry}`));
}
process.exit(failures.length === 0 ? 0 : 1);
