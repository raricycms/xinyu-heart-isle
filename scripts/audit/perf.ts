/**
 * 性能预算审计（`npm run perf`）。
 *
 * 为什么要有这个脚本：`docs/CONTRACT.md` §7 的预算表里，「沙盘首屏可交互 ≤ 1.5s」
 * 一行的验证方式写的是 `scripts/audit/perf.ts` —— 而这个文件此前**从来没存在过**。
 * `npm run perf` 一直抛 MODULE_NOT_FOUND，只是没人跑它，所以没人发现。
 * 这跟 qa-dev 发现的「假测试」是同一类问题：**门禁看起来存在，实际不存在**。
 * 修法不是把文档里的那一行删掉（那等于承认我们不测首屏），而是把这个脚本补上。
 *
 * 职责边界（重要）：
 *   - **纯计算预算**（replayAll / computeSessionStats / 笔刷 / 编码体积）
 *     已经在 `src/__tests__/perf.test.ts`、`src/sandbox/perf-scale.test.ts`、
 *     `src/sandbox/surface/brush.perf.test.ts` 里断言过了，**这里不重复**。
 *     原因：那些模块用的是 `@/` 别名，Node 直接跑解析不了（要么加 loader，
 *     要么把别名展开成相对路径 —— 前者引入构建依赖，后者会和源码脱节）。
 *     而 vitest 本来就配好了别名，让单测做这件事成本最低。
 *
 *   - **首屏可交互**是这里唯一的活：它必须开真浏览器、加载构建产物，
 *     单测（`environment: 'node'`）做不到。这才是这个脚本存在的理由。
 *
 * 设计取向：**超预算要看得见，但抖动不等于失败**。
 *
 * 绝对毫秒数受机器性能影响很大，所以分三级判定（见下方 `warnLimit`）：
 *   ≤ 预算        ✓ 通过
 *   ≤ 2× 预算     ⚠ 告警但通过（明确打印「已超预算」，不再混在通过里）
 *   > 2× 预算     ✗ 失败
 *
 * ⚠️ 这里原来是「预算 1.5s、判失败线 3×（4.5s）」并且**超预算也一声不吭**。
 * 后果是实测到 1574ms 时，输出和 416ms 那次**完全一样**：
 *   ✓ 首屏可交互  1574ms ... 0 项超预算 ✓   EXIT 0
 * 预算写在文档里（CONTRACT §7：1500ms），但代码里没有任何东西在守它。
 * 一个「写了数字但不约束任何行为」的阈值，比没有阈值更糟 ——
 * 它让人以为有保护。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** CONTRACT §7 的预算（毫秒）。改这里必须同步改文档。 */
const BUDGET_MS = 1500;

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * 启动 `vite preview` 伺服 dist，返回 { url, stop }。
 *
 * 不解析 vite 的输出猜端口：实测它打的是 ANSI 彩色的
 * `  ➜  Local:   http://127.0.0.1:4319/`，在 Windows 控制台里还会变成乱码，
 * 用正则去抓 URL 既脆又容易抓到别的行。既然端口是 `--strictPort` 定死的，
 * 直接轮询这个固定地址更简单也更可靠 —— 服务活着就一定能连上。
 */
async function startPreview() {
  const distIndex = path.join(ROOT, 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    /*
     * 环境错误统一用**退出码 2**，和 `a11y.ts` / `smoke.ts` 对齐。
     *
     * 原来这里是裸 `throw`，被最外层 catch 接住后 `process.exit(1)` ——
     * 于是「没构建」和「性能真的退化」在 CI 里是同一个退出码，看日志才知道区别。
     * 退出码是机器读的唯一信号，必须能分开：1 = 门禁失败（被测对象有问题），
     * 2 = 环境不满足（压根没测）。
     * TESTING.md 也明确写了「三个脚本都会自己检查，缺失时以退出码 2 报错」，
     * 文档承诺了就得兑现。
     */
    console.error('✗ dist/index.html 不存在：先跑 `npm run build`（退出码 2，表示环境不满足，不是性能失败）');
    process.exit(2);
  }

  const port = 4319;
  const url = `http://127.0.0.1:${port}`;

  /*
   * 起服务之前先确认端口是空的。
   *
   * 下面的指纹校验只能挡住「完全不相干的假页面」，挡不住「另一份完好的 dist」——
   * 而后者恰恰是最容易发生的：残留的 vite preview 就是完好的 dist。
   * 唯一可靠的判据是「这个端口上没有别人」。
   */
  const portInUse = await new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(true));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, '127.0.0.1');
  });
  if (portInUse) {
    console.error(
      `✗ 端口 ${port} 已被占用，无法确认被测对象是自己的构建产物。\n` +
        '  多半是上次残留的 vite preview。在别人的页面上测出来的「性能达标」毫无意义。\n' +
        `  处理：Get-NetTCPConnection -LocalPort ${port} -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }\n` +
        '  退出码 2 = 环境不满足，不是性能失败。',
    );
    process.exit(2);
  }

  const child = spawn(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      'preview',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: ROOT, stdio: 'ignore' },
  );

  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) {
      /*
       * `--strictPort` 且端口被占时 vite 会立刻退出 —— 这正是我们要的信号。
       * 但**不能只靠它**：如果占端口的是别的任意服务，vite 退出我们能看到；
       * 若占端口的恰好也是一个 vite preview，或者探测在 child 退出前就成功了，
       * 下面的 HTTP 探测就会连到别人的服务器上。
       */
      throw new Error(`vite preview 提前退出，code=${child.exitCode}`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        /*
         * ⚠️ 这里原来只写 `break;` —— 只要有人在这个端口上回 200 就算「起来了」。
         *
         * 后果（已实测）：我用一个静态服务器占住 4319，伺服一个 200×200、
         * 中间 8×8 点亮的小页面，perf.ts 输出
         *   ✓ 首屏可交互 /sandbox  20ms（三次 124 / 20 / 27） 0 项超预算 ✓  EXIT 0
         * 它审计的是**那个假页面**，自己的 dist 一个字节都没碰。性能门禁全绿，
         * 而被测对象可以任意性能退化 —— 这是最彻底的幽灵。
         *
         * 修法：拿到 HTML 后确认里头有本项目构建产物的指纹。
         * dist/index.html 一定引用了 /assets/index-<hash>.js，假页面不会有；
         * 顺带校验 `<div id="root">`（React 挂载点）。
         */
        const html = await res.text().catch(() => '');
        const looksLikeOwnBuild =
          /<div\s+id="root"\s*>/.test(html) && /\/assets\/[A-Za-z0-9_-]+\.js/.test(html);
        if (!looksLikeOwnBuild) {
          child.kill();
          console.error(
            `✗ ${url} 上响应的**不是本项目的构建产物**（没有 #root / /assets/*.js 指纹）。\n` +
              '  多半是上次残留的 vite preview 或别的服务占着这个端口。\n' +
              '  perf.ts 绝不能在别人的页面上测自己的预算 —— 那样「通过」毫无意义。\n' +
              '  处理：找到占用 4319 的进程并结束它（PowerShell：\n' +
              '    Get-NetTCPConnection -LocalPort 4319 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }\n' +
              '  ）然后重跑。退出码 2 = 环境不满足，不是性能失败。',
          );
          process.exit(2);
        }
        break;
      }
    } catch {
      // 还没起来，继续等
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('vite preview 启动超时（20s）');
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return { url, stop: () => child.kill() };
}

/**
 * 环境不全时的退出码。
 *
 * ⚠️ 这两个分支原本是 `process.exit(0)` —— 也就是「没找到浏览器」和
 * 「没装 puppeteer-core」都被当成**通过**。这是我自己犯的、和原缺陷同构的错误：
 *
 *   $ 变异：清空 Chrome 候选路径
 *   ○ 跳过：没找到 Chrome/Edge，无法测首屏
 *   EXIT=0        ← 门禁绿了，但一个字节都没测
 *
 * 而 `docs/TESTING.md` L48 明写「缺失时以退出码 2 明确报错，而不是静默跳过」——
 * 那句话对 e2e / a11y 成立，唯独对 perf 不成立。
 *
 * 用 2 而不是 1：2 = 「没跑成」，1 = 「跑了但超预算」。
 * 两者都让 `npm run check` 失败，但看日志时能立刻区分是环境问题还是性能问题。
 * 本地偶尔想跳过就显式传 `--allow-skip`，把跳过变成**有意的选择**而不是默认行为。
 */
const SKIP_EXIT = 2;
const ALLOW_SKIP = process.argv.includes('--allow-skip');

function bailSkip(reason: string): never {
  if (ALLOW_SKIP) {
    console.log(`  ○ 跳过：${reason}`);
    console.log('  （因显式传入 --allow-skip，本次按通过处理）');
    process.exit(0);
  }
  console.error(`\n✗ 无法执行首屏测量：${reason}`);
  console.error('  这不是通过 —— 首屏预算本次完全没有被验证。');
  console.error('  修好环境后重跑；确实要跳过请显式传 --allow-skip。');
  process.exit(SKIP_EXIT);
}

async function main() {
  console.log('性能预算审计（CONTRACT §7）');
  console.log('  纯计算预算由 vitest 覆盖（perf.test.ts / perf-scale.test.ts / brush.perf.test.ts）');
  console.log('  本脚本只测单测做不到的：真实浏览器首屏可交互\n');

  const chromePath = findChrome();
  if (!chromePath) bailSkip('没找到 Chrome/Edge，无法测首屏');

  let puppeteer;
  try {
    puppeteer = (await import('puppeteer-core')).default;
  } catch {
    bailSkip('未安装 puppeteer-core，无法测首屏');
  }

  const server = await startPreview();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    /*
     * 量三次取最小值。
     * 用最小值而不是中位数：跑得慢只可能是因为受干扰（GC、冷启动、抢 CPU），
     * 不存在「因为受干扰而跑得更快」，所以最小值是真实开销的无偏估计。
     * 每轮开**新 page**（不是新浏览器）以强制重新加载资源，
     * 否则第二轮命中缓存，量出来的不是首屏。
     */
    const samples = [];
    for (let i = 0; i < 3; i += 1) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });

      const started = Date.now();
      await page.goto(`${server.url}/sandbox`, { waitUntil: 'domcontentloaded' });

      /*
       * 「可交互」的判据必须是真的能用，不能只是「DOM 里有 canvas」：
       * 元素是 React 先挂上去的，那一刻画布还是空白，用户点它没反应。
       * 所以要等到画布中心真的画出了非透明像素。
       */
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return false;
          const ctx = canvas.getContext('2d');
          if (!ctx) return false;
          const { width, height } = canvas;
          if (width < 16 || height < 16) return false;
          const data = ctx.getImageData(
            Math.floor(width / 2) - 4,
            Math.floor(height / 2) - 4,
            8,
            8,
          ).data;
          for (let k = 3; k < data.length; k += 4) {
            if (data[k] !== 0) return true;
          }
          return false;
        },
        { timeout: 15000, polling: 16 },
      );

      samples.push(Date.now() - started);
      await page.close();
    }

    const best = Math.min(...samples);
    /*
     * 三级判定，而不是原来的「一条 3× 硬线」。
     *
     * 旧行为：预算 1500ms，判失败线 4500ms。实测机器上首屏会抖动，
     * 1409ms / 1574ms 都出现过 —— 明明超了 1500 的预算，输出却是
     *   ✓ 首屏可交互  1574ms ... 0 项超预算 ✓   EXIT 0
     * 和 416ms 那次长得一模一样。**预算写了却没有约束力，等于没写。**
     *
     * 现在：
     *   best <= BUDGET_MS        → ✓ 通过（正常）
     *   BUDGET_MS < best <= 2×预算 → ⚠ 告警但 EXIT 0（承认少量抖动）
     *   best > 2×预算            → ✗ 失败 EXIT 1
     *
     * 告警线要**看得见**：超预算就明确打出来，而不是混在通过里。
     * 这样「偶发抖动」和「真的退化了」在日志里一眼能分开。
     */
    const warnLimit = BUDGET_MS * 2;
    const overBudget = best > BUDGET_MS;
    const ok = best <= warnLimit;
    console.log(
      `${ok ? (overBudget ? '  ⚠' : '  ✓') : '  ✗'} 首屏可交互 /sandbox   ${best}ms` +
        `（三次 ${samples.join(' / ')}）` +
        `  预算 ${BUDGET_MS}ms` +
        (overBudget ? `，**已超预算**` : '') +
        `  判失败线 ${warnLimit}ms`,
    );

    if (ok && overBudget) {
      console.log(
        `\n⚠ 超过 ${BUDGET_MS}ms 预算但未达 ${warnLimit}ms 失败线：本次判通过，但这属于性能抖动，\n` +
          '  值得留意。连续多次出现请按失败处理（机器负载、新增大依赖、同步阻塞都会这样）。',
      );
    }

    if (!ok) {
      console.log(
        `\n首屏超过 ${warnLimit}ms（预算的 2 倍）说明什么：这不是「机器慢」就能解释的。\n` +
          '先用 `npm run build` 确认产物正常，再看是不是新增了同步阻塞逻辑\n' +
          '（比如在模块顶层做大量计算、或把 three.js 打进主包）。',
      );
    }

    console.log(
      `\n合计：1 项预算，${ok ? '0' : '1'} 项超预算` +
        `${ok ? (overBudget ? '（1 项超出预算但在容忍区间）' : ' ✓') : ''}`,
    );
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (browser) await browser.close();
    server.stop();
  }
}

await main();
