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

import { spawn, type ChildProcess } from 'node:child_process';
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
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(command, ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    // Windows 上 npx 是 .cmd，必须走 shell 才能 spawn
    shell: process.platform === 'win32',
    stdio: 'ignore',
    // 独立进程组，便于整组杀掉（vite preview 会再起子进程）
    detached: false,
  });
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
  if (!existsSync(path.resolve(process.cwd(), 'dist/index.html'))) {
    console.error('✗ 没有 dist/index.html，请先运行：npx vite build');
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
