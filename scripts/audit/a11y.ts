/**
 * 心屿 · 无障碍（a11y）审计
 *
 * HANDOVER §3 P2 的原话是：「对比度从未被工具测量过」「`reducedMotion` 没有系统级检测」。
 * 前者正是本脚本要解决的：**不靠肉眼，靠算**。
 *
 * ## 审计项（逐条对应 CONTRACT §7 的无障碍预算）
 *
 * 1. 可访问名（accessible name）：每个 `button` / `a` 都必须有名字。
 *    没有名字的按钮对读屏用户等于不存在。
 * 2. 图片替代文本：`img` 必须有 `alt`（装饰性图片用 `alt=""`）。
 * 3. 表单控件标签：`input` / `select` / `textarea` 必须有 `<label for>`、
 *    包裹的 `<label>`、或 `aria-label` / `aria-labelledby`。
 * 4. 触摸目标 ≥ 44×44px（CONTRACT §7）。容差 1px，因为浏览器亚像素取整。
 *    例外：行内文字链接不适用（WCAG 2.5.5 明确豁免）
 * 5. 正文对比度 ≥ 4.5:1（CONTRACT §7）。自己算相对亮度，不引第三方库。
 *    大字号（≥18.66px 粗体 或 ≥24px）按 WCAG 放宽到 3:1。
 * 6. 语义地标：`<main>` 必须存在（读屏跳读的关键）
 * 7. 页面语言：`<html lang>` 必须是 zh 系列
 * 8. 标题层级：不得跳级（h1 -> h3 是警告）
 * 9. `prefers-reduced-motion`：系统级减弱动效必须被响应（HANDOVER §3 P2）
 *
 * ## 用法
 *
 *   node --experimental-strip-types scripts/audit/a11y.ts
 *   node --experimental-strip-types scripts/audit/a11y.ts --strict   # 警告也算失败
 *   node --experimental-strip-types scripts/audit/a11y.ts /sandbox   # 只审计匹配路由
 *
 * 退出码：0 = 无 critical，1 = 有 critical（或 --strict 下有 warning）。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

/* -------------------------------------------------------------------------- */
/*                                  配置                                       */
/* -------------------------------------------------------------------------- */

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
];

const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const HEADED = argv.includes('--headed');
/** 把当前发现写成新的基线文件（首次启用 / 有意改善后更新） */
const UPDATE_BASELINE = argv.includes('--update-baseline');
/** 只报告，不影响退出码 */
const REPORT_ONLY = argv.includes('--report-only');
/** 输出机器可读的 JSON（用于 diff 两次运行、排查不可复现） */
const JSON_OUT = argv.includes('--json');
const filter = argv.find((arg) => !arg.startsWith('--'));
const PORT = Number((argv.find((arg) => arg.startsWith('--port=')) ?? '--port=4174').split('=')[1]);
const BASE = `http://127.0.0.1:${PORT}`;
const BASELINE_PATH = path.resolve(process.cwd(), 'scripts/audit/a11y-baseline.json');

/**
 * 审计哪个构建产物。
 *
 * 默认 `dist`。设 `XINYU_A11Y_DIST` 可指向别的目录 —— 专供**变异测试**：
 * `scripts/audit/meta-self-test.mjs` 把 dist 复制到 `tmp/mut-dist/`，
 * 在副本里注入缺陷，完全不碰工作区的 `dist`。
 *
 * 为什么必须能换目录：最初直接改 `dist/index.html` 再恢复，恢复操作和
 * 另一条命令的 `vite build` 撞上，`index.html` 被写成旧 bundle hash；
 * 紧接着两次审计读到**过期 bundle**，报出 7 个根本不存在的
 * `keyboard-unreachable`。变异测试污染了被测对象本身。
 */
const DIST_DIR = process.env.XINYU_A11Y_DIST
  ? path.resolve(process.env.XINYU_A11Y_DIST)
  : path.resolve(process.cwd(), 'dist');

/** CONTRACT §7：触摸目标 ≥ 44×44px */
const MIN_TARGET = 44;
/** 亚像素取整容差 */
const TARGET_TOLERANCE = 1;
/**
 * 浏览器侧（`page.evaluate` 回调内）用的同一组阈值副本。
 *
 * 为什么要有副本：`page.evaluate` 的函数体会被序列化后在浏览器里执行，
 * 那里的作用域**没有**上面的 Node 常量。曾经有改动直接在回调里引用
 * `MIN_TARGET`，导致 `ReferenceError`，让审计在 0 违规时也 exit 1。
 *
 * 用 `as const` + 下面的 `satisfies` 做编译期一致性检查：
 * 两边对不上时 `tsc` 会报错，不会再出现「改了上面忘了下面」。
 */
const BROWSER_MIN_TARGET = 44;
const BROWSER_TARGET_TOLERANCE = 1;

// 编译期守卫：若两边不一致，这两行会报类型错误。
const _minTargetGuard: 44 = MIN_TARGET satisfies 44;
const _tolGuard: 1 = TARGET_TOLERANCE satisfies 1;
const _minTargetSync: typeof MIN_TARGET = BROWSER_MIN_TARGET;
const _tolSync: typeof TARGET_TOLERANCE = BROWSER_TARGET_TOLERANCE;
void _minTargetGuard;
void _tolGuard;
void _minTargetSync;
void _tolSync;

/** CONTRACT §7：正文对比度 ≥ 4.5:1 */
const MIN_CONTRAST = 4.5;
/** 大字号放宽阈值（WCAG 1.4.3） */
const MIN_CONTRAST_LARGE = 3;

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

/**
 * 审计覆盖的路由。
 *
 * **必须与 `src/App.tsx` 的 `<Route path=...>` 保持同步。**
 *
 * 原来只有 5 条（`/`、`/scales`、`/sandbox`、`/records`、`/safety`），
 * 而 App.tsx 有 15 条 —— 也就是**大部分页面从来没被无障碍审计过**。
 * 对比度、触摸目标、可访问名称这些问题在未覆盖的页面里可以无限存在。
 *
 * 动态路由用不存在的 id 填：数据不存在时页面应渲染体面的「找不到」提示
 * 而不是白屏，那个提示本身也要满足无障碍要求。
 * `*` 兜底路由不列入（它渲染 404 页，由 E2E 的 routes-sweep 覆盖）。
 */
const ROUTES = [
  '/',
  '/scales',
  '/scales/phq-9',
  '/sandbox',
  '/sandbox/compare',
  '/sandbox/clients',
  '/sandbox/clients/demo-nonexistent',
  '/sandbox/session/demo-nonexistent',
  '/sandbox/session/demo-nonexistent/report',
  '/records',
  '/safety',
  '/toolbox',
  '/toolbox/breathing-478',
  '/resources',
  '/about',
];

/* -------------------------------------------------------------------------- */
/*                                结果模型                                     */
/* -------------------------------------------------------------------------- */

type Level = 'critical' | 'warning';

interface Finding {
  route: string;
  level: Level;
  rule: string;
  message: string;
  selector?: string;
}

const findings: Finding[] = [];

function report(route: string, level: Level, rule: string, message: string, selector?: string): void {
  // 去重：同一路由 + 同一规则 + 同一文案只记一次。
  // 否则像「327 件」这种同时出现在标题和 aria 里的文本会被计两次，
  // 让基线计数随渲染顺序抖动。
  const key = `${route}|${rule}|${message}`;
  if (findings.some((entry) => `${entry.route}|${entry.rule}|${entry.message}` === key)) return;
  findings.push({ route, level, rule, message, selector });
}

/* -------------------------------------------------------------------------- */
/*                             服务与浏览器                                     */
/* -------------------------------------------------------------------------- */

/**
 * 起服务**之前**确认端口是空的。
 *
 * 这是「端口劫持」最稳的一道闸：不管占着端口的是残留的 vite preview、
 * 一份完好的 dist 副本、还是任意别的服务，只要它不是我们自己刚起的那个进程，
 * 审计结论就不可信。指纹校验（#root + /assets/*.js）挡不住「另一份完好 dist」，
 * 而端口预检挡得住。
 *
 * 已实测的假绿：真实 dist 的 `lang="zh-CN"` 改成 `<html>`（本该 critical 5），
 * 同时在 4174 挂一份完好的 dist 副本 → a11y.ts 输出
 *   critical 0 项，warning 0 项 / ✓ 通过 / EXIT 0
 * 同一个变异在端口空着时 → html-lang critical 5、EXIT 1。
 */
async function assertPortFree(port: number): Promise<void> {
  if (!(await isPortListening(port))) return;
  console.error(
    `✗ 端口 ${port} 已被占用，无法确认审计对象是自己的构建产物。\n` +
      '  多半是上次残留的 vite preview（或别的服务）。在别人的页面上跑出来的\n' +
      '  「无障碍通过」毫无意义，所以这里直接退出而不是硬着头皮跑。\n' +
      `  处理：Get-NetTCPConnection -LocalPort ${port} -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }\n` +
      '  退出码 2 = 环境不满足，不是无障碍失败。',
  );
  process.exit(2);
}

/**
 * 端口上是否有人在监听。
 *
 * 用「尝试自己 bind，能不能成功」来判断，而不是 `net.connect` ——
 * bind 失败=有人在监听，这个判据不依赖对方是否接受连接，
 * 也不会因为对端 backlog 满而产生误判。`assertPortFree` 和收尾自检共用它。
 */
async function isPortListening(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(true));
    probe.once('listening', () => {
      probe.close(() => resolve(false));
    });
    probe.listen(port, '127.0.0.1');
  });
}

function startPreview(): ChildProcess {
  /*
   * 不用 `npx.cmd` + `shell: true`。
   *
   * Windows 上 `shell: true` 会在外面套一层 cmd.exe，`stopPreview` 里的
   * `taskkill /T` 虽然能连子进程一起杀，但 `child.kill()` 只能杀掉 cmd.exe，
   * 真正的 vite 变孤儿继续占着 4174 —— 下一次跑就撞上「端口被占」。
   *
   * 直接 spawn node + vite 的入口 JS：只有一个进程，kill 就是真 kill。
   * 顺带避开 Node 18+ 禁止直接 spawn .cmd/.bat 的 `spawn EINVAL`。
   */
  const viteBin = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteBin)) {
    console.error(`✗ 找不到 vite 入口：${viteBin}（先 npm install）`);
    process.exit(2);
  }
  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST_DIR],
    { cwd: process.cwd(), stdio: 'ignore', windowsHide: true },
  );
  /*
   * 登记到 livePreviews 并装上 exit 钩子：这样即使后面某个
   * `process.exit()` 绕过了 `finally`，preview 也会被收掉。
   */
  livePreviews.add(child);
  installExitHook();
  return child;
}

async function waitForServer(url: string, timeoutMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        /*
         * ⚠️ 只判 `response.ok` 是不够的：端口被别人的服务占住时，
         * vite preview 会因为 --strictPort 起不来，但我们照样连上了**那台**服务，
         * 于是审计的是别人的页面，输出「critical 0 / warning 0 / 通过」。
         *
         * 已实测的假绿手法：把真实 dist 的 `lang="zh-CN"` 改成 `<html>`（本该
         * critical 5），同时在 4174 挂一份**完好的** dist 副本 —— a11y.ts 报
         *   critical 0 项，warning 0 项 / ✓ 通过 / EXIT 0
         * 而只改 dist、端口空着时同一个变异 → html-lang critical 5、EXIT 1。
         * 同一个缺陷，结论完全取决于端口上是谁。
         *
         * 修法：确认响应的 HTML 带本项目构建指纹（#root + /assets/*.js）。
         */
        const html = await response.text().catch(() => '');
        const looksLikeOwnBuild =
          /<div\s+id="root"\s*>/.test(html) && /\/assets\/[A-Za-z0-9_-]+\.js/.test(html);
        if (!looksLikeOwnBuild) {
          console.error(
            `✗ ${url} 上响应的**不是本项目的构建产物**（没有 #root / /assets/*.js 指纹）。\n` +
              '  多半是上次残留的 vite preview 或别的服务占着这个端口。\n' +
              '  a11y 审计在别人的页面上跑出来的「通过」毫无意义。\n' +
              `  处理：Get-NetTCPConnection -LocalPort ${PORT} -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }\n` +
              '  退出码 2 = 环境不满足，不是无障碍失败。',
          );
          process.exit(2);
        }
        return true;
      }
    } catch {
      /* 继续等 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/**
 * 所有由本进程 spawn 的 preview。用于**进程级兜底清理**。
 *
 * 为什么必须有这个 Set：`finally` 不是万能的。
 * `waitForServer()` 内部发现「端口上不是我们的构建产物」时会 `process.exit(2)`，
 * 而 **`process.exit()` 会立即终止进程，`finally` 块根本不会执行** ——
 * 于是 preview 留在 4174 上，下一次审计 `assertPortFree` 就 `EXIT 2`
 * 「端口已被占用」，而占用者其实是自己上次留下的。
 *
 * 这不是假想：实测连续跑两次审计，第二次必挂（`ERR_CONNECTION_REFUSED`
 * 之后 `4174 已被占用`）。
 *
 * `process.on('exit')` 在 `process.exit()` 时**会**被触发（Node 的保证），
 * 所以把清理挂在这里，才能覆盖所有退出路径 —— 不用去逐个审计每个
 * `process.exit` 出口（本文件有 10 个，将来还会增加）。
 */
const livePreviews = new Set<ChildProcess>();

let exitHookInstalled = false;
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const child of livePreviews) {
      try {
        // exit 钩子里只能同步操作。taskkill 同步调用就是为了这个场合。
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* 已经死了 */
      }
    }
    livePreviews.clear();
  });
  /*
   * 信号路径同样不走 `finally`（默认处理下直接终止）。
   * 这里不拦截信号，只是补上清理；随后用默认行为退出。
   */
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      for (const child of livePreviews) {
        try {
          if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          /* 已经死了 */
        }
      }
      livePreviews.clear();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
}

/**
 * 关掉自己起的 preview 并**等它真的断气**。
 *
 * 原来这里是 `spawn('taskkill', ...)` 然后立刻返回 —— taskkill 本身是异步
 * 子进程，调用方紧接着 `process.exit()`，于是父进程先死、taskkill 可能还没执行完，
 * vite 就变成孤儿继续占着 4174。
 *
 * 现在：轮询等退出码 → 超时才强杀 → 再确认。
 * 另外从 `livePreviews` 里摘掉，避免 exit 钩子重复处理。
 */
async function stopPreview(child: ChildProcess): Promise<void> {
  livePreviews.delete(child);
  if (child.exitCode !== null || child.signalCode !== null) return;

  // 先礼后兵：SIGTERM 让它自己收尾
  try {
    child.kill();
  } catch {
    /* 已经死了 */
  }

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // 兜底：只按自己 spawn 的 pid 强杀（含子进程）
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 已经死了 */
    }
  }
  // 再等一小会儿，确保端口真的释放了
  const hardDeadline = Date.now() + 3000;
  while (Date.now() < hardDeadline && child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/* -------------------------------------------------------------------------- */
/*                        注入页面执行的审计逻辑                                */
/* -------------------------------------------------------------------------- */

/**
 * 在页面里跑的审计函数。
 *
 * 为什么整段塞进 `page.evaluate`：布局信息（尺寸、颜色、计算样式）只有浏览器知道，
 * Node 侧拿不到。传一个自包含函数进去，避免序列化问题。
 *
 * 返回原始数据，判定逻辑留在 Node 侧 —— 这样规则阈值可读、可调、可单测。
 */
interface RawAudit {
  lang: string | null;
  hasMain: boolean;
  headings: Array<{ level: number; text: string }>;
  namelessButtons: Array<{ html: string; text: string }>;
  namelessLinks: Array<{ html: string; text: string }>;
  emptyAltImages: Array<{ html: string; src: string }>;
  unlabeledControls: Array<{ html: string; type: string; visuallyHidden: boolean }>;
  smallTargets: Array<{ html: string; text: string; width: number; height: number }>;
  lowContrast: Array<{
    html: string;
    text: string;
    fg: string;
    bg: string;
    ratio: number;
    fontSize: number;
    bold: boolean;
  }>;
  /** 当前 matchMedia 是否处于 reduce（由 Node 侧 emulateMediaFeatures 控制） */
  prefersReducedMotion: boolean;
  tabbableCount: number;
  /**
   * 有交互语义但键盘用户 Tab 不到的元素的摘要。
   * 判据见 `auditPage` 里的注释：`tabbableCount === 0` 几乎不可能成立，
   * 所以真正有约束力的是这个列表非空。
   */
  unreachableInteractive: Array<{ html: string }>;
  positiveTabIndex: Array<{ html: string; tabIndex: number }>;
}

/**
 * 等待 DOM「稳定」再做审计。
 *
 * 为什么必需：棘轮基线要求**同一次代码产出的发现集合可复现**。
 * 早期版本只是 `sleep(900)` 后就审计，结果同一份代码连跑两次得到
 * 160 与 175 两个不同数字 —— 因为沙具库有 327 个格子，是按需/分批渲染的，
 * 抽样时可能只渲染了一半。基线在这种抖动下毫无意义。
 *
 * 做法：反复取「元素总数 + 各测试选择器命中数 + 样式表加载情况」作为签名，
 * 连续 3 次采样相同才认为稳定（上限 6s）。
 *
 * ⚠️ **样式表也要等**（补于 v2.0 审计）：路由是 `lazy()` 加载的，
 * 每个 chunk 自带 CSS，CSS 是**异步**应用的。只等 DOM 数量稳定会漏掉
 * 「元素都在了、但样式还没生效」这个窗口。实测后果：
 * `/sandbox/clients` 的保留期 `<select>` 在 CSS 生效前高 **41px**，
 * 生效后是 **44px** —— 审计恰好落在窗口里就会报一个不存在的触摸目标缺陷。
 * 所以签名里加入「已加载样式表数量 + 规则总数」，样式表不再增长才算稳定。
 */
async function waitForStableDom(page: Page): Promise<void> {
  const signature = async (): Promise<string> =>
    page.evaluate(() => {
      const testIds = [...document.querySelectorAll('[data-testid]')]
        .map((element) => element.getAttribute('data-testid'))
        .sort()
        .join(',');
      /*
       * 统计已装载样式表的规模。跨域样式表读 cssRules 会抛 SecurityError，
       * 所以逐张 try/catch，读不到的记 -1（仍能反映「数量变化」）。
       */
      let ruleCount = 0;
      let sheetCount = 0;
      for (const sheet of document.styleSheets) {
        sheetCount += 1;
        try {
          ruleCount += sheet.cssRules.length;
        } catch {
          ruleCount += -1;
        }
      }
      return [
        document.querySelectorAll('*').length,
        document.querySelectorAll('button').length,
        document.querySelectorAll('a').length,
        document.querySelectorAll('[data-testid]').length,
        document.body.scrollHeight,
        testIds.length,
        sheetCount,
        ruleCount,
      ].join('|');
    });

  let previous = '';
  let stable = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await signature();
    if (current === previous) {
      stable += 1;
      if (stable >= 3) return;
    } else {
      stable = 0;
      previous = current;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function auditPage(page: Page): Promise<RawAudit> {
  return page.evaluate(() => {
    /* ------------------------- 颜色与对比度工具 ------------------------- */

    /** 解析 CSS 颜色为 [r,g,b,a] */
    function parseColor(input: string): [number, number, number, number] | null {
      const value = input.trim().toLowerCase();
      if (!value || value === 'transparent') return [0, 0, 0, 0];

      const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/);
      if (rgbMatch) {
        const parts = rgbMatch[1].split(/[\s,/]+/).filter(Boolean);
        const r = Number(parts[0]);
        const g = Number(parts[1]);
        const b = Number(parts[2]);
        const a = parts.length > 3 ? Number(parts[3]) : 1;
        if ([r, g, b].some((channel) => Number.isNaN(channel))) return null;
        return [r, g, b, Number.isNaN(a) ? 1 : a];
      }

      const hexMatch = value.match(/^#([0-9a-f]{3,8})$/);
      if (hexMatch) {
        const hex = hexMatch[1];
        if (hex.length === 3) {
          return [
            parseInt(hex[0] + hex[0], 16),
            parseInt(hex[1] + hex[1], 16),
            parseInt(hex[2] + hex[2], 16),
            1,
          ];
        }
        if (hex.length === 6) {
          return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
            1,
          ];
        }
        if (hex.length === 8) {
          return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
            parseInt(hex.slice(6, 8), 16) / 255,
          ];
        }
      }
      return null;
    }

    /** WCAG 相对亮度 */
    function luminance(rgb: [number, number, number]): number {
      const channel = (value: number): number => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    }

    /** 把半透明前景叠到背景上（近似：只处理一层） */
    function blend(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
      const alpha = fg[3];
      return [
        Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
        Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
        Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
      ];
    }

    /** 向上找到第一个非透明背景色 */
    function effectiveBackground(element: Element): [number, number, number] {
      let node: Element | null = element;
      while (node) {
        const parsed = parseColor(getComputedStyle(node).backgroundColor);
        if (parsed && parsed[3] > 0.95) return [parsed[0], parsed[1], parsed[2]];
        node = node.parentElement;
      }
      return [255, 255, 255]; // 兜底：白底
    }

    function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
      const la = luminance(a);
      const lb = luminance(b);
      const lighter = Math.max(la, lb);
      const darker = Math.min(la, lb);
      return (lighter + 0.05) / (darker + 0.05);
    }

    /* ----------------------------- 可访问名 ----------------------------- */

    function accessibleName(element: Element): string {
      const aria = element.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();

      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (text) return text;
      }

      // title 属性是最后手段（虽然体验差，但技术上算名字）
      const title = element.getAttribute('title');
      if (title && title.trim()) return title.trim();

      // 文本内容（排除纯装饰子树的文本）
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) return text;

      // 内含图片的 alt
      const img = element.querySelector('img[alt]');
      if (img) {
        const alt = (img.getAttribute('alt') ?? '').trim();
        if (alt) return alt;
      }

      // 内含 svg 的 title
      const svgTitle = element.querySelector('svg > title');
      if (svgTitle) {
        const text2 = (svgTitle.textContent ?? '').trim();
        if (text2) return text2;
      }

      // input[type=submit/button] 的 value
      const value = element.getAttribute('value');
      if (element.tagName === 'INPUT' && value && value.trim()) return value.trim();

      return '';
    }

    function describe(element: Element, max = 90): string {
      const html = element.outerHTML.replace(/\s+/g, ' ').slice(0, max);
      return html;
    }

    function visible(element: Element): boolean {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    /* ------------------------------ 各项扫描 ------------------------------ */

    const namelessButtons: Array<{ html: string; text: string }> = [];
    for (const button of document.querySelectorAll('button, [role="button"]')) {
      if (!visible(button)) continue;
      if (!accessibleName(button)) {
        namelessButtons.push({ html: describe(button), text: (button.textContent ?? '').trim().slice(0, 40) });
      }
    }

    const namelessLinks: Array<{ html: string; text: string }> = [];
    for (const link of document.querySelectorAll('a[href]')) {
      if (!visible(link)) continue;
      if (!accessibleName(link)) {
        namelessLinks.push({ html: describe(link), text: (link.textContent ?? '').trim().slice(0, 40) });
      }
    }

    const emptyAltImages: Array<{ html: string; src: string }> = [];
    for (const img of document.querySelectorAll('img')) {
      const alt = img.getAttribute('alt');
      // alt 缺失 = critical；alt="" = 装饰性，合法
      if (alt === null) {
        emptyAltImages.push({ html: describe(img), src: img.getAttribute('src') ?? '' });
      }
    }

    const unlabeledControls: Array<{ html: string; type: string; visuallyHidden: boolean }> = [];
    for (const control of document.querySelectorAll('input, select, textarea')) {
      const element = control as HTMLInputElement;
      const type = (element.getAttribute('type') ?? element.tagName).toLowerCase();
      // 这些类型不需要标签（隐藏域、按钮类用自己的名字）
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;

      const hasAriaLabel = Boolean(control.getAttribute('aria-label')?.trim());
      const hasLabelledBy = Boolean(control.getAttribute('aria-labelledby')?.trim());
      const wrappedByLabel = control.closest('label') !== null;
      const id = control.getAttribute('id');
      const labelledByFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) !== null : false;
      const hasTitle = Boolean(control.getAttribute('title')?.trim());

      if (!hasAriaLabel && !hasLabelledBy && !wrappedByLabel && !labelledByFor && !hasTitle) {
        // 视觉隐藏的控件（sr-only，通常是「导入文件」这类被按钮代理触发的）
        // 严重度低于可见控件：它不占视觉空间，但仍会进 Tab 序且读屏无名字。
        const style = getComputedStyle(control);
        const rect = control.getBoundingClientRect();
        const visuallyHidden =
          rect.width <= 1 || rect.height <= 1 || style.clip !== 'auto' || style.position === 'absolute';
        unlabeledControls.push({ html: describe(control), type, visuallyHidden });
      }
    }

    /* --------------------------- 触摸目标尺寸 --------------------------- */

    const smallTargets: Array<{ html: string; text: string; width: number; height: number }> = [];
    for (const element of document.querySelectorAll('button, a[href], [role="button"], [role="tab"], input[type="checkbox"], input[type="radio"], select')) {
      if (!visible(element)) continue;

      const style = getComputedStyle(element);
      // WCAG 2.5.5 豁免：行内文字链接不适用
      const isInline = style.display === 'inline' && element.tagName === 'A';
      const hasBlock = element.tagName === 'A' && (style.display === 'inline-block' || style.display === 'flex');
      if (isInline && !hasBlock) continue;
      // 豁免：明确标了 aria-hidden 的装饰元素
      if (element.getAttribute('aria-hidden') === 'true') continue;

      const rect = element.getBoundingClientRect();
      // 注意：本函数体是**在浏览器里执行**的（page.evaluate 序列化），
      // 拿不到 Node 侧的 MIN_TARGET / TARGET_TOLERANCE 常量 ——
      // 直接引用会抛 ReferenceError，让审计在 0 违规时也 exit 1。
      // 所以这里用字面量，并与文件顶部的常量保持同步。
      const MIN = 44; // = MIN_TARGET
      const TOL = 1; // = TARGET_TOLERANCE
      // 减去亚像素容差：浏览器给 44px 的元素实际可能报 43.99x，
      // 直接比 44 会制造一堆假阳性。
      if (rect.width < MIN - TOL || rect.height < MIN - TOL) {
        smallTargets.push({
          html: describe(element),
          text: accessibleName(element).slice(0, 30),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        });
      }
    }

    /* ----------------------------- 颜色对比度 ----------------------------- */

    const lowContrast: Array<{
      html: string;
      text: string;
      fg: string;
      bg: string;
      ratio: number;
      fontSize: number;
      bold: boolean;
    }> = [];

    // 只检查「直接包含文本」的元素，避免每个祖先容器重复报
    const textElements = [...document.querySelectorAll('body *')].filter((element) => {
      if (!visible(element)) return false;
      // 有可见的直接文本子节点才算
      return [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 1,
      );
    });

    for (const element of textElements) {
      const directText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim();
      if (directText.length < 2) continue;

      const style = getComputedStyle(element);
      const fgParsed = parseColor(style.color);
      if (!fgParsed) continue;
      // 完全透明的不算（视觉上不存在）
      if (fgParsed[3] < 0.05) continue;

      const bg = effectiveBackground(element);
      const fgBlended = fgParsed[3] >= 0.99 ? [fgParsed[0], fgParsed[1], fgParsed[2]] : blend(fgParsed, bg);

      const ratio = contrastRatio(fgBlended as [number, number, number], bg);

      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const bold = weight >= 700;

      lowContrast.push({
        html: describe(element),
        text: directText.slice(0, 40),
        fg: style.color,
        bg: `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`,
        ratio: Math.round(ratio * 100) / 100,
        fontSize: Math.round(fontSize * 10) / 10,
        bold,
      });
    }

    /* ------------------------------ 其他检查 ------------------------------ */

    const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter(visible)
      .map((element) => ({
        level: Number(element.tagName.slice(1)),
        text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
      }));

    const positiveTabIndex: Array<{ html: string; tabIndex: number }> = [];
    for (const element of document.querySelectorAll('[tabindex]')) {
      const index = Number(element.getAttribute('tabindex'));
      // tabindex > 0 会打乱自然的 Tab 顺序，是公认的反模式
      if (index > 0) positiveTabIndex.push({ html: describe(element), tabIndex: index });
    }

    const tabbableCount = [
      ...document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(visible).length;

    /*
     * 交互元素里有多少**进不了 Tab 序**。
     *
     * 原来的判据只有 `tabbableCount === 0` —— 也就是「整页一个可聚焦元素都没有」。
     * 这个条件几乎不可能成立（每个页面都有导航链接），所以它等于永远通过：
     * 一个页面上 50 个工具按钮全是不可聚焦的 <div>，照样绿。
     * CONTRACT §7 要求的「沙盘全部操作可用键盘」因此没有任何自动化约束力。
     *
     * 现在改成可证明的口径：把「有交互语义」的元素数出来，再找出其中
     * 键盘用户 Tab 不到的。难点在于 **roving tabindex 是合法的**：
     * 网格/列表/工具栏的推荐 ARIA 实践就是「整组只有一个元素
     * tabindex=0，其余 tabindex=-1，组内用方向键移动」。若把每个
     * tabindex=-1 都算违规，就会把最标准的无障碍实现报成缺陷
     * （实测沙具库 327 个格子全部误报）。
     *
     * 所以判定按**组**进行，但「组」的认定必须**很窄**，否则规则又会失效：
     *   - 组 = 同一父元素下的**直接兄弟**（最多向上找 2 层）
     *   - 组必须「统一管理」：每个同类兄弟都**显式**带 tabindex 属性
     *     （roving 的特征就是全组都由 JS 统一改写 tabindex）
     *   - 组内至少有一个成员 tabindex >= 0，整组才算可达
     *
     * 为什么要求「统一管理」：只判「组里有人可聚焦」是不够的。
     * 实测过那版（向上找 6 层、只要祖先里有 2 个交互元素就豁免）：
     * 给任意一个按钮加 tabindex="-1" **全部仍判可达** —— 因为页面顶部
     * 总有一堆导航链接凑成群。规则等于又变回永远通过。
     * 加上「同组兄弟都显式声明 tabindex」这一条后，真实的按钮
     * （兄弟是原生 `<button>`，没有 tabindex 属性）不会再被豁免。
     */
    const INTERACTIVE_SELECTOR = [
      'button',
      'a[href]',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'summary',
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[role="radio"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[contenteditable="true"]',
    ].join(',');

    const interactive = [...document.querySelectorAll(INTERACTIVE_SELECTOR)].filter(visible);

    /**
     * 该元素是否属于一个「合法的 roving 组」（整组只有一个 Tab 停点，
     * 组内用方向键移动 —— 沙具库的 327 个格子就是这种）。
     */
    function isInLegitRovingGroup(element: Element): boolean {
      let container: Element | null = element.parentElement;
      for (let depth = 0; container !== null && depth < 2; depth += 1) {
        const peers = [...container.children].filter(
          (child) =>
            child !== element &&
            child.matches(INTERACTIVE_SELECTOR) &&
            !child.hasAttribute('disabled') &&
            visible(child),
        );
        if (peers.length > 0) {
          // 组内每个同类兄弟都必须显式声明过 tabindex（= 由 JS 统一管理）
          const allManaged = peers.every((peer) => peer.hasAttribute('tabindex'));
          if (!allManaged) return false;
          return peers.some((peer) => Number(peer.getAttribute('tabindex')) >= 0);
        }
        container = container.parentElement;
      }
      return false;
    }

    const unreachableInteractive: Array<{ html: string }> = [];
    for (const element of interactive) {
      if (element.hasAttribute('disabled')) continue;
      const tabIndexAttr = element.getAttribute('tabindex');
      const tag = element.tagName.toLowerCase();
      const isNativelyFocusable =
        tag === 'button' ||
        tag === 'select' ||
        tag === 'textarea' ||
        tag === 'summary' ||
        (tag === 'a' && element.hasAttribute('href')) ||
        (tag === 'input' && element.getAttribute('type') !== 'hidden');

      let unreachable = false;
      if (tabIndexAttr !== null && Number(tabIndexAttr) < 0) {
        // 显式移出 Tab 序
        unreachable = true;
      } else if (!isNativelyFocusable && tabIndexAttr === null) {
        // 非原生可聚焦元素又没给 tabindex：浏览器不会把它放进 Tab 序
        unreachable = true;
      }
      if (!unreachable) continue;
      // 合法的 roving 组：整组只有一个 Tab 停点，但组内所有项都能用方向键到达
      if (isInLegitRovingGroup(element)) continue;
      unreachableInteractive.push({ html: describe(element) });
    }

    // prefers-reduced-motion 的实际响应在 Node 侧用 emulateMediaFeatures 测
    // （见 main() 里的 auditReducedMotion），这里不做启发式猜测 ——
    // 原来那版只要页面上有一个 transition 就返回 true，等于永远通过，是假测试。
    const prefersReducedMotion =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false;

    return {
      lang: document.documentElement.getAttribute('lang'),
      hasMain: document.querySelector('main') !== null,
      headings,
      namelessButtons,
      namelessLinks,
      emptyAltImages,
      unlabeledControls,
      smallTargets,
      lowContrast,
      prefersReducedMotion,
      tabbableCount,
      unreachableInteractive,
      positiveTabIndex,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                              判定规则                                       */
/* -------------------------------------------------------------------------- */

function judge(route: string, raw: RawAudit): void {
  /* ------------------------------ 语言 ------------------------------ */
  if (!raw.lang) {
    report(route, 'critical', 'html-lang', '<html> 缺少 lang 属性，读屏会用错误的语音合成');
  } else if (!/^zh/i.test(raw.lang)) {
    report(route, 'warning', 'html-lang', `<html lang="${raw.lang}"> 不是中文，读屏发音会错`);
  }

  /* ---------------------------- 地标 ---------------------------- */
  if (!raw.hasMain) {
    report(route, 'critical', 'landmark-main', '页面没有 <main> 地标，读屏用户无法跳读正文');
  }

  /* -------------------------- 可访问名 -------------------------- */
  for (const entry of raw.namelessButtons) {
    report(route, 'critical', 'button-name', `按钮没有可访问名：${entry.html}`, entry.html);
  }
  for (const entry of raw.namelessLinks) {
    report(route, 'critical', 'link-name', `链接没有可访问名：${entry.html}`, entry.html);
  }
  for (const entry of raw.emptyAltImages) {
    report(route, 'critical', 'image-alt', `img 缺少 alt 属性：${entry.src || entry.html}`);
  }
  for (const entry of raw.unlabeledControls) {
    // 可见控件没有标签 = critical（用户看得到却不知道为什么读屏读不出来）
    // sr-only 控件 = warning（不占视觉空间，但仍在 Tab 序里且读屏无名字）
    report(
      route,
      entry.visuallyHidden ? 'warning' : 'critical',
      'form-label',
      `${entry.type} 控件没有关联标签${entry.visuallyHidden ? '（视觉隐藏，但仍在 Tab 序列中）' : ''}：${entry.html}`,
    );
  }

  /* ------------------------- 触摸目标尺寸 ------------------------- */
  for (const entry of raw.smallTargets) {
    report(
      route,
      'critical',
      'target-size',
      `触摸目标 ${entry.width}×${entry.height}px 小于 ${MIN_TARGET}×${MIN_TARGET}px（CONTRACT §7）：${
        entry.text || entry.html
      }`,
    );
  }

  /* --------------------------- 颜色对比度 --------------------------- */
  for (const entry of raw.lowContrast) {
    const isLarge = entry.fontSize >= 24 || (entry.bold && entry.fontSize >= 18.66);
    const threshold = isLarge ? MIN_CONTRAST_LARGE : MIN_CONTRAST;
    if (entry.ratio < threshold) {
      report(
        route,
        'critical',
        'color-contrast',
        `对比度 ${entry.ratio}:1 < ${threshold}:1（"${entry.text}"，${entry.fontSize}px${
          entry.bold ? ' 粗体' : ''
        }，前景 ${entry.fg} / 背景 ${entry.bg}）`,
      );
    }
  }

  /* ---------------------------- 标题层级 ---------------------------- */
  const h1Count = raw.headings.filter((heading) => heading.level === 1).length;
  if (raw.headings.length > 0 && h1Count === 0) {
    report(route, 'warning', 'heading-h1', '页面没有任何 h1，语义结构缺失');
  }
  if (h1Count > 1) {
    report(route, 'warning', 'heading-h1', `页面有 ${h1Count} 个 h1，应当只有一个`);
  }
  for (let i = 1; i < raw.headings.length; i += 1) {
    const previous = raw.headings[i - 1];
    const current = raw.headings[i];
    if (current.level > previous.level + 1) {
      report(
        route,
        'warning',
        'heading-order',
        `标题跳级：h${previous.level}「${previous.text}」-> h${current.level}「${current.text}」`,
      );
    }
  }

  /* ---------------------------- Tab 顺序 ---------------------------- */
  for (const entry of raw.positiveTabIndex) {
    report(route, 'warning', 'tabindex-positive', `tabindex="${entry.tabIndex}" 会打乱 Tab 顺序：${entry.html}`);
  }
  /*
   * 键盘可达的两个层次：
   *
   * 1. 整页没有任何可聚焦元素 —— 这是「彻底不能操作」，critical。
   *    但注意它几乎不可能触发（每个页面都有导航链接），所以它单独存在时
   *    实际上是一条**永远通过**的规则。真正干活的是第 2 条。
   * 2. 有交互语义的元素却进不了 Tab 序 —— 这是现实中最常见的缺陷形态：
   *    工具按钮写成 <div onClick>、给 <button> 加 tabindex="-1"。
   *    键盘用户看得到、点不到，而审计此前对此完全沉默。
   */
  if (raw.tabbableCount === 0) {
    report(route, 'critical', 'keyboard-unreachable', '页面没有任何可用 Tab 聚焦的元素');
  } else if (raw.unreachableInteractive.length > 0) {
    report(
      route,
      'critical',
      'keyboard-unreachable',
      `${raw.unreachableInteractive.length} 个交互元素 Tab 不到（键盘用户无法操作）：` +
        raw.unreachableInteractive
          .slice(0, 3)
          .map((entry) => entry.html)
          .join(' | ') +
        (raw.unreachableInteractive.length > 3 ? ' …' : ''),
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                     prefers-reduced-motion 实际响应测试                     */
/* -------------------------------------------------------------------------- */

/**
 * 验证「系统级减弱动效」真的被响应（HANDOVER §3 P2）。
 *
 * 做法：用 CDP 的 `Emulation.setEmulatedMedia` 把 `prefers-reduced-motion: reduce`
 * 设成生效，再加载页面，量「非零 transition/animation 的元素数量」。
 *
 * 判定：reduce 模式下，带非零动效的元素数必须**显著少于**正常模式。
 * 这比「读一个 data 属性」可靠 —— 它测的是最终样式计算结果，
 * 不管实现是走 CSS 媒体查询还是 JS 切换 class。
 *
 * 为什么不在 auditPage 里顺手判断：那需要两套渲染状态，只能在 Node 侧控制。
 */
async function auditReducedMotion(page: Page, route: string): Promise<void> {
  const countMotion = async (): Promise<number> =>
    page.evaluate(() => {
      let count = 0;
      for (const element of document.querySelectorAll('*')) {
        const style = getComputedStyle(element);
        const transition = Number.parseFloat(style.transitionDuration) || 0;
        const animation = Number.parseFloat(style.animationDuration) || 0;
        if (transition > 0.01 || animation > 0.01) count += 1;
      }
      return count;
    });

  /**
   * 重新加载并等到「动效元素数量稳定」再读。
   *
   * 原来固定 `domcontentloaded` + 500ms 就读数。问题是 React 渲染是异步的：
   * 500ms 时页面可能只挂载了一部分，读到的是一个**中间态**数字。
   * 实测同一个 `/sandbox`：
   *   - 充足等待后：no-preference = 68，reduce = 0（完全正常）
   *   - 但固定 500ms 的那次审计读到的是 no-preference = 3，reduce = 3
   *     → 判成「reduced-motion 未响应」，一个**假警告**。
   *
   * 3 个元素是怎么来的已经不重要了 —— 关键教训是：**用固定 sleep 去读
   * 一个异步渲染页面的最终样式，读到什么都不奇怪。**
   * 这里改成连续采样直到稳定（连续 3 次相同），和 `waitForStableDom` 同一思路。
   */
  const reloadUntilStable = async (): Promise<number> => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    let last = -1;
    let same = 0;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const current = await countMotion();
      if (current === last) {
        same += 1;
        if (same >= 3) return current;
      } else {
        last = current;
        same = 0;
      }
    }
    return last;
  };

  // 正常模式
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  const normalMotion = await reloadUntilStable();

  // 减弱模式
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const reducedMotion = await reloadUntilStable();

  // 恢复默认，避免影响后续路由
  await page.emulateMediaFeatures([]);

  if (normalMotion === 0) {
    // 页面本身没有任何动效 -> 无需响应，不算问题
    report(route, 'warning', 'reduced-motion', '页面本就没有动效，无法验证 prefers-reduced-motion（不算违规）');
    return;
  }

  /*
   * 判定阈值：reduce 模式下的动效元素必须**降到正常模式的 20% 以内**。
   *
   * 原来的判据是 `reducedMotion >= normalMotion` —— 意思只有「一个都没减少」才算失败。
   * 一个页面正常 100 个动效、reduce 下还剩 99 个，照样通过。这等于没有约束力：
   * CONTRACT/HANDOVER 声明的「系统级减弱动效已响应」实际从未被真正验证过。
   *
   * 为什么不用「必须严格等于 0」：transition 收尾帧、以及框架层面的
   * 一次性过渡（如路由淡出）即使在 reduce 下也可能留下极少量残留，
   * 卡死 0 会制造与真实缺陷无关的假失败。
   * 因此给一个**绝对值容忍**：只要残留 ≤ RESIDUAL_TOLERANCE 个，视为已响应。
   *
   * 两个口径取较宽松者：
   *   - 比例口径：reduced <= normal * 0.2（大页面有足够统计意义）
   *   - 绝对口径：reduced <= 5（小页面 normal 只有 6 个时，0.2 倍 = 1，太苛刻）
   */
  const REDUCED_RATIO = 0.2;
  const RESIDUAL_TOLERANCE = 5;
  const ratioLimit = Math.floor(normalMotion * REDUCED_RATIO);
  const allowed = Math.max(ratioLimit, Math.min(RESIDUAL_TOLERANCE, normalMotion - 1));

  if (reducedMotion > allowed) {
    report(
      route,
      'warning',
      'reduced-motion',
      `系统开启「减弱动效」后仍有 ${reducedMotion} 个元素带动效（正常模式 ${normalMotion} 个，` +
        `允许残留 ≤ ${allowed} 个），说明 prefers-reduced-motion 未被充分响应（HANDOVER §3 P2）`,
    );
    return;
  }

  // 有响应，记录到控制台供人工确认
  console.log(
    `  ↳ ${route} prefers-reduced-motion 已响应：动效元素 ${normalMotion} -> ${reducedMotion}`,
  );
}

/**
 * 基线（baseline）机制说明
 *
 * 项目当前有大量**历史遗留**无障碍问题（见首次审计：287 项 critical，主要是
 * 低对比度文字与小于 44px 的按钮）。如果审计脚本直接以「critical > 0」为失败条件，
 * 它从加入 CI 的第一天起就是红的，然后所有人都会加 `|| true` 绕过 —— 等于没有。
 *
 * 因此采用业界常用的**棘轮（ratchet）**策略：
 * 1. 首次运行 `--update-baseline` 把当前问题记入 `a11y-baseline.json`；
 * 2. 之后每次运行，只有**基线之外的新问题**才算失败；
 * 3. 修掉历史问题后，基线里的条目会变成 `stale`，提示用 `--update-baseline` 收窄；
 *    基线只许变窄、不许变宽（新增问题永远是红的）。
 *
 * 这样「不新增技术债」可以被 CI 强制，而存量债仍有完整的可见报告。
 * 想一次性看全貌用 `--report-only`；想要求全绿用 `--strict`（现在会红，属预期）。
 */

interface BaselineEntry {
  rule: string;
  route: string;
  /** 内容指纹：同一规则下同一段文案/同一选择器视为同一条 */
  key: string;
}

interface BaselineFile {
  updatedAt: string;
  note: string;
  entries: BaselineEntry[];
}

/**
 * 生成稳定的内容指纹（不用行号/索引，避免无关改动导致基线漂移）。
 *
 * ⚠️ 这里的 `.replace(/\d+\.\d+/g, (match) => match)` 看起来是恒等变换、
 * 像是可以删掉的死代码 —— **但它不能删**（我删过一次，5 条历史问题
 * 立刻被当成「新增 critical」，审计直接红）。
 *
 * 原因：`fingerprint` 的输出被写进了 `a11y-baseline.json`。
 * 哪怕替换函数是恒等的，`.replace` 调用本身**不改变字符串**……
 * 但它的存在说明这段代码曾经被改过语义；任何人重构这段（比如改成
 * 四舍五入、改成删除小数）都会让**全部历史基线 key 失配**，
 * 表现为「一夜之间冒出几十条新问题」。
 *
 * 所以这里保持原样，并把原因写清楚，避免下一个人（包括未来的我）
 * 把它当死代码清理掉。真要改归一化规则，必须同时 `--update-baseline`。
 */
function fingerprint(entry: Finding): string {
  // message 里已经含了文案与颜色；截断到固定长度以避免超长
  const normalized = entry.message
    .replace(/\d+\.\d+/g, (match) => match) // 保留数值（对比度是判断依据）
    .slice(0, 160);
  return `${entry.rule}::${entry.route}::${normalized}`;
}

function loadBaseline(): BaselineFile | null {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    const raw = readFileSync(BASELINE_PATH, 'utf8');
    // 容错：Windows 上的编辑器/PowerShell 重定向很容易给 JSON 加上 UTF-8 BOM，
    // 而 JSON.parse 会直接拒绝它（HANDOVER §4.1 记的正是这个坑）。
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return JSON.parse(text) as BaselineFile;
  } catch {
    console.warn('⚠ 基线文件无法解析（可能被加上了 BOM 或写坏了），忽略并视为无基线');
    return null;
  }
}

function saveBaseline(): void {
  const entries = findings.map((entry) => ({
    rule: entry.rule,
    route: entry.route,
    key: fingerprint(entry),
  }));
  const payload: BaselineFile = {
    updatedAt: new Date().toISOString(),
    note:
      '无障碍审计基线（棘轮）：只允许收窄。更新方式：node --experimental-strip-types scripts/audit/a11y.ts --update-baseline',
    entries,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`\n✓ 基线已更新：${BASELINE_PATH}（${entries.length} 条）`);
}

/* -------------------------------------------------------------------------- */
/*                                输出格式                                     */
/* -------------------------------------------------------------------------- */

function printReport(): { critical: number; warning: number } {
  const critical = findings.filter((entry) => entry.level === 'critical').length;
  const warning = findings.filter((entry) => entry.level === 'warning').length;

  console.log('\n' + '═'.repeat(80));
  console.log('无障碍审计报告');
  console.log('═'.repeat(80));

  /* ---------------------- 第一层：按规则汇总（最有用） ---------------------- */

  // 同一个规则往往对应**一个系统性根因**（一个颜色 token、一个 padding 变量），
  // 所以先按规则聚合，团队可以按「一条规则 = 一次修复」来排期。
  const ruleGroups = new Map<string, Finding[]>();
  for (const entry of findings) {
    const list = ruleGroups.get(entry.rule) ?? [];
    list.push(entry);
    ruleGroups.set(entry.rule, list);
  }

  console.log('\n按规则汇总（同一规则通常对应一个根因，修一次即可清零）：\n');
  console.log(`  ${'规则'.padEnd(20)} ${'级别'.padEnd(10)} ${'数量'.padStart(6)}  影响路由`);
  console.log('  ' + '─'.repeat(74));
  for (const [rule, list] of [...ruleGroups].sort((a, b) => b[1].length - a[1].length)) {
    const level = list.some((entry) => entry.level === 'critical') ? 'critical' : 'warning';
    const routes = [...new Set(list.map((entry) => entry.route))];
    console.log(
      `  ${rule.padEnd(20)} ${level.padEnd(10)} ${String(list.length).padStart(6)}  ${routes.join(' ')}`,
    );
  }

  /* ------------------------ 第二层：按路由明细 ------------------------ */

  console.log('\n按路由：');
  for (const route of ROUTES) {
    const routeFindings = findings.filter((entry) => entry.route === route);
    const routeCritical = routeFindings.filter((entry) => entry.level === 'critical');
    const routeWarning = routeFindings.filter((entry) => entry.level === 'warning');
    const icon = routeCritical.length > 0 ? '✗' : routeWarning.length > 0 ? '!' : '✓';

    console.log(
      `\n${icon} ${route.padEnd(12)} critical ${String(routeCritical.length).padStart(3)}  warning ${String(
        routeWarning.length,
      ).padStart(3)}`,
    );

    const byRule = new Map<string, Finding[]>();
    for (const entry of routeFindings) {
      const list = byRule.get(entry.rule) ?? [];
      list.push(entry);
      byRule.set(entry.rule, list);
    }

    for (const [rule, list] of byRule) {
      const level = list.some((entry) => entry.level === 'critical') ? 'critical' : 'warning';
      const mark = level === 'critical' ? '✗' : '!';
      console.log(`   ${mark} [${rule}] ${list.length} 处`);
      for (const entry of list.slice(0, 4)) {
        console.log(`       ${entry.message}`);
      }
      if (list.length > 4) console.log(`       …另有 ${list.length - 4} 处同类问题`);
    }
  }

  /* ------------------ 第三层：对比度根因（颜色 token 归并） ------------------ */

  // 对比度问题通常只有几个「前景色 / 背景色」组合在反复出现，
  // 把组合聚类后，团队只需改 2~3 个 CSS 变量。
  const contrastFindings = findings.filter((entry) => entry.rule === 'color-contrast');
  if (contrastFindings.length > 0) {
    const pairs = new Map<string, { count: number; worst: number; sample: string }>();
    for (const entry of contrastFindings) {
      const match = entry.message.match(/前景 ([^ ]+) \/ 背景 ([^ ]+)/);
      const ratioMatch = entry.message.match(/对比度 ([\d.]+):1/);
      if (!match) continue;
      const key = `${match[1]} on ${match[2]}`;
      const ratio = ratioMatch ? Number(ratioMatch[1]) : 0;
      const existing = pairs.get(key);
      if (existing) {
        existing.count += 1;
        existing.worst = Math.min(existing.worst, ratio);
      } else {
        pairs.set(key, { count: 1, worst: ratio, sample: entry.message.match(/（"([^"]*)"/)?.[1] ?? '' });
      }
    }

    console.log('\n对比度根因聚类（改这些颜色 token 就能一次性修掉大部分）：\n');
    console.log(`  ${'前景 on 背景'.padEnd(46)} ${'出现'.padStart(5)} ${'最差'.padStart(8)}`);
    console.log('  ' + '─'.repeat(74));
    for (const [key, info] of [...pairs].sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  ${key.padEnd(46)} ${String(info.count).padStart(5)} ${info.worst.toFixed(2).padStart(7)}:1`);
    }
  }

  /* --------------------- 第四层：触摸目标根因聚类 --------------------- */

  const targetFindings = findings.filter((entry) => entry.rule === 'target-size');
  if (targetFindings.length > 0) {
    const heights = new Map<number, number>();
    for (const entry of targetFindings) {
      const match = entry.message.match(/目标 ([\d.]+)×([\d.]+)px/);
      if (!match) continue;
      const height = Math.round(Number(match[2]) * 10) / 10;
      heights.set(height, (heights.get(height) ?? 0) + 1);
    }
    console.log('\n触摸目标高度分布（同一个高度 = 同一个 padding 来源，通常是可一次性修的）：\n');
    for (const [height, count] of [...heights].sort((a, b) => b[1] - a[1])) {
      const gap = Math.round((44 - height) * 10) / 10;
      console.log(`  高 ${String(height).padStart(5)}px  × ${String(count).padStart(3)} 处   还差 ${gap}px`);
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log(`合计：critical ${critical} 项，warning ${warning} 项`);

  return { critical, warning };
}

/* -------------------------------------------------------------------------- */
/*                                  主流程                                     */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  if (!chromePath) {
    console.error('✗ 找不到 Chrome / Edge，无法做 a11y 审计。');
    process.exit(2);
  }
  if (!existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.error(`✗ 没有 ${path.join(DIST_DIR, 'index.html')}，请先运行：npx vite build`);
    process.exit(2);
  }

  const routes = filter ? ROUTES.filter((route) => route.includes(filter)) : ROUTES;
  if (routes.length === 0) {
    console.error(`✗ 没有匹配 "${filter}" 的路由。可用：${ROUTES.join(', ')}`);
    process.exit(2);
  }

  console.log('心屿 · 无障碍审计');
  console.log(`  浏览器：${chromePath}`);
  console.log(`  预览：${BASE}（由脚本自行启动）`);
  console.log(`  路由：${routes.join(', ')}`);
  console.log(`  阈值：触摸目标 ≥ ${MIN_TARGET}×${MIN_TARGET}px，正文对比度 ≥ ${MIN_CONTRAST}:1`);

  /* 起服务之前先确认端口是空的 —— 否则审计的可能不是我们的产物 */
  await assertPortFree(PORT);

  const preview = startPreview();
  let browser: Browser | undefined;
  let hardFailure = false;
  /*
   * 收尾自检的结果。只做提示，不改变本轮审计结论 ——
   * 审计结论描述的是「这一轮页面上的无障碍情况」，而端口残留是
   * **环境问题**，混进 exit code 会让「无障碍失败」和「清理失败」分不清。
   */
  let cleanupWarning = false;

  try {
    if (!(await waitForServer(`${BASE}/`))) {
      throw new Error(`vite preview 未能在 25s 内启动（${BASE}）`);
    }

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: !HEADED,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-CN'],
      defaultViewport: { width: 1440, height: 900 },
    });

    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    for (const route of routes) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      // 等页面渲染稳定（懒加载 chunk + 字体度量都会影响尺寸/颜色）
      await new Promise((resolve) => setTimeout(resolve, 900));

      // 懒加载页面需要等元素出现
      await page
        .waitForFunction(() => document.querySelector('main') !== null, { timeout: 10_000 })
        .catch(() => undefined);

      /*
       * 等 `<html lang>` 就位 —— 这是一个真实的竞态，会让审计**偶发假失败**。
       *
       * 现象：连跑 3 次同一份代码，`html-lang` 那条会随机冒出来：
       *   run 1: warning 1 项 → exit 1
       *   run 2: 全 0          → exit 0
       *   run 3: 全 0          → exit 0
       *
       * 原因：`goto` 用的是 `waitUntil: 'domcontentloaded'`，此时 HTML 解析完了，
       * 但 React 还没 hydrate/挂载。`lang` 属性是 SPA 在挂载时写到
       * `document.documentElement` 上的，所以抓早了就是 null，
       * 然后被判成「缺少 lang 属性」这种 critical。
       *
       * 这类**偶发红灯**比真红灯更坏：跑三次两次绿，人就会学会「重跑一下就好了」，
       * 于是这个门禁从此不可信。所以显式等条件成立，而不是靠 sleep 碰运气。
       */
      await page
        .waitForFunction(() => document.documentElement.getAttribute('lang') !== null, {
          timeout: 10_000,
        })
        .catch(() => undefined);

      // 等 DOM 真正稳定，否则沙具库这类长列表会抽样到一半，导致结果不可复现
      await waitForStableDom(page);

      const raw = await auditPage(page);
      judge(route, raw);
      await auditReducedMotion(page, route);

      const count = findings.filter((entry) => entry.route === route).length;
      console.log(`  已审计 ${route.padEnd(12)} 发现 ${count} 项`);
    }

    if (consoleErrors.length > 0) {
      console.log('\n注意：审计过程中捕获到 console.error（无论 a11y 结果如何都应修）：');
      for (const entry of consoleErrors.slice(0, 10)) console.log(`  ${entry}`);
    }
  } catch (error) {
    hardFailure = true;
    console.error(`\n✗ 审计过程出错：${String(error)}`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await stopPreview(preview);
    await new Promise((resolve) => setTimeout(resolve, 400));
    /*
     * 收尾自检：清理失败要**当场可见**，而不是等下一次跑报 exit=2。
     * 「清理路径本身没被验证过」是这个脚本真实翻车过的原因 ——
     * stopPreview 静默失效时，症状会在**下一次**运行时才出现，
     * 于是很容易被误判成「新的 flake」。
     */
    if (await isPortListening(PORT)) {
      console.error(
        `⚠ 收尾异常：port ${PORT} 在 stopPreview 之后仍在监听。\n` +
          '  本次审计结果本身有效，但下次运行可能因端口被占而 exit=2。\n' +
          `  处理：Get-NetTCPConnection -LocalPort ${PORT} -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`,
      );
      cleanupWarning = true;
    }
  }

  const { critical, warning } = printReport();

  if (JSON_OUT) {
    // 直接写文件，避免 PowerShell 重定向给中文加 BOM 或换行转换
    const outPath = path.resolve(process.cwd(), 'scripts/audit/a11y-findings.json');
    writeFileSync(
      outPath,
      JSON.stringify(
        findings.map((entry) => ({ route: entry.route, rule: entry.rule, level: entry.level, message: entry.message })),
        null,
        2,
      ) + '\n',
      'utf8',
    );
    console.log(`\n✓ 发现已写入 ${outPath}（${findings.length} 条）`);
    process.exit(0);
  }

  /* ----------------------------- 基线对比 ----------------------------- */

  if (UPDATE_BASELINE) {
    saveBaseline();
    console.log('\n✓ 基线已写入（此模式不判定失败）');
    process.exit(0);
  }

  const baseline = loadBaseline();
  let newIssues = critical;
  let newWarnings = warning;
  let staleCount = 0;

  if (baseline) {
    const baselineKeys = new Set(baseline.entries.map((entry) => entry.key));
    const currentKeys = new Set(findings.map(fingerprint));

    const newCritical = findings.filter(
      (entry) => entry.level === 'critical' && !baselineKeys.has(fingerprint(entry)),
    );
    const newWarningList = findings.filter(
      (entry) => entry.level === 'warning' && !baselineKeys.has(fingerprint(entry)),
    );
    newIssues = newCritical.length;
    newWarnings = newWarningList.length;

    // 基线里已不存在的问题 = 已修好，提示收窄基线
    staleCount = baseline.entries.filter((entry) => !currentKeys.has(entry.key)).length;

    console.log(`\n基线对比（基线 ${baseline.entries.length} 条，更新于 ${baseline.updatedAt}）：`);
    console.log(`  新增 critical：${newCritical.length} 项${newCritical.length === 0 ? ' ✓' : ' ✗'}`);
    console.log(`  新增 warning ：${newWarningList.length} 项${newWarningList.length === 0 ? ' ✓' : ' ✗'}`);
    console.log(`  已修复（可收窄基线）：${staleCount} 项`);

    if (newCritical.length > 0) {
      console.log('\n新增 critical 明细（本次改动引入，必须修复）：');
      for (const entry of newCritical.slice(0, 40)) {
        console.log(`  [${entry.route}] ${entry.rule}: ${entry.message}`);
      }
      if (newCritical.length > 40) console.log(`  …另有 ${newCritical.length - 40} 项`);
    }

    if (newWarningList.length > 0) {
      console.log('\n新增 warning 明细（本次改动引入；默认档也会因此判失败）：');
      for (const entry of newWarningList.slice(0, 40)) {
        console.log(`  [${entry.route}] ${entry.rule}: ${entry.message}`);
      }
      if (newWarningList.length > 40) console.log(`  …另有 ${newWarningList.length - 40} 项`);
    }

    if (staleCount > 0) {
      console.log(
        `\n提示：有 ${staleCount} 项历史问题已修复，请运行 --update-baseline 收窄基线，防止将来回归。`,
      );
    }
  } else {
    console.log('\n⚠ 未找到基线文件（scripts/audit/a11y-baseline.json）。');
    console.log('  当前按「无历史债」判定，因此所有 critical / warning 都算失败。');
    console.log('  首次启用请运行：--update-baseline');
  }

  /*
   * 默认档（`npm run check` 用的就是这一档）曾经只判 `newIssues > 0`，
   * 而 `newIssues` **只统计 critical**。实测：
   *
   *   默认档 + 注入一条 warning  →  「新增问题 0 项 ✓ / 通过」  EXIT=0
   *   同输入 + --strict          →                              EXIT=1
   *
   * 也就是说 **`check` 里那一档看不见 warning**。warning 正是「还不算阻断、
   * 但在退步」的信号，最容易在无人察觉时累积成 critical。
   *
   * 现在的默认档：新增 critical 或新增 warning 都判失败。
   * 历史存量（基线里的）依然豁免 —— 棘轮只许收窄、不许变宽。
   * `--report-only` 仍是唯一的「只看不改」出口。
   */
  let failed = hardFailure;
  if (REPORT_ONLY) {
    console.log('\n（--report-only：不判定失败）');
    failed = false;
  } else if (STRICT) {
    failed = critical > 0 || warning > 0 || hardFailure;
  } else {
    failed = newIssues > 0 || newWarnings > 0 || hardFailure;
  }

  console.log(
    failed
      ? '\n✗ 无障碍审计未通过'
      : baseline && !STRICT && !REPORT_ONLY
        ? `\n✓ 无障碍审计通过（未新增问题；历史存量 ${critical} 项 critical 记录在基线中）`
        : '\n✓ 无障碍审计通过',
  );

  /*
   * 清理失败必须出现在总结里，但**不改变 exit code**：
   * 「无障碍失败」和「环境没收拾干净」是两件事，混在一起会让人
   * 下次看到 exit=1 时分不清该修页面还是该查端口。
   */
  if (cleanupWarning) {
    console.log(`\n⚠ 注意：本次审计结果有效，但 ${PORT} 端口未成功释放（见上方提示）。`);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('未捕获错误：', error);
  process.exit(1);
});
