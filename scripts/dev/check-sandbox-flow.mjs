/**
 * 沙盘交互端到端验证。
 *
 * 这是最有价值的一条脚本：它验证的不是"页面能打开"，
 * 而是"产品真的能用"——摆件能放、沙面能推、撤销能生效、
 * 封盘后锁定、保存后能回放。
 *
 * 用法：node scripts/dev/check-sandbox-flow.mjs [--shot-dir=dir]
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
const port = Number((args.find((arg) => arg.startsWith('--port=')) ?? '--port=4175').split('=')[1]);
const base = `http://127.0.0.1:${port}`;

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error('找不到 Chrome / Edge。');
  process.exit(2);
}

const preview = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(port), '--strictPort'],
  { cwd: process.cwd(), shell: process.platform === 'win32', stdio: 'ignore' },
);

let browser;
const fails = [];
const steps = [];
function check(name, ok, detail = '') {
  steps.push(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`);
}

async function waitForServer(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  if (!(await waitForServer(`${base}/`))) throw new Error('preview 启动超时');
  if (shotDir) mkdirSync(shotDir, { recursive: true });

  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--lang=zh-CN'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  // 清掉上一轮遗留的本地数据，保证起点干净
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    indexedDB.deleteDatabase('xinyu-db');
  });

  /* ------------------------------ 1. 打开沙盘 ------------------------------ */
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 15000 });
  await sleep(600);
  check('沙盘舞台渲染', true);

  const readCount = async () => {
    const text = await page.$eval('[data-testid="sandbox-item-count"]', (el) => el.textContent ?? '');
    const match = text.match(/(\d+)/);
    return match ? Number(match[1]) : -1;
  };
  const readEvents = async () =>
    Number(await page.$eval('[data-testid="sandbox-event-count"]', (el) => el.textContent ?? '0'));

  const before = await readCount();
  check('初始摆件数为 0', before === 0, `实际 ${before}`);

  /* ----------------------------- 2. 放入沙具 ------------------------------ */
  const libItems = await page.$$('[data-testid="lib-item"]');
  check('沙具库有可点条目', libItems.length > 0, `${libItems.length} 个`);

  await libItems[0].click();
  await sleep(400);
  const afterFirst = await readCount();
  check('点一个沙具后摆件数 +1', afterFirst === before + 1, `${before} → ${afterFirst}`);

  // 再放两个
  const items2 = await page.$$('[data-testid="lib-item"]');
  await items2[2].click();
  await sleep(250);
  await items2[5].click();
  await sleep(400);
  const afterThree = await readCount();
  check('连续放入后共 3 件', afterThree === 3, `实际 ${afterThree}`);

  const eventsAfterAdd = await readEvents();
  check('事件流记录了放入操作', eventsAfterAdd >= 3, `事件数 ${eventsAfterAdd}`);

  if (shotDir) await page.screenshot({ path: join(shotDir, 'flow-1-items.png') });

  /* ----------------------------- 3. 选中与检查器 --------------------------- */
  const hasInspector = await page.$('[aria-label="摆件属性"]');
  check('选中后出现属性面板', Boolean(hasInspector));

  // 改缩放
  /*
   * 用 React 的 value setter 触发，而不是直接 `input.value = '2'`。
   * React 劫持了 input 的 value 属性，直接赋值不会触发 onChange ——
   * 这是「脚本改了但界面没反应」的经典原因。
   */
  if (hasInspector) {
    const sliders = await page.$$('[aria-label="摆件属性"] input[type="range"]');
    check('属性面板有 3 个滑块', sliders.length >= 3, `实际 ${sliders.length}`);
    if (sliders[0]) {
      await sliders[0].evaluate((el) => {
        const input = /** @type {HTMLInputElement} */ (el);
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(input, '2');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(500);
      const eventsAfterScale = await readEvents();
      check('改大小产生了事件', eventsAfterScale > eventsAfterAdd, `${eventsAfterAdd} → ${eventsAfterScale}`);
    }
  }

  /* ------------------------------ 4. 撤销重做 ------------------------------ */
  const eventsBeforeUndo = await readEvents();
  await page.click('[data-testid="sandbox-undo"]');
  await sleep(400);
  const afterUndo = await readCount();
  const eventsAfterUndo = await readEvents();
  check(
    '撤销生效（cursor 回退，事件数不变）',
    eventsAfterUndo === eventsBeforeUndo && afterUndo <= afterThree,
    `事件 ${eventsAfterUndo}，摆件 ${afterUndo}`,
  );

  await page.click('[data-testid="sandbox-redo"]');
  await sleep(400);
  const afterRedo = await readCount();
  check('重做恢复到 3 件', afterRedo === 3, `实际 ${afterRedo}`);

  await page.click('[data-testid="sandbox-undo"]');
  await sleep(300);
  await page.click('[data-testid="sandbox-redo"]');
  await sleep(300);

  /* ------------------------------ 5. 沙面绘制 ------------------------------ */
  const stage = await page.$('[data-testid="sandbox-stage"]');
  const box = await stage.boundingBox();
  check('舞台有可测尺寸', Boolean(box && box.width > 100), box ? `${Math.round(box.width)}×${Math.round(box.height)}` : 'none');

  const brushBtn = await page.$('[data-testid="sandbox-tool-raise"]');
  check('推沙工具存在', Boolean(brushBtn));
  if (brushBtn && box) {
    await brushBtn.click();
    await sleep(300);

    /*
     * 落笔点必须同时满足两个条件，两个都踩过坑：
     *
     * 1. **避开已摆放的摆件**：走到这一步托盘上已有 3 件，它们就在中心附近。
     *    落在摆件上会走「拖动摆件」分支，沙面事件数不动。
     * 2. **落在托盘有效区内**：iso2d 托盘是**平行四边形**（`TRAY_ASPECT` +
     *    等距投影），外接矩形的左上角和右下角其实在托盘外面。在那种位置
     *    `toNormalized()` 返回 null，同样不落笔。
     *
     * 所以不猜坐标，改为**逐个试几个候选点**：每个都真拖一笔，
     * 事件数涨了就说明落点有效、直接跳出。这比硬编码一个「魔法坐标」稳，
     * 因为托盘几何、摆件位置、窗口尺寸任何一个变了它都还能自己找到地方。
     */
    const candidates = [
      { fx: 0.5, fy: 0.5 },
      { fx: 0.35, fy: 0.55 },
      { fx: 0.62, fy: 0.42 },
      { fx: 0.45, fy: 0.68 },
      { fx: 0.28, fy: 0.45 },
      { fx: 0.7, fy: 0.6 },
    ];

    const strokeAt = async (fx, fy) => {
      const sx = box.x + box.width * fx;
      const sy = box.y + box.height * fy;
      const before = await readEvents();
      await page.mouse.move(sx - 40, sy);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) {
        await page.mouse.move(sx - 40 + i * 7, sy + Math.sin(i / 2) * 18);
        await sleep(16);
      }
      await page.mouse.up();
      await sleep(500);
      return { before, after: await readEvents() };
    };

    let strokeResult = { before: 0, after: 0 };
    let usedPoint = null;
    for (const point of candidates) {
      strokeResult = await strokeAt(point.fx, point.fy);
      if (strokeResult.after > strokeResult.before) {
        usedPoint = point;
        break;
      }
    }

    check(
      '一笔沙面绘制产生了事件',
      strokeResult.after > strokeResult.before,
      usedPoint
        ? `${strokeResult.before} → ${strokeResult.after}（落点 ${usedPoint.fx},${usedPoint.fy}）`
        : `${strokeResult.before} → ${strokeResult.after}（6 个候选点都没落笔）`,
    );
    // 注意：不要在这里再 `mouse.up()` —— `strokeAt` 内部已经抬起了。
    // 多抬一次会抛 `'left' is not pressed`，把整个脚本打断在第 5 步。
    await sleep(400);

    // 再挖一条（复用上面探测出来的有效落点，换个偏移量避免完全重叠）
    const digBtn = await page.$('[data-testid="sandbox-tool-dig"]');
    if (digBtn && usedPoint) {
      await digBtn.click();
      await sleep(200);

      const before = await readEvents();
      const sx = box.x + box.width * usedPoint.fx + 45;
      const sy = box.y + box.height * usedPoint.fy + 25;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let i = 1; i <= 8; i += 1) {
        await page.mouse.move(sx + i * 6, sy - i * 5);
        await sleep(16);
      }
      await page.mouse.up();
      await sleep(500);

      const after = await readEvents();
      check('挖沙工具可用', after > before, `${before} → ${after}`);
    }
    if (shotDir) await page.screenshot({ path: join(shotDir, 'flow-2-surface.png') });
  }

  /* ------------------------------- 6. 保存 -------------------------------- */
  /*
   * 注意：`sandbox-save` 只是**打开**保存面板，面板里还要再点一次「保存沙盘」
   * 才是真正提交。早期这个脚本只点了第一步，于是「保存后本机有会话数据」
   * 一直是 0 —— 看上去像保存功能坏了，其实是脚本少点了一下。
   * （这个坑之所以值得留注释，是因为它差点让我误判线上有 bug。）
   */
  await page.click('[data-testid="sandbox-save"]');
  await sleep(800);

  const titleInput = await page.$('input[placeholder="给这个沙盘起个名字"]');
  if (titleInput) {
    await titleInput.click({ clickCount: 3 });
    await titleInput.type('夜间的海');
    await sleep(200);
  }

  // 面板内真正的提交按钮：同名按钮有 2 个（工具条 1 个 + 面板 1 个），取最后一个
  const submitted = await page.evaluate(() => {
    const matches = [...document.querySelectorAll('button')].filter(
      (b) => (b.textContent ?? '').trim() === '保存沙盘',
    );
    if (matches.length === 0) return false;
    matches[matches.length - 1].click();
    return true;
  });
  check('保存面板可提交', submitted, '找「保存沙盘」按钮');
  await sleep(1800);

  const savedSessions = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const found = keys.find((key) => key.includes('session'));
    if (!found) return 0;
    try {
      const raw = JSON.parse(localStorage.getItem(found) ?? 'null');
      if (Array.isArray(raw)) return raw.length;
      if (raw && Array.isArray(raw.items)) return raw.items.length;
      return 0;
    } catch {
      return 0;
    }
  });
  check('保存后本机有会话数据', savedSessions > 0, `${savedSessions} 条`);

  /* -------------------------- 7. 记录页能看到它 --------------------------- */
  await page.goto(`${base}/records`, { waitUntil: 'networkidle2' });
  await sleep(800);
  const recordsText = await page.evaluate(() => document.body.innerText);
  check('记录页出现沙盘条目', recordsText.includes('沙盘'), recordsText.includes('夜间的海') ? '含标题' : '');

  if (shotDir) await page.screenshot({ path: join(shotDir, 'flow-3-records.png') });

  /* ----------------------------- 8. 封盘锁定 ------------------------------ */
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 15000 });
  await sleep(600);
  const lockBtn = await page.$('[data-testid="sandbox-lock"]');
  check('封盘按钮存在', Boolean(lockBtn));
  if (lockBtn) {
    await lockBtn.click();
    await sleep(500);
    const dialogText = await page.evaluate(() => document.body.innerText);
    check('封盘弹确认框', dialogText.includes('封盘'), '');

    // 确认封盘：找到弹层里最后一个「封盘」按钮
    const confirmed = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const buttons = Array.from(dialog.querySelectorAll('button'));
      const target = buttons.find((button) => (button.textContent ?? '').trim() === '封盘');
      if (target) {
        target.click();
        return true;
      }
      return false;
    });
    check('确认封盘', confirmed);
    await sleep(700);

    const afterLockText = await page.evaluate(() => document.body.innerText);
    check('封盘后显示已封盘', afterLockText.includes('已封盘'));
    check('封盘后保存按钮消失', !(await page.$('[data-testid="sandbox-save"]')));
    check('封盘后沙面工具条消失', !(await page.$('[data-testid="sandbox-toolbar"]')));

    if (shotDir) await page.screenshot({ path: join(shotDir, 'flow-4-locked.png') });
  }

  /* ----------------------------- 9. 回放页能开 ---------------------------- */
  const firstSessionId = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const found = keys.find((key) => key.includes('session'));
    if (!found) return null;
    try {
      const raw = JSON.parse(localStorage.getItem(found) ?? 'null');
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return list[0]?.id ?? null;
    } catch {
      return null;
    }
  });
  if (firstSessionId) {
    await page.goto(`${base}/sandbox/session/${firstSessionId}`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    const replayText = await page.evaluate(() => document.body.innerText);
    check('回放页渲染', replayText.length > 100, `${replayText.length} 字`);
    check(
      '回放页有免责说明',
      replayText.includes('不是诊断') || replayText.includes('诠释') || replayText.includes('解释'),
    );
    if (shotDir) await page.screenshot({ path: join(shotDir, 'flow-5-replay.png') });

    await page.goto(`${base}/sandbox/session/${firstSessionId}/report`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    const reportText = await page.evaluate(() => document.body.innerText);
    check('记录单页渲染', reportText.length > 100, `${reportText.length} 字`);
    if (shotDir) await page.screenshot({ path: join(shotDir, 'flow-6-report.png') });
  } else {
    check('能取到已保存会话 id', false, 'localStorage 里没找到');
  }

  /* --------------------------- 10. 无 console 错误 ------------------------ */
  const realErrors = consoleErrors.filter(
    (entry) => !/favicon|ResizeObserver loop|Download the React DevTools/i.test(entry),
  );
  check('全流程无 console 错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (error) {
  fails.push(`脚本异常: ${error}`);
  steps.push(` FAIL  脚本异常 — ${error}`);
} finally {
  if (browser) await browser.close();
  preview.kill();
}

console.log('\n=== 沙盘交互流程 ===');
steps.forEach((line) => console.log(line));
console.log(`\n结果：${fails.length === 0 ? '全部通过' : `${fails.length} 项失败`}`);
if (fails.length > 0) {
  console.log('失败项：');
  fails.forEach((entry) => console.log(`  - ${entry}`));
}
process.exit(fails.length === 0 ? 0 : 1);
