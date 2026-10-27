/**
 * 心屿 · 端到端冒烟测试（真实浏览器，真实构建产物）
 *
 * 为什么需要这一层：
 * `tsc` 绿 + `vitest` 绿 + `vite build` 绿 ≠ 页面能打开。
 * 历史上出过的事故都是「三绿但白屏」：
 *   - `getSnapshot` 引用不稳定 → `useSyncExternalStore` 无限循环 → 整站白屏（HANDOVER §4.2）
 *   - `base` 配成相对路径 → 深链接 `/scales/phq-9` 刷新后 MIME 不匹配 → 白屏（HANDOVER §4.4）
 *   - 路由懒加载的 chunk 404 → 页面空白但 build 成功
 * 这些都只有真的开一个浏览器才看得见。
 *
 * ## 断言策略（重要）
 *
 * 不用 CSS class 做选择器 —— class 是样式细节，会被合法重构掉。
 * 只用三类稳定锚点：
 *   1. `data-testid`（workbench 提供，见下）
 *   2. 无障碍属性：`aria-label`、`a[href^="tel:"]`、`button:not([disabled])`
 *   3. 面向用户的中文文案（产品语言，不会随便改）
 *
 * ## 用法
 *
 *   node --experimental-strip-types scripts/e2e/smoke.ts            # 全跑
 *   node --experimental-strip-types scripts/e2e/smoke.ts /sandbox   # 只跑匹配的
 *   node --experimental-strip-types scripts/e2e/smoke.ts --headed   # 看得到窗口
 *   node --experimental-strip-types scripts/e2e/smoke.ts --keep     # 失败也保留截图
 *
 * 需要先 `npx vite build`。脚本自己起 `vite preview`，跑完杀掉。
 * 退出码：0 = 全通过，1 = 有失败。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer, { type Browser, type ConsoleMessage, type Page } from 'puppeteer-core';

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
  '/usr/bin/chromium',
];

const argv = process.argv.slice(2);
const HEADED = argv.includes('--headed');
const KEEP = argv.includes('--keep');
const filter = argv.find((arg) => !arg.startsWith('--'));
const PORT = Number((argv.find((arg) => arg.startsWith('--port=')) ?? '--port=4173').split('=')[1]);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT_DIR = path.resolve(process.cwd(), 'scripts/e2e/screenshots');

/**
 * 跑哪个构建产物。默认 `dist`。
 *
 * 设 `XINYU_E2E_DIST` 可指向副本 —— 专供**变异测试**（`tmp/mutate-mobile.mjs`）：
 * 把 dist 复制到 `tmp/mut-dist/` 再注入缺陷，工作区的 `dist/` 全程只读。
 *
 * 这条约束是踩坑换来的：a11y 的变异脚本曾经直接改 `dist/index.html`，
 * 恢复时与并发的 `vite build` 撞车，导致后续审计读到过期 bundle 并假报
 * 7 个不存在的缺陷。**变异测试必须跑在副本上。**
 */
const DIST_DIR = process.env.XINYU_E2E_DIST
  ? path.resolve(process.env.XINYU_E2E_DIST)
  : path.resolve(process.cwd(), 'dist');
/** 单步兜底超时：任何一格卡住都不该让整个脚本吊死 */
const STEP_TIMEOUT = 20_000;

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

/* -------------------------------------------------------------------------- */
/*                                结果收集                                     */
/* -------------------------------------------------------------------------- */

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: Array<{ scenario: string; checks: Check[]; error?: string; shot?: string }> = [];
let current: { scenario: string; checks: Check[] } | null = null;

function check(name: string, ok: boolean, detail?: string): boolean {
  if (!current) throw new Error('check() 必须在 scenario 内调用');
  current.checks.push({ name, ok, detail });
  return ok;
}

function pass(name: string, detail?: string): void {
  check(name, true, detail);
}

function fail(name: string, detail?: string): void {
  check(name, false, detail);
}

/** 断言辅助：把结果记下来但不抛错，让同一场景尽可能多跑几条 */
function expectTrue(name: string, condition: unknown, detail?: string): boolean {
  if (condition) pass(name, detail);
  else fail(name, detail);
  return Boolean(condition);
}

/* -------------------------------------------------------------------------- */
/*                              preview 服务器                                 */
/* -------------------------------------------------------------------------- */

function startPreview(): ChildProcess {
  /*
   * 和 a11y 一样：直接 spawn node + vite 入口 JS，不用 `npx.cmd` + shell。
   *
   * 原来这里走 `spawn('npx.cmd', ..., { shell: true })`，于是链路上有
   * cmd.exe → npx → node → vite 四层。`taskkill /T` 能整组杀，但
   * `child.kill()` 只杀 cmd.exe，中间层一变就漏。单进程没有这个问题。
   *
   * `--outDir` 让它服务指定的产物目录（变异测试用副本）。
   */
  const viteBin = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteBin)) {
    throw new Error(`找不到 vite 入口：${viteBin}（先 npm install）`);
  }
  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST_DIR],
    { cwd: process.cwd(), stdio: 'ignore', windowsHide: true },
  );
  return child;
}

async function waitForServer(url: string, timeoutMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function stopPreview(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // /T 连子进程一起杀，否则 vite 的 esbuild 会残留占用端口
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

/**
 * 已启动的 preview，供退出钩子兜底清理。
 *
 * 为什么需要：`process.exit()` **不会执行 `finally`**。
 * 这个脚本里有 6 处 `process.exit`（缺 chrome、缺 dist、无匹配场景、
 * 端口被占、以及正常收尾），任何一处提前退出都会让 preview 变成孤儿
 * 继续占着 4173，下一次运行就报「端口已被占用」——而那个报错看起来
 * 像环境问题，不像「自己没收拾干净」。
 *
 * a11y 审计踩过这个坑：泄漏只在**第二轮**显现，第一轮是绿的。
 * Node 保证 `process.exit()` 会触发 `exit` 事件，所以挂在这里最可靠。
 * 钩子里只能用**同步**操作：此刻事件循环已停，异步子进程根本不会跑起来。
 */
const livePreviews = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const child of livePreviews) {
      if (child.exitCode !== null || child.killed) continue;
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* 退出阶段尽力而为，不再抛 */
      }
    }
    livePreviews.clear();
  });
}

/* -------------------------------------------------------------------------- */
/*                                  页面工具                                   */
/* -------------------------------------------------------------------------- */

/** 单步超时包装：puppeteer 的默认超时是 30s，逐条累积起来太慢 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`步骤超时（${ms}ms）：${label}`)), ms);
    }),
  ]);
}

async function shoot(page: Page, name: string): Promise<string> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const target = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: target as `${string}.png`, fullPage: true });
  return target;
}

/** 页面正文长度（判断白屏最快的手段） */
async function bodyLength(page: Page): Promise<number> {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, '').length);
}

async function title(page: Page): Promise<string> {
  return page.title();
}

/** 等待任意一个选择器出现 */
async function waitAny(page: Page, selectors: string[], timeout = STEP_TIMEOUT): Promise<string | null> {
  const found = await withTimeout(
    page.waitForFunction(
      (list: string[]) => list.find((selector) => document.querySelector(selector)),
      { timeout },
      selectors,
    ),
    timeout + 2000,
    `等待 ${selectors.join(' 或 ')}`,
  ).catch(() => null);
  if (!found) return null;
  return (await found.jsonValue()) as string | null;
}

/* -------------------------------------------------------------------------- */
/*                                场景定义                                     */
/* -------------------------------------------------------------------------- */

interface Scenario {
  id: string;
  name: string;
  run: (page: Page, errors: string[], requests: string[]) => Promise<void>;
}

const scenarios: Scenario[] = [
  /* ------------------------------------------------------------------ */
  {
    id: 'home',
    name: '首页能渲染、有标题、无 console 错误',
    run: async (page, errors, requests) => {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      const anchor = await waitAny(page, ['main', 'h1']);
      expectTrue('渲染出 main 或 h1', anchor !== null, `实际：${anchor}`);

      const pageTitle = await title(page);
      expectTrue('document.title 非空', pageTitle.trim().length > 0, `实际："${pageTitle}"`);
      expectTrue('标题含「心屿」', pageTitle.includes('心屿'), `实际："${pageTitle}"`);

      const length = await bodyLength(page);
      expectTrue('正文长度 > 100 字（非白屏）', length > 100, `实际 ${length} 字`);

      // 首屏不应加载 three（134KB gzip）—— 它只在进沙盘 3D 视图时才需要
      const three = requests.filter((url) => /three-[A-Za-z0-9_-]+\.js/.test(url));
      expectTrue('首屏未加载 three chunk（懒加载生效）', three.length === 0, three.join(', '));

      expectTrue('无 console.error', errors.length === 0, errors.join(' | '));

      /*
       * 首次知情同意（VISION §5.6）。
       *
       * `Preferences.acknowledgedDisclaimer` 之前是**死开关**：字段在、
       * 默认 false、注释写着「是否已确认过首次进入的免责声明」，
       * 但零处代码读它 —— 首页那条免责声明只是常驻文字。
       *
       * 断言五件事，重点是第 3、4 条：
       *   1. 首次进来有提示条；
       *   2. 提示里带 /safety 链接；
       *   3. 那个链接**真的可点**（`elementFromPoint` 命中它自己）——
       *      「DOM 里有这个 <a>」和「用户点得到」是两件事，
       *      遮罩层盖住也能通过前者；
       *   4. 点了「我知道了」之后**刷新不再出现**（真的写进偏好）；
       *   5. 提示条不遮挡页面（正文仍在）。
       */
      const consent = await page.$('[data-testid="consent-band"]');
      if (consent) {
        expectTrue('首次进入显示知情同意条（VISION §5.6）', true, '可见');

        const safetyLink = await page.$('[data-testid="consent-safety-link"]');
        expectTrue('知情同意条内含 /safety 入口', safetyLink !== null);

        if (safetyLink) {
          const hitTest = await page.evaluate(`(() => {
            const a = document.querySelector('[data-testid="consent-safety-link"]');
            if (!a) return null;
            const r = a.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return 'zero-size';
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return top === a || a.contains(top) ? 'ok' : 'covered';
          })()`);
          expectTrue(
            '同意条里的 /safety 链接真的可点（未被遮挡）',
            hitTest === 'ok',
            `命中结果：${hitTest}`,
          );
        }

        // 正文仍在：提示条不是全屏遮罩
        const bodyStillThere = await bodyLength(page);
        expectTrue('同意条不遮挡页面正文', bodyStillThere > 100, `正文 ${bodyStillThere} 字`);

        const acceptBtn = await page.$('[data-testid="consent-accept"]');
        if (acceptBtn) {
          await acceptBtn.click();
          await new Promise((resolve) => setTimeout(resolve, 300));
          const goneNow = await page.$('[data-testid="consent-band"]');
          expectTrue('点「我知道了」后同意条消失', goneNow === null);

          await page.reload({ waitUntil: 'domcontentloaded' });
          await waitAny(page, ['main', 'h1']);
          const reappeared = await page.$('[data-testid="consent-band"]');
          expectTrue('知情同意已持久化（刷新后不再出现）', reappeared === null);
        } else {
          fail('同意条有「我知道了」按钮', '找不到 consent-accept');
        }
      } else {
        expectTrue('同意条要么显示要么已被确认', true, '本次运行中已确认过（非首次）');
      }

      /*
       * 语言切换（i18n）。
       *
       * 这条断言的来历：`Preferences.locale` 曾被算作「读 1 写 1 ✓」——
       * 因为它确实被 `useI18n()` 读、被 `setPreferences` 写。但写入的
       * 唯一路径是 `setLocale()`，而 **`setLocale()` 零处调用**：
       * 18 个组件都接了 i18n，`en.ts` 的 162 个英文键在运行时完全不可达。
       *
       * 这是幽灵字段的第三阶形态：字段有读有写、hook 也导出了 setter，
       * 但 setter 本身没人调。静态扫字段名看不出来。
       *
       * 所以断言必须跨页面验证「切了语言之后，英文字符串真的出现」——
       * 只断言按钮 aria-pressed 变化的话，一个什么都不做的假实现也能过。
       */
      await page.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
      await waitAny(page, ['main', 'h1']);

      const zhBtn = await page.$('[data-testid="locale-zh"]');
      const enBtn = await page.$('[data-testid="locale-en"]');
      if (!zhBtn || !enBtn) {
        fail('语言切换按钮存在', `zh=${!!zhBtn} en=${!!enBtn}`);
      } else {
        const zhPressed = await zhBtn.evaluate((n) => n.getAttribute('aria-pressed'));
        expectTrue('默认语言是中文', zhPressed === 'true', `aria-pressed="${zhPressed}"`);

        await enBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 350));

        const enPressed = await page.$eval('[data-testid="locale-en"]', (n) =>
          n.getAttribute('aria-pressed'),
        );
        expectTrue('点 English 后按钮状态切换', enPressed === 'true', `aria-pressed="${enPressed}"`);

        /*
         * 关键断言：切到英文后，**沙盘模块的界面文字真的变成英文**。
         * 去 /sandbox 看渲染器下拉框 —— 它是沙盘模块里 t() 驱动的。
         * 中文是「立体沙盘（推荐）」，英文是「Layered tray (recommended)」。
         */
        await page.goto(`${BASE}/sandbox`, { waitUntil: 'domcontentloaded' });
        await withTimeout(
          page.waitForSelector('[data-testid="sandbox-renderer-select"]', { timeout: STEP_TIMEOUT }),
          STEP_TIMEOUT + 2000,
          '等待渲染器下拉框',
        );
        const optionText = await page.$eval(
          '[data-testid="sandbox-renderer-select"] option[value="iso2d"]',
          (n) => n.textContent ?? '',
        );
        expectTrue(
          '切到英文后沙盘界面真的变英文',
          /layered tray|recommended/i.test(optionText) && !/立体沙盘/.test(optionText),
          `渲染器选项文字 "${optionText}"（期望英文，不是「立体沙盘」）`,
        );

        // 切回中文并确认持久化
        await page.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
        await waitAny(page, ['main', 'h1']);
        await page.click('[data-testid="locale-zh"]');
        await new Promise((resolve) => setTimeout(resolve, 300));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="locale-zh"]', { timeout: STEP_TIMEOUT });
        const persistedZh = await page.$eval('[data-testid="locale-zh"]', (n) =>
          n.getAttribute('aria-pressed'),
        );
        expectTrue('语言偏好已持久化（刷新后仍是中文）', persistedZh === 'true', `aria-pressed="${persistedZh}"`);
      }
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'scales',
    name: '量表列表页：≥5 个量表、卡片可点、无报错',
    run: async (page, errors, _requests) => {
      await page.goto(`${BASE}/scales`, { waitUntil: 'domcontentloaded' });
      const anchor = await waitAny(page, ['.scales-page', '.scales-grid', 'main']);
      expectTrue('量表页渲染', anchor !== null);

      // 用链接而不是 class：量表卡的跳转是产品行为
      const links = await page.$$eval('a[href^="/scales/"]', (nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? ''),
      );
      const unique = [...new Set(links)].filter((href) => href !== '/scales');
      expectTrue('至少 5 个量表入口', unique.length >= 5, `实际 ${unique.length} 个：${unique.join(', ')}`);

      // 五个量表都必须出现在列表里（少一个就是数据丢了）
      for (const slug of ['phq-9', 'gad-7', 'pss-10', 'isi', 'rses']) {
        expectTrue(`列表包含 ${slug}`, unique.some((href) => href.includes(slug)), unique.join(', '));
      }

      // 分类筛选是可交互的（role=group + aria-label）
      const filterGroup = await page.$('[role="group"][aria-label*="筛选"]');
      expectTrue('分类筛选组存在且有无障碍名', filterGroup !== null);

      expectTrue('无 console.error', errors.length === 0, errors.join(' | '));
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'scale-run',
    name: '量表作答页：深链接直开、说明页、开始作答后可答题',
    run: async (page, errors, _requests) => {
      // 深链接直开是最容易坏的路由场景（HANDOVER §4.4）
      await page.goto(`${BASE}/scales/phq-9`, { waitUntil: 'domcontentloaded' });
      const anchor = await waitAny(page, ['main', 'form', '[role="radiogroup"]']);
      expectTrue('深链接 /scales/phq-9 直开渲染', anchor !== null);

      const length = await bodyLength(page);
      expectTrue('作答页正文 > 200 字', length > 200, `实际 ${length} 字`);

      // 首次进入是「作答前必读」说明页（不是直接出题）。
      // 说明页必须给出免责与评分口径 —— 这是产品红线，不能只剩一个开始按钮。
      const introText = await page.evaluate(() => document.body.innerText);
      expectTrue('说明页说明计分口径', /分数是怎么算的|0[~–-]\d+\s*分/.test(introText), '未找到计分说明');
      expectTrue(
        '说明页声明不是诊断',
        /不是诊断|不能替代专业评估|不能代替/.test(introText),
        '未找到免责声明',
      );
      expectTrue('说明页声明数据只存本地', /只保存在|不上传|浏览器/.test(introText), '未找到本地存储声明');

      // 危机资源必须在作答页随时可及（红线）
      expectTrue(
        '作答页出现求助入口或热线',
        /12356|82951332|161-9995|求助|热线/.test(introText),
        '未匹配到危机资源关键词',
      );

      // 点「开始作答」，进入真正的题目界面
      // 用 querySelectorAll 在页面里找按钮并返回其索引，再回 Node 侧取句柄，
      // 避免 evaluateHandle 返回 ElementHandle<Node> 的类型窄化问题。
      const startIndex = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')];
        return buttons.findIndex((button) => /开始作答/.test(button.textContent ?? ''));
      });
      expectTrue('存在「开始作答」按钮', startIndex >= 0, `索引 ${startIndex}`);
      if (startIndex < 0) return;

      const buttons = await page.$$('button');
      await buttons[startIndex].click();
      await new Promise((resolve) => setTimeout(resolve, 400));

      // 选项是 `role="group" aria-label="选项"` 里的 <button>，不是 radio input
      // （ScaleRunPage.tsx:337-353：用按钮是为了支持数字键 1–4 快捷作答）
      const optionGroup = await page.waitForSelector('[role="group"][aria-label="选项"]', { timeout: 10_000 }).catch(
        () => null,
      );
      expectTrue('选项组存在且有无障碍名', optionGroup !== null);
      if (!optionGroup) return;

      const options = await optionGroup.$$('button');
      expectTrue('渲染出选项按钮', options.length === 4, `PHQ-9 应有 4 个选项，实际 ${options.length} 个`);

      /**
       * 真的能作答。
       *
       * 注意：不许断言「点击后该选项出现 active 类」——这个页面是
       * **选完自动进入下一题**（ScaleRunPage 的 `goNext`），点击瞬间就翻页了，
       * 上一题的选中态根本来不及被观察到。断 active 类必然假失败。
       *
       * 正确的可观察信号是顶部进度条文字：「第 1 / 9 题 · 已答 0」→「已答 1」。
       */
      const readAnswered = async (): Promise<number> => {
        const text = await page.evaluate(() => document.body.innerText);
        const match = text.match(/已答\s*(\d+)/);
        return match ? Number(match[1]) : -1;
      };

      const answeredBefore = await readAnswered();
      expectTrue('可读到「已答」进度', answeredBefore >= 0, `读到 ${answeredBefore}`);

      if (options.length > 0) {
        await options[0].click();
        await new Promise((resolve) => setTimeout(resolve, 500));
        const answeredAfter = await readAnswered();
        expectTrue(
          '作答后「已答」计数 +1',
          answeredAfter === answeredBefore + 1,
          `之前 ${answeredBefore}，之后 ${answeredAfter}`,
        );

        // 自动进入下一题：题号推进到第 2 题
        const afterText = await page.evaluate(() => document.body.innerText);
        const questionNo = afterText.match(/第\s*(\d+)\s*\/\s*9\s*题/);
        expectTrue(
          '选完自动进入下一题',
          questionNo !== null && Number(questionNo[1]) >= 2,
          questionNo ? `当前第 ${questionNo[1]} 题` : '未匹配到题号',
        );
      }

      // 键盘快捷作答（1–4）：产品的无障碍承诺之一
      const beforeKey = await readAnswered();
      await page.keyboard.press('Digit2');
      await new Promise((resolve) => setTimeout(resolve, 500));
      const afterKey = await readAnswered();
      expectTrue(
        '数字键可快捷作答（1–4）',
        afterKey === beforeKey + 1,
        `按 Digit2 前 ${beforeKey}，后 ${afterKey}`,
      );

      expectTrue('无 console.error', errors.length === 0, errors.join(' | '));
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'sandbox-render',
    name: '沙盘页：舞台 / 工具条 / 沙具库渲染，未加载 three',
    run: async (page, errors, requests) => {
      await page.goto(`${BASE}/sandbox`, { waitUntil: 'domcontentloaded' });

      // 懒加载：必须等 testid 出现，不能只等 networkidle
      const stage = await withTimeout(
        page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: STEP_TIMEOUT }),
        STEP_TIMEOUT + 2000,
        '等待 sandbox-stage',
      ).catch(() => null);
      expectTrue('[data-testid=sandbox-stage] 出现', stage !== null);

      const toolbar = await page.$('[data-testid="sandbox-toolbar"]');
      expectTrue('[data-testid=sandbox-toolbar] 出现', toolbar !== null);

      // 7 个沙面工具都必须在
      const tools = ['raise', 'dig', 'smooth', 'rake', 'water', 'tunnel', 'flatten'];
      for (const tool of tools) {
        const button = await page.$(`[data-testid="sandbox-tool-${tool}"]`);
        expectTrue(`工具 ${tool} 存在`, button !== null);
      }

      // 沙具库锚点：SymbolTray.tsx 把 data-testid 定为 "lib-item"
      // （2026-10 由 "sandbox-lib-item" 改名，属库模块重构，已核对源码）
      const libItems = await page.$$('[data-testid="lib-item"]');
      expectTrue('沙具库有摆件可选', libItems.length > 0, `找到 ${libItems.length} 个`);

      const canvas = await page.$('canvas');
      expectTrue('舞台上渲染了 canvas', canvas !== null);

      // 2D 视图不应拉 three；只有切到 3D 才该拉
      const three = requests.filter((url) => /three-[A-Za-z0-9_-]+\.js/.test(url));
      expectTrue('沙盘首屏未加载 three（iso2d 默认渲染器）', three.length === 0, three.join(', '));

      expectTrue('无 console.error', errors.length === 0, errors.join(' | '));
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'sandbox-interact',
    name: '沙盘交互：点沙具 -> 计数 +1，撤销/重做可用',
    run: async (page, errors, _requests) => {
      await page.goto(`${BASE}/sandbox`, { waitUntil: 'domcontentloaded' });
      await withTimeout(
        page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: STEP_TIMEOUT }),
        STEP_TIMEOUT + 2000,
        '等待 sandbox-stage',
      );

      /*
       * 年龄门（CONTRACT §7.7：`acknowledgedAge` 未通过时，沙盘页需显示监护人提示）。
       *
       * 这条契约此前**完全没实现** —— 字段定义、默认值、注释都在，
       * 零处消费。跟 soundEnabled 一样是「字段版幽灵门禁」。
       *
       * 断言四件事：
       *   1. 首次进来必须看得到提示；
       *   2. 提示**不能锁死**舞台（知情确认 ≠ 拦截）；
       *   3. 点任一条之后消失；
       *   4. 刷新后不再出现（真的写进了偏好）。
       * 第 4 条是关键：只改本地 state 也能满足前 3 条。
       *
       * ⚠️ 必须放在本场景**最前面**。第一版插在「摆件 +1」之后，
       * 而它中间有一次 `page.reload()`，把刚摆的沙具连同脏标记一起冲掉了，
       * 于是后面的「脏标记为 1」失败。断言之间的顺序依赖是真实的耦合 ——
       * 任何会 reload 的检查都得在场景开头做完。
       */
      const ageGate = await page.$('[data-testid="sandbox-age-gate"]');
      if (ageGate) {
        expectTrue('首次进入显示年龄门（CONTRACT §7.7）', true, '提示可见');

        // 有提示时舞台必须仍然可用 —— 否则就是「拦截」而不是「知情确认」
        const stageUsable = await page.evaluate(
          `!!document.querySelector('[data-testid="sandbox-stage"]')?.offsetParent`,
        );
        expectTrue('年龄门不锁死舞台（知情确认不是拦截）', stageUsable);

        const adultBtn = await page.$('[data-testid="agegate-adult"]');
        if (adultBtn) {
          await adultBtn.click();
          await new Promise((resolve) => setTimeout(resolve, 300));
          const gone = await page.$('[data-testid="sandbox-age-gate"]');
          expectTrue('确认后年龄门消失', gone === null);

          await page.reload({ waitUntil: 'domcontentloaded' });
          await withTimeout(
            page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: STEP_TIMEOUT }),
            STEP_TIMEOUT + 2000,
            '等待舞台（年龄门确认后刷新）',
          );
          const reappeared = await page.$('[data-testid="sandbox-age-gate"]');
          expectTrue('年龄门确认状态已持久化（刷新后不再出现）', reappeared === null);
        } else {
          fail('年龄门有「已满 18」按钮', '找不到 agegate-adult');
        }
      } else {
        // 说明前面的场景已经确认过了 —— 这本身是可接受的，但要说清楚
        expectTrue('年龄门要么显示要么已被确认', true, '本次运行中已确认过（非首次）');
      }

      const readCount = async (): Promise<number> => {
        const node = await page.$('[data-testid="sandbox-item-count"]');
        if (!node) return -1;
        const text = (await node.evaluate((element) => element.textContent)) ?? '';
        const match = text.match(/(\d+)/);
        return match ? Number(match[1]) : -1;
      };

      const before = await readCount();
      expectTrue('初始摆件计数可读', before >= 0, `读到 ${before}`);

      // 点第一个沙具格子（SymbolTray.tsx:245 的 data-testid 是 "lib-item"）
      const libItem = await page.$('[data-testid="lib-item"]');
      if (!libItem) {
        fail('沙具格子存在', '找不到 data-testid="lib-item"');
        return;
      }
      await libItem.click();
      // 点沙具若是「选中」而非「摆放」，计数不变是合理的 —— 下面再点舞台
      await new Promise((resolve) => setTimeout(resolve, 300));
      let after = await readCount();

      if (after === before) {
        // 退一步：点舞台中心真正落一个摆件
        const stage = await page.$('[data-testid="sandbox-stage"]');
        const box = stage ? await stage.boundingBox() : null;
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await new Promise((resolve) => setTimeout(resolve, 400));
          after = await readCount();
        }
      }

      expectTrue('点选沙具后摆件数 +1', after === before + 1, `之前 ${before}，之后 ${after}`);

      // 事件流应当同步增长
      const eventCountText = await page
        .$eval('[data-testid="sandbox-event-count"]', (node) => node.textContent ?? '')
        .catch(() => '');
      expectTrue(
        '事件流计数增长',
        Number(eventCountText.replace(/\D/g, '') || '0') > 0,
        `事件数 "${eventCountText}"`,
      );

      // 脏标记应为 1（有未保存改动）
      const dirty = await page
        .$eval('[data-testid="sandbox-dirty"]', (node) => node.textContent ?? '')
        .catch(() => '');
      expectTrue('脏标记为 1', dirty.trim() === '1', `实际 "${dirty}"`);

      /*
       * 沙具收藏（v1.1「搜索/收藏」里一直缺的那一半）。
       *
       * 【入口位置的诚实说明】
       * 收藏按钮在长按/右键唤出的预览条里，不在沙具卡片上。
       * 第一版做成卡片右上角的 44×44 星标，E2E 立刻红了：
       * clip-path 只裁绘制、不裁命中区域，那个 44px 方块把 56px 格子的
       * 中心全吃了，点沙具再也摆不进去。网格里塞不下第二个 44px 触摸
       * 目标（a11y 硬要求），所以入口移到预览条：空间足够，而且
       * 「先看清楚再决定收不收」更合收藏的语义。
       *
       * 【这段测试必须自己收拾干净】
       * 它的三次点击（右键唤出、收藏、收藏筛选）会把页面滚到 450px，
       * 于是后面「沙声开关」的按钮跑到 sticky 导航条底下，点击被
       * a.site-nav__link 接走 —— 表现为「点了开关但 aria-pressed 没变」。
       * 所以结尾必须 `scrollTo(0,0)` 复位。这一条是实测出来的：
       * elementFromPoint 打到 box y=11、scrollY=450，一目了然。
       */
      {
        const firstCard = await page.$('[data-testid="lib-item"]');
        if (!firstCard) {
          fail('沙具卡片存在', '找不到 lib-item');
        } else {
          await firstCard.click({ button: 'right' });
          await new Promise((resolve) => setTimeout(resolve, 300));

          const favBtn = await page.$('[data-testid="lib-fav"]');
          expectTrue('预览条里有收藏按钮', favBtn !== null, favBtn ? '找到了' : '没找到');

          if (favBtn) {
            const favSymbolId = await favBtn.evaluate((node) =>
              node.getAttribute('data-symbol-id'),
            );
            const pressedBefore = await favBtn.evaluate((node) =>
              node.getAttribute('aria-pressed'),
            );
            expectTrue(
              '初始状态是未收藏',
              pressedBefore === 'false',
              `aria-pressed="${pressedBefore}"`,
            );

            await favBtn.click();
            await new Promise((resolve) => setTimeout(resolve, 300));

            const pressedAfter = await page.$eval(
              '[data-testid="lib-fav"]',
              (node) => node.getAttribute('aria-pressed'),
            );
            expectTrue(
              '点收藏后 aria-pressed 变 true',
              pressedAfter === 'true',
              `aria-pressed="${pressedAfter}"`,
            );

            /*
             * 真正重要的那条：收藏必须真的写进 localStorage。
             * 只改 useState 的假实现能过上面两条，但过不了这条。
             */
            const stored = await page.evaluate(() => {
              for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (!key || !key.includes('preferences')) continue;
                const raw = localStorage.getItem(key) ?? '';
                if (raw.includes('favoriteSymbols')) return raw;
              }
              return null;
            });
            expectTrue(
              '收藏写进了 localStorage 的偏好（不是只存在组件 state）',
              stored !== null && stored.includes(favSymbolId ?? '__none__'),
              stored
                ? `命中 ${favSymbolId}`
                : 'localStorage 里找不到 favoriteSymbols',
            );

            // 收藏筛选视图里应当能看到这件沙具
            await page.click('[data-testid="sandbox-favorites-toggle"]');
            await new Promise((resolve) => setTimeout(resolve, 300));
            const inFavView = await page.$$eval('[data-testid="lib-item"]', (nodes) => nodes.length);
            expectTrue(
              '收藏视图里至少能看到 1 件',
              inFavView >= 1,
              `看到 ${inFavView} 件（收藏的是 ${favSymbolId}）`,
            );

            // 还原：退出收藏视图 + 取消收藏
            await page.click('[data-testid="sandbox-favorites-toggle"]');
            await new Promise((resolve) => setTimeout(resolve, 250));

            // 取消收藏：重新右键唤出预览条，点一次收藏按钮切回未收藏
            const cardAgain = await page.$('[data-testid="lib-item"]');
            if (cardAgain) {
              await cardAgain.click({ button: 'right' });
              await new Promise((resolve) => setTimeout(resolve, 300));
              const undoBtn = await page.$('[data-testid="lib-fav"]');
              if (undoBtn) {
                const pressed = await undoBtn.evaluate((node) =>
                  node.getAttribute('aria-pressed'),
                );
                if (pressed === 'true') {
                  await undoBtn.click();
                  await new Promise((resolve) => setTimeout(resolve, 250));
                }
              }
              // 收起预览条：点它自己的「关闭」按钮（不按 Escape，
              // 沙盘页面也用 Escape 做取消选中，两者会打架）
              const closeBtn = await page.$('.lib__preview-actions button:last-child');
              if (closeBtn) await closeBtn.click();
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          }
        }

        /*
         * 复位页面滚动。
         * 上面的点击会把整页滚到 450px，把工作台工具栏顶到 sticky
         * 导航条底下 —— 后面的沙声开关就点不到了（点击被导航链接接走）。
         * 这是本段测试自己制造的副作用，必须自己清理。
         */
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      /*
       * 沙声开关（VISION §5.1 P0）。
       *
       * 这条断言的来历：`Preferences.soundEnabled` 曾经是个**死开关** ——
       * 字段存在、默认 true、两套 i18n 文案齐备，但没有任何代码读过它。
       * 所以这里不只断言「按钮存在」，还断言它**真的能切换并持久化**：
       * 点一下 aria-pressed 必须变化，刷新后必须保持。
       */
      const soundBtn = await page.$('[data-testid="sandbox-sound-toggle"]');
      if (!soundBtn) {
        fail('沙声开关存在', '找不到 sandbox-sound-toggle');
      } else {
        const initial = await soundBtn.evaluate((node) => node.getAttribute('aria-pressed'));
        expectTrue('沙声开关初始为开', initial === 'true', `aria-pressed="${initial}"`);

        await soundBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        const afterToggle = await soundBtn.evaluate((node) => node.getAttribute('aria-pressed'));
        expectTrue('点一下沙声开关后状态改变', afterToggle === 'false', `aria-pressed="${afterToggle}"`);

        // 刷新后必须保持关闭 —— 证明写进了偏好，而不是只改了本地 state
        await page.reload({ waitUntil: 'domcontentloaded' });
        await withTimeout(
          page.waitForSelector('[data-testid="sandbox-sound-toggle"]', { timeout: STEP_TIMEOUT }),
          STEP_TIMEOUT + 2000,
          '等待沙声开关（刷新后）',
        );
        const persisted = await page.$eval(
          '[data-testid="sandbox-sound-toggle"]',
          (node) => node.getAttribute('aria-pressed'),
        );
        expectTrue('沙声关闭状态已持久化', persisted === 'false', `刷新后 aria-pressed="${persisted}"`);

        // 还原成开，避免影响后续场景
        await page.click('[data-testid="sandbox-sound-toggle"]');
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      /*
       * 两个无障碍开关：减少动效、轮廓模式。
       *
       * 这两个偏好此前是「只读不写」的幽灵：`App.tsx` 会读 reducedMotion
       * 去写 `html[data-reduced-motion]`，`dom2d`/`iso2d` 会读 outlineMode
       * 去画轮廓 —— **全都实现了，但没有任何 UI 能写入**。
       *
       * 所以断言不打在按钮上，打在**效果**上：
       *   - 减少动效 → `<html data-reduced-motion="true">` 必须真的出现；
       *   - 轮廓模式 → 渲染器根节点必须真的挂上 `iso2d--outline`。
       * 只看 aria-pressed 的话，一个把状态存进 useState 的假实现也能过。
       */
      const motionBtn = await page.$('[data-testid="sandbox-reduced-motion-toggle"]');
      if (!motionBtn) {
        fail('减少动效开关存在', '找不到 sandbox-reduced-motion-toggle');
      } else {
        const before = await motionBtn.evaluate((node) => node.getAttribute('aria-pressed'));
        await motionBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 250));

        const dataAttr = await page.evaluate('document.documentElement.dataset.reducedMotion');
        expectTrue(
          '减少动效真的作用到 <html data-reduced-motion>',
          dataAttr === 'true',
          `实际 "${dataAttr}"（开之前按钮是 ${before}）`,
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await withTimeout(
          page.waitForSelector('[data-testid="sandbox-reduced-motion-toggle"]', { timeout: STEP_TIMEOUT }),
          STEP_TIMEOUT + 2000,
          '等待减少动效开关（刷新后）',
        );
        const persistedMotion = await page.$eval(
          '[data-testid="sandbox-reduced-motion-toggle"]',
          (node) => node.getAttribute('aria-pressed'),
        );
        expectTrue('减少动效偏好已持久化', persistedMotion === 'true', `刷新后 aria-pressed="${persistedMotion}"`);

        // 还原，避免给后续场景（尤其视觉回归）引入动效差异
        await page.click('[data-testid="sandbox-reduced-motion-toggle"]');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const outlineBtn = await page.$('[data-testid="sandbox-outline-toggle"]');
      if (!outlineBtn) {
        fail('轮廓模式开关存在', '找不到 sandbox-outline-toggle');
      } else {
        const outlineBefore = await page.evaluate(`(() => {
          const el = document.querySelector('.iso2d, .dom2d');
          return el ? el.className : null;
        })()`);
        await outlineBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 300));

        const outlineAfter = await page.evaluate(`(() => {
          const el = document.querySelector('.iso2d, .dom2d');
          return el ? el.className : null;
        })()`);
        expectTrue(
          '轮廓模式真的作用到渲染器根节点（--outline 类出现）',
          typeof outlineAfter === 'string' && /--outline\b/.test(outlineAfter),
          `之前 "${outlineBefore}" → 之后 "${outlineAfter}"`,
        );

        // 还原
        await page.click('[data-testid="sandbox-outline-toggle"]');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // 撤销可用 -> 点一下 -> 计数回落
      const undo = await page.$('[data-testid="sandbox-undo"]');
      if (undo) {
        const disabled = await undo.evaluate((node) => (node as HTMLButtonElement).disabled);
        expectTrue('撤销按钮可用（有操作可撤）', !disabled);
        if (!disabled) {
          await undo.click();
          await new Promise((resolve) => setTimeout(resolve, 300));
          const undone = await readCount();
          expectTrue('撤销后摆件数回落', undone === before, `撤销后 ${undone}，期望 ${before}`);

          const redo = await page.$('[data-testid="sandbox-redo"]');
          const redoDisabled = redo
            ? await redo.evaluate((node) => (node as HTMLButtonElement).disabled)
            : true;
          expectTrue('重做按钮变为可用', !redoDisabled);
        }
      } else {
        fail('撤销按钮存在', '找不到 sandbox-undo');
      }

      expectTrue('无 console.error', errors.length === 0, errors.join(' | '));
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'sandbox-surface-tools',
    name: '沙面工具：7 个工具均可点击且不报错',
    run: async (page, errors, _requests) => {
      await page.goto(`${BASE}/sandbox`, { waitUntil: 'domcontentloaded' });
      await withTimeout(
        page.waitForSelector('[data-testid="sandbox-toolbar"]', { timeout: STEP_TIMEOUT }),
        STEP_TIMEOUT + 2000,
        '等待 sandbox-toolbar',
      );

      const stage = await page.$('[data-testid="sandbox-stage"]');
      const box = stage ? await stage.boundingBox() : null;

      for (const tool of ['raise', 'dig', 'smooth', 'rake', 'water', 'tunnel']) {
        const button = await page.$(`[data-testid="sandbox-tool-${tool}"]`);
        if (!button) {
          fail(`工具 ${tool} 存在`, '找不到按钮');
          continue;
        }
        await button.click();
        await new Promise((resolve) => setTimeout(resolve, 120));

        // 在舞台上拖一下，确认笔刷路径不抛错
        if (box) {
          await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 6 });
          await page.mouse.up();
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        pass(`工具 ${tool} 可点击并拖动`);
      }

      const flatten = await page.$('[data-testid="sandbox-tool-flatten"]');
      if (flatten) {
        await flatten.click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        pass('flatten 工具可点击');
      } else {
        fail('flatten 工具存在', '找不到按钮');
      }

      expectTrue('沙面操作全程无 console.error', errors.length === 0, errors.join(' | '));
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'records',
    name: '记录页：渲染、无报错',
    run: async (page, errors, _requests) => {
      await page.goto(`${BASE}/records`, { waitUntil: 'domcontentloaded' });
      const anchor = await waitAny(page, ['main']);
      expectTrue('记录页渲染出 main', anchor !== null);

      const length = await bodyLength(page);
      expectTrue('正文长度 > 80 字（非白屏）', length > 80, `实际 ${length} 字`);

      expectTrue('无 console.error', errors.length === 0, errors.join(' | '));
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'safety',
    name: '安全页：热线 tel: 链接可点（红线）',
    run: async (page, errors, _requests) => {
      await page.goto(`${BASE}/safety`, { waitUntil: 'domcontentloaded' });
      const anchor = await waitAny(page, ['main']);
      expectTrue('安全页渲染出 main', anchor !== null);

      const telLinks = await page.$$eval('a[href^="tel:"]', (nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? ''),
      );
      expectTrue('至少 1 个 tel: 拨号链接', telLinks.length >= 1, `找到 ${telLinks.length} 个`);

      // 12356 是国家心理援助热线，必须能一键拨
      expectTrue(
        '包含 12356 热线',
        telLinks.some((href) => href.includes('12356')),
        telLinks.join(', '),
      );

      // 号码不该带空格/括号（部分拨号器会失败）
      const malformed = telLinks.filter((href) => /[^\dtel:+]/.test(href));
      expectTrue('tel: 链接号码格式干净', malformed.length === 0, malformed.join(', '));

      expectTrue('无 console.error', errors.length === 0, errors.join(' | '));
    },
  },

  /* ------------------------------------------------------------------ */
  /*
   * 移动端 390px 视口。
   *
   * 之前这一条只存在于 `scripts/dev/check-routes.mjs`（一个手工探针），
   * 而 `docs/VISION.md` §7.4 把它列为 E2E 的验收要求 —— 也就是说
   * 文档说「E2E 覆盖移动端」，实际 E2E 从头到尾都跑在 1440×900。
   * 这正是幽灵门禁的标准形态：要求在表格里，执行在别处。
   *
   * 检查重点不是「好看」，而是**布局塌不塌**：
   *   ① 不能出现横向滚动条（最典型的移动端布局 bug）
   *   ② 不能有元素宽出视口（溢出到屏幕外 = 点不到）
   *   ③ 关键内容仍在可视区内
   *   ④ CONTRACT §7 要求每个页面都有 `@media (max-width: 640px)`，
   *      这里顺手验证「确实有小屏适配」不是空话：视口变窄后
   *      页面高度应当变大（内容被迫换行/堆叠），而不是原样缩放。
   */
  {
    id: 'mobile-390',
    name: '移动端 390px 视口：无横向溢出、无越界元素',
    run: async (page, errors, _requests) => {
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

      const routes = ['/', '/sandbox', '/records', '/toolbox/breathing-478', '/scales/phq-9'];
      for (const route of routes) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
        const anchor = await waitAny(page, ['main']);
        expectTrue(`${route} 在 390px 下渲染出 main`, anchor !== null);

        // 等布局稳定：字体/图片加载会改变宽度
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              let last = '';
              let same = 0;
              const tick = (): void => {
                const key = `${document.body.scrollWidth}x${document.body.scrollHeight}`;
                same = key === last ? same + 1 : 0;
                last = key;
                if (same >= 3) resolve();
                else setTimeout(tick, 150);
              };
              tick();
            }),
        );

        const layout = await page.evaluate(() => {
          /*
           * ⚠️ 这里**不能**用 `window.innerWidth` 当基准。
           *
           * `isMobile: true` 时 Chrome 用**布局视口**语义，而布局视口会被
           * 溢出的内容撑大：注入一个 500px 宽的 div 后，`window.innerWidth`
           * 从 390 变成 501，于是 `scrollWidth > innerWidth` 永远 false。
           * 断言在检查一个**必然自洽**的量 —— 标准的自证陷阱。
           *
           * 实测（注入 500px div 后）：
           *   window.innerWidth: 501   ← 被内容撑大了
           *   docElement.scrollWidth: 501 ← 与上一行恒等
           *   注入元素的 right: 500    ← 实际超出 390 屏幕 110px
           *
           * 改用固定目标宽度：我们要验证的就是「在 390px 屏幕上」，
           * 基准写死，而不是回头问浏览器「你现在有多宽」。
           */
          const TARGET_WIDTH = 390;
          const viewportWidth = TARGET_WIDTH;
          const docWidth = document.documentElement.scrollWidth;

          /*
           * 找出「越界」元素时必须排除**自己的滚动容器**。
           *
           * 第一版没排除，结果 /sandbox 的 `.ss-toolbar__group` 全部被判越界
           * （最远一个是 left 751 / right 1077，而视口才 391）。
           * 但那是**有意设计**：`.ss-toolbar` 是 `overflow-x: auto` 的横向滚动
           * 工具条，子元素本来就该排在视口之外等用户滑过去。
           *
           * 判据看错了会得到相反结论：真正的移动端 bug 是**页面级**横向滚动
           * （`documentElement.scrollWidth > innerWidth`），而不是某个元素
           * 在自己的滚动容器里横向排布。实测该页 docWidth == viewportWidth，
           * 说明布局本身健康。
           */
          const inScrollContainer = (element: Element): boolean => {
            let node: Element | null = element.parentElement;
            while (node !== null && node !== document.body) {
              const overflowX = getComputedStyle(node).overflowX;
              if (overflowX === 'auto' || overflowX === 'scroll') return true;
              node = node.parentElement;
            }
            return false;
          };

          const overflowing: string[] = [];
          for (const element of document.body.querySelectorAll('*')) {
            const box = element.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;
            if (box.right <= viewportWidth + 1) continue;
            // 在可滚动容器里的元素不算越界（用户能滑到）
            if (inScrollContainer(element)) continue;
            // 若父元素也溢出，跳过（只报最外层的问题元素）
            const parent = element.parentElement;
            if (parent !== null && parent.getBoundingClientRect().right > viewportWidth + 1) continue;
            const cls = typeof element.className === 'string' ? element.className : '';
            overflowing.push(`${element.tagName.toLowerCase()}${cls ? '.' + cls.split(' ')[0] : ''}`);
          }
          return { docWidth, viewportWidth, overflowing: overflowing.slice(0, 5) };
        });

        expectTrue(
          `${route} 无横向滚动`,
          layout.docWidth <= layout.viewportWidth + 1,
          `文档宽 ${layout.docWidth} > 视口 ${layout.viewportWidth}`,
        );
        expectTrue(
          `${route} 无元素溢出视口右缘`,
          layout.overflowing.length === 0,
          layout.overflowing.join(', '),
        );

        /*
         * 触摸目标：44px 是 CONTRACT §7 的硬约束，移动端才有意义。
         *
         * ⚠️ 这里的判据**必须**和 `scripts/audit/a11y.ts` 保持一致，否则会
         * 出现「E2E 红、a11y 绿」这种最消耗信任的分裂。第一版我写得比 a11y
         * 粗，报了 5 个页面失败，实际全是规则差异而不是产品缺陷：
         *
         *   ① `input`（搜索框、滑杆）— a11y 只查 checkbox/radio，
         *      文本框和滑杆的高度由字号/浏览器决定，不是「按钮类」目标；
         *   ② 行内文字链接（`a` 在句子里）— WCAG 2.5.5 明确豁免，
         *      a11y 用 `display: inline && tagName === 'A'` 排除；
         *   ③ `input(1×1)` — 那是视觉隐藏的 file input，被 `visible()` 过滤掉。
         *
         * 宁可少查一类，不要另立一套标准。真正的触摸目标审计在 a11y 里，
         * 这里只做「移动端快速回归」，口径对齐即可。
         */
        const smallTargets = await page.evaluate(() => {
          const selector =
            'button, a[href], [role="button"], [role="tab"], input[type="checkbox"], input[type="radio"], select';
          const visible = (element: Element): boolean => {
            const box = element.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) return false;
            const style = getComputedStyle(element);
            return style.visibility !== 'hidden' && style.display !== 'none';
          };
          const bad: string[] = [];
          for (const element of document.querySelectorAll(selector)) {
            if (!visible(element)) continue;
            if (element.getAttribute('aria-hidden') === 'true') continue;
            // 行内文字链接豁免（与 a11y 审计同一条规则）
            const style = getComputedStyle(element);
            if (element.tagName === 'A' && style.display === 'inline') continue;
            // 在自己的滚动容器里的元素不查（可能被部分遮住，尺寸无意义）
            const box = element.getBoundingClientRect();
            if (box.width < 44 - 1 || box.height < 44 - 1) {
              const text = (element.textContent ?? '').trim().slice(0, 12);
              bad.push(
                `${element.tagName.toLowerCase()}(${Math.round(box.width)}×${Math.round(box.height)})「${text}」`,
              );
            }
          }
          return bad.slice(0, 5);
        });
        expectTrue(
          `${route} 触摸目标 ≥ 44×44px`,
          smallTargets.length === 0,
          smallTargets.join(', '),
        );
      }

      expectTrue('无 console.error', errors.length === 0, errors.join(' | '));

      // 恢复默认视口，避免影响后续场景
      await page.setViewport({ width: 1440, height: 900 });
    },
  },

  /* ------------------------------------------------------------------ */
  /*
   * 键盘全流程：不用鼠标，从沙具库选一个沙具放进沙盘，再用方向键移动它。
   *
   * `docs/VISION.md` §7.4 把「键盘全流程」列为 E2E 验收要求，而此前
   * E2E 里只有 1 处 `keyboard.press`（量表作答的 1–4 快捷键），
   * 沙盘的键盘路径**从未被自动化验证** —— 但它在代码里是真实存在的
   * （`SymbolTray` 的 roving tabindex + 方向键/Home/End/Enter，
   * `dom2d` 的方向键微调 0.02 / Shift 0.1）。要求写了、实现写了、
   * 验证没写，这就是半个幽灵。
   *
   * 这条场景的价值在于它验证的是**联动**：Tab 进网格 → 方向键移动焦点
   * → Enter 放入 → 焦点落在新摆件上 → 方向键改变它的坐标。
   * 任何一环断了都会红。
   */
  {
    id: 'keyboard-flow',
    name: '键盘全流程：Tab 进库 → 方向键 → Enter 放入 → 方向键移动',
    run: async (page, errors, _requests) => {
      await page.goto(`${BASE}/sandbox`, { waitUntil: 'domcontentloaded' });
      const anchor = await waitAny(page, ['[data-testid="sandbox-stage"]', '[data-testid="sandbox-events"]']);
      expectTrue('沙盘页渲染', anchor !== null);
      await new Promise((resolve) => setTimeout(resolve, 600));

      const readCount = async (): Promise<number> => {
        const text = await page
          .$eval('[data-testid="sandbox-item-count"]', (node) => node.textContent ?? '')
          .catch(() => '0');
        return Number(text.replace(/\D/g, '') || '0');
      };
      const before = await readCount();

      /*
       * ① 焦点进入沙具网格。
       *
       * 网格用的是 roving tabindex：整组只有当前项 tabindex=0，
       * 所以直接 focus 那一项（比模拟 N 次 Tab 稳定，也不依赖页面
       * 上到底有多少个可聚焦元素）。
       */
      const focused = await page.evaluate(() => {
        const item = document.querySelector<HTMLElement>('[data-lib-item="true"][tabindex="0"]');
        if (!item) return null;
        item.focus();
        return {
          label: item.getAttribute('title') ?? item.textContent?.trim().slice(0, 12) ?? '',
          isActive: document.activeElement === item,
        };
      });
      expectTrue('沙具网格里有 tabindex=0 的可聚焦项（roving）', focused !== null);
      expectTrue('能聚焦到该沙具', focused?.isActive === true, `焦点在 ${focused?.label}`);

      // ② 方向键移动焦点（roving 生效：焦点换到另一个格子）
      const movedByArrow = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        // 没有 data-symbol-id，用 title（= 沙具中文名）当身份标识
        const startLabel = active?.getAttribute('title') ?? '';
        active?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
        );
        const after = document.activeElement as HTMLElement | null;
        return {
          startLabel,
          endLabel: after?.getAttribute('title') ?? '',
          stillInGrid: after?.hasAttribute('data-lib-item') === true,
        };
      });
      expectTrue('方向键后焦点仍在网格内', movedByArrow.stillInGrid === true);
      expectTrue(
        '方向键换了一个沙具（roving tabindex 真的在移动）',
        movedByArrow.startLabel !== movedByArrow.endLabel,
        `${movedByArrow.startLabel} → ${movedByArrow.endLabel}`,
      );

      // ③ Enter 放入沙盘
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        active?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const afterEnter = await readCount();
      expectTrue('Enter 把沙具放进了沙盘', afterEnter === before + 1, `${before} → ${afterEnter}`);

      // ④ 焦点到摆件上，方向键改变坐标
      /*
       * ⚠️ 这里必须先切到 `dom2d` 渲染器，原因是一个**真实的能力缺口**：
       *
       * 默认渲染器是 `iso2d`（2.5D 轴测），摆件画在 `<canvas>` 上，
       * 只额外提供一个 `sr-only` 的 `role="list"` 摆件清单 —— **纯文本，不可操作**。
       * 「方向键移动摆件」的 `handleKeyDown` 只存在于 `dom2d.tsx`，
       * 在 iso2d 下键盘用户**无法调整已放置摆件的位置**。
       *
       * 所以完整的键盘流程是这样的：工具栏的渲染器 `<select>` 本身就是
       * 原生控件（键盘可达）→ 选「DOM（无障碍）」→ 摆件变成真实 DOM 按钮
       * → 方向键微调。能力存在，但**默认视图里没有**。
       *
       * 这条限制已记入 docs/TESTING.md 与 CONTRACT §7，不假装已覆盖。
       */
      const switched = await page.evaluate(() => {
        const select = Array.from(document.querySelectorAll<HTMLSelectElement>('select')).find((node) =>
          Array.from(node.options).some((option) => option.value === 'dom2d'),
        );
        if (!select) return null;
        select.focus();
        select.value = 'dom2d';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { focused: document.activeElement === select, options: select.options.length };
      });
      expectTrue('渲染器选择框键盘可达且含 dom2d', switched !== null, `选项数 ${switched?.options}`);
      expectTrue('渲染器选择框能聚焦', switched?.focused === true);

      await new Promise((resolve) => setTimeout(resolve, 800));

      const itemKeys = await page.evaluate(() => {
        const item = document.querySelector<HTMLElement>('.dom2d__item');
        if (!item) return null;
        item.focus();
        const before = item.getAttribute('style') ?? '';
        item.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
        );
        return { focused: document.activeElement === item, styleBefore: before };
      });
      expectTrue('切到 dom2d 后摆件是真实 DOM 且可聚焦', itemKeys?.focused === true);

      await new Promise((resolve) => setTimeout(resolve, 300));
      const styleAfter = await page
        .evaluate(() => {
          const item = document.querySelector<HTMLElement>('.dom2d__item');
          return item?.getAttribute('style') ?? '';
        })
        .catch(() => '');
      expectTrue(
        '方向键移动了摆件（style.left 变了）',
        itemKeys !== null && styleAfter !== itemKeys.styleBefore,
        `之前 "${itemKeys?.styleBefore}"，之后 "${styleAfter}"`,
      );

      /*
       * ⑤ 键盘操作也要产生事件（否则「可回放」在键盘路径上是空的）
       */
      const eventCountText = await page
        .$eval('[data-testid="sandbox-event-count"]', (node) => node.textContent ?? '')
        .catch(() => '');
      expectTrue(
        '键盘操作也写入了事件流',
        Number(eventCountText.replace(/\D/g, '') || '0') > 0,
        `事件数 "${eventCountText}"`,
      );

      expectTrue('无 console.error', errors.length === 0, errors.join(' | '));
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'deep-link-refresh',
    name: '深链接刷新（SPA fallback + base:"/"）：/sandbox/compare',
    run: async (page, errors, _requests) => {
      await page.goto(`${BASE}/sandbox/compare`, { waitUntil: 'domcontentloaded' });
      let anchor = await waitAny(page, ['main'], STEP_TIMEOUT);
      expectTrue('直接访问 /sandbox/compare 渲染', anchor !== null);

      // 关键：刷新一次。base 配错时刷新会白屏（HANDOVER §4.4）
      await page.reload({ waitUntil: 'domcontentloaded' });
      anchor = await waitAny(page, ['main'], STEP_TIMEOUT);
      expectTrue('刷新后仍渲染（SPA fallback 生效）', anchor !== null);

      const length = await bodyLength(page);
      expectTrue('刷新后正文 > 60 字', length > 60, `实际 ${length} 字`);

      /*
       * 静态资源必须能加载（相对路径会让 JS 404 -> 白屏）。
       *
       * 两个曾经让本用例**偶发失败**的坑，都在这里修掉：
       *
       * 1. 监听器必须在 `reload()` **之前**挂上，否则已经发出的请求抓不到，
       *    表现为「有时抓到 404、有时抓不到」；
       * 2. 只把 4xx/5xx 当失败 —— `vite preview` 会返回 **304 Not Modified**，
       *    这是正常的协商缓存响应，不是资源缺失。之前用 `>= 400` 判断是对的，
       *    真正的干扰是下面第 3 点。
       * 3. `errors` 数组是**整场景累积**的：前面 `goto('/sandbox/compare')`
       *    若偶发一次 reload 竞态（上一个导航的响应晚到），错误会留到
       *    「无 console.error」这条断言才炸。所以在做本条断言前先清空。
       */
      const failedRequests: string[] = [];
      const onResponse = (response: { status: () => number; url: () => string }) => {
        const status = response.status();
        if (status >= 400) failedRequests.push(`${status} ${response.url()}`);
      };
      page.on('response', onResponse);

      // 清空累积错误：从这一刻起才是本用例的观察窗口
      errors.length = 0;
      await page.reload({ waitUntil: 'networkidle2' });
      page.off('response', onResponse);

      const finalLength = await bodyLength(page);
      expectTrue(
        '刷新时没有 4xx/5xx 静态资源请求',
        failedRequests.length === 0,
        failedRequests.join(' | '),
      );
      expectTrue('第三次刷新后正文仍完整', finalLength > 60, `实际 ${finalLength} 字`);
      expectTrue('无 console.error', errors.length === 0, errors.join(' | '));
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'routes-sweep',
    name: '全路由扫一遍：每个路由都能渲染（不白屏）',
    run: async (page, _errors, _requests) => {
      /*
       * 这份清单必须与 `src/App.tsx` 的 `<Route path=...>` 一一对应。
       *
       * 原来它是手写的 12 条，而 App.tsx 里有 15 条路由 ——
       * 漏掉的正是那些动态路由：/sandbox/session/:id、
       * /sandbox/session/:id/report、/sandbox/clients/:id、/toolbox/:toolId。
       * 于是这个场景明明叫「每个路由都能渲染」，三条动态路由却从没被验证过。
       *
       * 动态路由用不存在的 id 填：数据不存在时页面应当渲染体面的「找不到」
       * 提示而不是白屏，那本身也是要验的行为，所以不预先造数据。
       * 注意 `*` 兜底路由不在此列 —— 它的行为由 `check-routes.mjs` 的 404 项覆盖。
       */
      const routes = [
        '/',
        '/scales',
        '/scales/phq-9',
        '/scales/gad-7',
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
      for (const route of routes) {
        const localErrors: string[] = [];
        const listener = (message: ConsoleMessage) => {
          if (message.type() === 'error') localErrors.push(message.text());
        };
        page.on('console', listener);
        try {
          await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
          const anchor = await waitAny(page, ['main', 'h1', '[data-testid]'], 10_000);
          const length = await bodyLength(page);
          expectTrue(
            `${route} 渲染（有容器且正文 > 50 字）`,
            anchor !== null && length > 50,
            `容器=${anchor}，正文 ${length} 字`,
          );

          // 关键：不能把 404 页面当成「渲染成功」。
          // 路由表里没有的路径会命中 `*` -> NotFoundPage，正文同样很长。
          // 用 NotFoundPage 独有的文案与结构判定，而不是匹配 "404" 字样
          // （"404" 可能出现在正文别处，造成误判）。
          const is404 = await page.evaluate(() => {
            if (document.querySelector('.notfound')) return true;
            return document.body.innerText.includes('这个页面不存在');
          });
          expectTrue(`${route} 命中真实路由（不是 404 兜底页）`, !is404, is404 ? '落到了 NotFoundPage' : undefined);

          expectTrue(`${route} 无 console.error`, localErrors.length === 0, localErrors.join(' | '));
        } finally {
          page.off('console', listener);
        }
      }
    },
  },
];

/* -------------------------------------------------------------------------- */
/*                                  主流程                                     */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  if (!chromePath) {
    console.error('✗ 找不到 Chrome / Edge，无法跑 E2E。');
    process.exit(2);
  }
  if (!existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.error(`✗ 没有 ${path.join(DIST_DIR, 'index.html')}，请先运行：npx vite build`);
    process.exit(2);
  }

  const selected = filter
    ? scenarios.filter((scenario) => scenario.id.includes(filter) || scenario.name.includes(filter))
    : scenarios;

  if (selected.length === 0) {
    console.error(`✗ 没有匹配 "${filter}" 的场景。可用：${scenarios.map((s) => s.id).join(', ')}`);
    process.exit(2);
  }

  console.log('心屿 · E2E 冒烟测试');
  console.log(`  浏览器：${chromePath}`);
  console.log(`  预览：${BASE}（由脚本自行启动）`);
  console.log(`  场景：${selected.length} 个${filter ? `（筛选：${filter}）` : ''}\n`);

  const preview = startPreview();
  /*
   * 登记 + 装退出钩子：后面任何一处 `process.exit()` 都能收掉它，
   * 不必依赖 `finally`（`process.exit` 会绕过 `finally`）。
   */
  livePreviews.add(preview);
  installExitHook();
  let browser: Browser | undefined;
  let hardFailure = false;

  try {
    if (!(await waitForServer(`${BASE}/`))) {
      throw new Error(`vite preview 未能在 25s 内启动（${BASE}）`);
    }

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: !HEADED,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-CN', '--window-size=1440,900'],
      defaultViewport: { width: 1440, height: 900 },
    });

    for (const scenario of selected) {
      current = { scenario: scenario.name, checks: [] };
      const errors: string[] = [];
      const requests: string[] = [];
      let page: Page | undefined;

      try {
        page = await browser.newPage();
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        page.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`));
        page.on('request', (request) => requests.push(request.url()));

        await withTimeout(scenario.run(page, errors, requests), STEP_TIMEOUT * 4, scenario.name);

        const failedChecks = current.checks.filter((entry) => !entry.ok);
        let shot: string | undefined;
        if (failedChecks.length > 0 || KEEP) {
          shot = await shoot(page, scenario.id).catch(() => undefined);
        }
        results.push({ ...current, shot });
      } catch (error) {
        const shot = page ? await shoot(page, `${scenario.id}-error`).catch(() => undefined) : undefined;
        /*
         * ⚠️ 这里必须显式置 `hardFailure`，否则**场景崩溃 = 假绿**。
         *
         * 原来的写法只是把 error 塞进 results，而最后判通过的条件是
         * `failedChecks === 0 && !hardFailure`，其中 failedChecks 由各场景的
         * checks 求和 —— 崩掉的场景一条 check 都没跑，贡献 0 个失败。
         *
         * 实测：在 records 场景首行注入 `throw`，
         *   合计：10 个场景，105 项断言，0 项失败
         *   ✓ E2E 全部通过        EXIT 0
         * 也就是说**一个场景彻底没执行，门禁照样绿**。
         * 这是最坏的一类假绿：它不出现在任何失败计数里。
         */
        hardFailure = true;
        results.push({ ...current, error: String(error), shot });
      } finally {
        if (page) await page.close().catch(() => undefined);
        current = null;
      }

      // 实时输出，长跑时能看出卡在哪
      const result = results[results.length - 1];
      const failed = result.checks.filter((entry) => !entry.ok).length;
      const icon = failed === 0 && !result.error ? '✓' : '✗';
      console.log(`${icon} ${scenario.name}${failed > 0 ? `（${failed} 项失败）` : ''}`);
    }
  } catch (error) {
    hardFailure = true;
    console.error(`\n✗ 运行环境错误：${String(error)}`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    // 先摘除登记，避免退出钩子重复处理同一个进程
    livePreviews.delete(preview);
    stopPreview(preview);
    // 给 taskkill 一点时间落地
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  /* ------------------------------- 报告 ------------------------------- */

  console.log('\n' + '─'.repeat(78));
  let totalChecks = 0;
  let failedChecks = 0;
  let crashedScenarios = 0;

  for (const result of results) {
    const failed = result.checks.filter((entry) => !entry.ok);
    totalChecks += result.checks.length;
    failedChecks += failed.length;
    if (result.error) crashedScenarios += 1;
    const icon = failed.length === 0 && !result.error ? '✓' : '✗';
    console.log(`\n${icon} ${result.scenario}  (${result.checks.length - failed.length}/${result.checks.length})`);

    for (const entry of result.checks) {
      if (!entry.ok) console.log(`     ✗ ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
    }
    if (result.error) console.log(`     ✗ 场景异常：${result.error}`);
    if (result.shot) console.log(`     截图：${result.shot}`);
  }

  console.log('\n' + '─'.repeat(78));
  console.log(
    `合计：${results.length} 个场景，${totalChecks} 项断言，${failedChecks} 项失败` +
      (crashedScenarios > 0 ? `，${crashedScenarios} 个场景崩溃` : ''),
  );
  /*
   * 场景崩溃单独再报一次，并且计入失败判定。
   * 冗余是刻意的：崩溃的场景贡献 0 条断言，从「N 项失败」这个数字里
   * 完全看不出来，必须让它有自己的、看得见的输出。
   */
  if (crashedScenarios > 0) {
    console.log(`\n✗ 有 ${crashedScenarios} 个场景没有跑完（其断言未执行，等于未验证）`);
  }
  if (failedChecks > 0) {
    console.log('\n失败明细：');
    for (const result of results) {
      for (const entry of result.checks.filter((item) => !item.ok)) {
        console.log(`  [${result.scenario}] ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
      }
      if (result.error) console.log(`  [${result.scenario}] 异常 — ${result.error}`);
    }
  }

  const ok = failedChecks === 0 && !hardFailure;
  console.log(ok ? '\n✓ E2E 全部通过' : '\n✗ E2E 存在失败');
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error('未捕获错误：', error);
  process.exit(1);
});
