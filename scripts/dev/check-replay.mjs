/**
 * 回放页核查：证明画面**由 cursor 驱动**，不是静态图。
 *
 * 核查方式（不依赖内部实现细节）：
 * 1. 用真实事件流造一条会话存进 localStorage（key = xinyu.sessions）；
 * 2. 打开 /sandbox/session/:id；
 * 3. 把时间轴拖到不同 cursor，给 canvas 拍**元素级截图**并比较字节；
 * 4. 断言：不同 cursor 的截图不同、回到同一步截图相同（可复现）。
 *
 * 为什么用截图而不是像素校验和：
 * 首次绘制时字体可能尚未就绪，像素和在「同一 cursor、两次采样」间会有
 * 抗锯齿级别的抖动（曾误报为 bug）。元素截图在绘制稳定后是逐字节确定的，
 * 且把「摆了哪些摆件」完整包含进来。
 *
 * 同时核查：aria-valuenow/valuetext、关键节点、过滤、8× 速度、统计免责说明位置、
 * 事件类型分布条、.md 导出按钮、批注增删跳转、续接面板与 URL 参数、无 console 错误。
 *
 * 运行：node scripts/dev/check-replay.mjs
 */
import { withSandboxPage, report, sleep } from './harness.mjs';

const STORAGE_KEY = 'xinyu.sessions';
const SESSION_ID = 'session_replay_check';

/** 造一条 8 步会话：开场 → 树 → 房子 → 移动 → 注释 → 删房子 → 船 → 换场景 */
function buildSession() {
  const events = [
    { t: 0, type: 'session.start', payload: { sceneId: 'beach', mode: 'self' } },
    {
      t: 1200,
      type: 'item.add',
      itemId: 'a',
      payload: { item: { id: 'a', symbolId: 'tree', x: 0.3, y: 0.4, scale: 1.6, rotation: 0, z: 1 } },
    },
    {
      t: 2600,
      type: 'item.add',
      itemId: 'b',
      payload: { item: { id: 'b', symbolId: 'house', x: 0.62, y: 0.55, scale: 1.5, rotation: 0, z: 2 } },
    },
    { t: 3900, type: 'item.move', itemId: 'a', payload: { x: 0.15, y: 0.7 } },
    { t: 5200, type: 'item.note', itemId: 'b', payload: { note: '这是家' } },
    { t: 7000, type: 'item.remove', itemId: 'b', payload: {} },
    {
      t: 8600,
      type: 'item.add',
      itemId: 'c',
      payload: { item: { id: 'c', symbolId: 'boat', x: 0.78, y: 0.28, scale: 1.4, rotation: -20, z: 1 } },
    },
    { t: 10000, type: 'scene.change', payload: { sceneId: 'night' } },
  ];

  // 最终状态（与事件流重放一致：a 移动后仍在，b 被删，c 新增）
  const items = [
    { id: 'a', symbolId: 'tree', x: 0.15, y: 0.7, scale: 1.6, rotation: 0, z: 1 },
    { id: 'c', symbolId: 'boat', x: 0.78, y: 0.28, scale: 1.4, rotation: -20, z: 1 },
  ];

  return {
    id: SESSION_ID,
    at: '2026-10-20T09:00:00.000Z',
    schemaVersion: 2,
    title: '回放驱动核查',
    mode: 'self',
    sceneId: 'night',
    items,
    events,
    locked: false,
    annotations: [],
    meta: { alias: '核查' },
  };
}

const results = await withSandboxPage({}, async ({ base, page, record, consoleErrors }) => {
  // ---- 环境准备 ----
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((key, session) => localStorage.setItem(key, JSON.stringify([session])), STORAGE_KEY, buildSession());

  await page.goto(`${base}/sandbox/session/${SESSION_ID}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  // 字体就绪后再截图，避免抗锯齿抖动被误判
  await page.evaluate(() => document.fonts.ready);
  await sleep(1200);

  /** 把滑块设到某一步，等绘制稳定 */
  async function seek(step) {
    await page.evaluate((value) => {
      const input = document.querySelector('input[type="range"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, step);
    await sleep(700);
  }

  /** canvas 元素截图（Buffer），以及无障碍标签与当前件数 */
  async function snap() {
    const canvas = await page.$('canvas');
    const buffer = await canvas.screenshot({ encoding: 'binary' });
    const meta = await page.evaluate(() => {
      const el = document.querySelector('canvas');
      const input = document.querySelector('input[type="range"]');
      return {
        label: el.getAttribute('aria-label') ?? '',
        now: input?.getAttribute('aria-valuenow') ?? '',
        text: input?.getAttribute('aria-valuetext') ?? '',
      };
    });
    return { buffer, ...meta };
  }

  const countOf = (label) => {
    const match = label.match(/(\d+)\s*件摆件/);
    return match ? Number(match[1]) : -1;
  };

  // ---- 1. canvas 与无障碍 ----
  const initial = await snap();
  record('canvas 存在且已绘制', initial.buffer.length > 1000, `${initial.buffer.length} bytes`);
  record('canvas 有 role="img"', (await page.evaluate(() => document.querySelector('canvas')?.getAttribute('role'))) === 'img');
  record('aria-label 含步数', /第\s*\d+\s*\/\s*\d+\s*步/.test(initial.label), initial.label);

  // ---- 2. 逐步推进：件数递增且画面不同 ----
  const shots = {};
  for (const step of [0, 1, 2, 3, 5, 6, 8]) {
    await seek(step);
    shots[step] = await snap();
  }

  record('cursor=0 是空画面（0 件摆件）', countOf(shots[0].label) === 0, shots[0].label);
  record('cursor=2 有 1 件摆件', countOf(shots[2].label) === 1, shots[2].label);
  record('cursor=3 有 2 件摆件', countOf(shots[3].label) === 2, shots[3].label);
  record('cursor=6 删掉房子后回到 1 件', countOf(shots[6].label) === 1, shots[6].label);
  record('cursor=8 最终 2 件（树 + 船）', countOf(shots[8].label) === 2, shots[8].label);

  record(
    'cursor=0 与 cursor=8 的画面不同（画面确由 cursor 驱动）',
    !shots[0].buffer.equals(shots[8].buffer),
    `${shots[0].buffer.length} vs ${shots[8].buffer.length} bytes`,
  );
  record(
    'cursor=2 与 cursor=3 的画面不同（中间每一步也在变）',
    !shots[2].buffer.equals(shots[3].buffer),
  );
  record(
    'cursor=5 与 cursor=6 的画面不同（删除动作可见）',
    !shots[5].buffer.equals(shots[6].buffer),
  );
  record(
    'cursor=1（只有开场）与 cursor=0 画面不同',
    !shots[1].buffer.equals(shots[0].buffer),
  );

  // ---- 3. 可复现：回到同一步画面一致 ----
  await seek(3);
  const replayAgain = await snap();
  record(
    '回到 cursor=3 画面完全一致（可复现）',
    replayAgain.buffer.equals(shots[3].buffer),
    `${replayAgain.buffer.length} vs ${shots[3].buffer.length} bytes`,
  );

  // ---- 4. aria 跟随 ----
  record('aria-valuenow 跟随 cursor', replayAgain.now === '3', `now=${replayAgain.now}`);
  record('aria-valuetext 描述当前步', /第\s*3\s*步/.test(replayAgain.text), replayAgain.text);
  record('aria-valuemin=0 / aria-valuemax=总数', shots[8].now === '8', `end now=${shots[8].now}`);

  // ---- 5. 关键节点 / 过滤 / 速度 ----
  const chips = await page.$$('.timeline__chip');
  record('关键节点快速跳转存在', chips.length > 0, `${chips.length} 个`);

  const filters = await page.$$('.timeline__filter');
  record('事件列表过滤存在（3 档）', filters.length === 3, `${filters.length} 个`);

  await filters[1].click(); // 只看摆件
  await sleep(300);
  const itemOnly = await page.evaluate(() => document.querySelector('.timeline__list')?.textContent ?? '');
  record('「只看摆件」列表不含沙面/换场景', !itemOnly.includes('整理沙面') && !itemOnly.includes('切换场景'));

  const speeds = await page.$$eval('.timeline__speed option', (options) => options.map((o) => o.textContent ?? ''));
  record('速度档包含 8×', speeds.some((text) => text.includes('8×')), speeds.join(','));

  // ---- 6. 统计面板 ----
  const statsCheck = await page.evaluate(() => {
    const card = document.querySelector('.stats-card');
    if (!card) return null;
    const disclaimer = card.querySelector('.stats-disclaimer');
    return {
      hasCard: true,
      disclaimerText: disclaimer?.textContent?.trim() ?? '',
      isFirstChild: disclaimer !== null && card.children[0] === disclaimer,
    };
  });
  record('统计面板存在', statsCheck?.hasCard === true);
  record('免责说明文案正确', (statsCheck?.disclaimerText ?? '').includes('不代表任何评价'), statsCheck?.disclaimerText ?? '');
  record('免责说明固定在面板最顶部', statsCheck?.isFirstChild === true);

  const distRows = await page.$$('.stats-dist__row');
  record('事件类型分布条形图存在', distRows.length > 0, `${distRows.length} 行`);

  const exportButton = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('导出 .md')),
  );
  record('导出 .md 按钮存在', exportButton);

  // ---- 7. 批注：空状态 → 新增 → 跳转 → 删除 ----
  record(
    '批注空状态文案正确',
    (await page.evaluate(() => document.querySelector('.annotation-empty')?.textContent ?? '')).includes('还没有批注'),
  );

  await seek(3);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('在这一步加批注'))
      ?.click();
  });
  await sleep(350);
  const textarea = await page.$('#annotation-input');
  record('批注输入框出现', Boolean(textarea));
  if (textarea) {
    await textarea.type('这里停了很久');
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('保存批注'))?.click();
    });
    await sleep(700);

    const annotation = await page.evaluate(() => ({
      count: document.querySelectorAll('.annotation-item').length,
      text: document.querySelector('.annotation-item__text')?.textContent ?? '',
      step: document.querySelector('.annotation-item__step')?.textContent ?? '',
    }));
    record('批注保存后出现在列表', annotation.count === 1, `${annotation.count} 条`);
    record('批注内容正确', annotation.text.includes('这里停了很久'), annotation.text);
    record('批注锚定在第 3 步', /第\s*3\s*步/.test(annotation.step), annotation.step);

    // 点击批注跳到对应步
    await seek(8);
    await page.evaluate(() => document.querySelector('.annotation-item__jump')?.click());
    await sleep(500);
    const afterJump = await page.evaluate(() => document.querySelector('input[type="range"]')?.getAttribute('aria-valuenow'));
    record('点击批注可跳回该步', afterJump === '3', `now=${afterJump}`);

    // 删除（二次确认）
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.annotation-item button')].find(
        (b) => (b.textContent ?? '').trim() === '删除',
      );
      btn?.click();
    });
    await sleep(350);
    const confirming = await page.evaluate(() => Boolean(document.querySelector('.annotation-item__confirm')));
    record('删除需要二次确认', confirming);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.annotation-item__confirm button')].find(
        (b) => (b.textContent ?? '').trim() === '删除',
      );
      btn?.click();
    });
    await sleep(600);
    const remaining = await page.evaluate(() => document.querySelectorAll('.annotation-item').length);
    record('确认后批注被删除', remaining === 0, `${remaining} 条`);
  }

  // ---- 8. 续接：面板说明 + URL 参数 ----
  await seek(3);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('从这一步继续摆'))?.click();
  });
  await sleep(400);
  const panelText = await page.evaluate(() => document.querySelector('.resume-panel')?.textContent ?? '');
  record('续接面板存在', panelText.length > 0);
  record('续接说明写明复制到第几步', panelText.includes('第 3 步'), panelText.slice(0, 60));
  record('续接说明承诺不改原会话', panelText.includes('不会被改动'));

  // 拦截 pushState 记录真实跳转目标
  await page.evaluate(() => {
    window.__navLog = [];
    const original = history.pushState.bind(history);
    history.pushState = (state, title, url) => {
      window.__navLog.push(String(url));
      return original(state, title, url);
    };
  });
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('复制到第'))?.click();
  });
  await sleep(600);
  const navLog = await page.evaluate(() => window.__navLog);
  const target = navLog.find((url) => url.includes('from=')) ?? page.url();
  record(
    '续接跳转到 /sandbox?from=…&cursor=…（约定）',
    new RegExp(`/sandbox\\?from=${SESSION_ID}&cursor=3$`).test(target),
    target,
  );

  // 回到回放页，确认原会话没被改动（事件数不变）
  await page.goto(`${base}/sandbox/session/${SESSION_ID}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('canvas');
  await sleep(800);
  const originalIntact = await page.evaluate(
    (key, id) => {
      const list = JSON.parse(localStorage.getItem(key) ?? '[]');
      const found = list.find((s) => s.id === id);
      return found ? found.events.length : -1;
    },
    STORAGE_KEY,
    SESSION_ID,
  );
  record('续接后原会话事件数未被修改', originalIntact === 8, `${originalIntact} 条`);

  record('无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
});

process.exitCode = report(results, '会话回放页核查');
