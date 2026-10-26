/**
 * 回放页窄屏与触摸目标核查（375×812，iPhone 尺寸）。
 *
 * 核查项：
 * - 无横向溢出；
 * - 时间轴控件、批注按钮、续接按钮的触摸目标 ≥ 44px；
 * - 分布条在窄屏改成「标签在上、数值在右」两行布局，不挤压；
 * - canvas 仍有可用宽度，且 aria-label 完整；
 * - 批注输入框在窄屏可用。
 *
 * 运行：node scripts/dev/check-replay-mobile.mjs
 */
import { withSandboxPage, report, sleep } from './harness.mjs';

const STORAGE_KEY = 'xinyu.sessions';
const SESSION_ID = 'session_mobile_check';

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
    { t: 7000, type: 'item.remove', itemId: 'b', payload: {} },
    { t: 10000, type: 'scene.change', payload: { sceneId: 'night' } },
  ];
  return {
    id: SESSION_ID,
    at: '2026-10-20T09:00:00.000Z',
    schemaVersion: 2,
    title: '窄屏核查会话',
    mode: 'self',
    sceneId: 'night',
    items: [
      { id: 'a', symbolId: 'tree', x: 0.15, y: 0.7, scale: 1.6, rotation: 0, z: 1 },
    ],
    events,
    locked: false,
    annotations: [
      { id: 'n1', eventIndex: 1, t: 1200, text: '这里放了一棵树，停了很久才继续。', at: '2026-10-20T09:02:00.000Z' },
    ],
  };
}

const results = await withSandboxPage({}, async ({ base, page, record, consoleErrors }) => {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((key, session) => localStorage.setItem(key, JSON.stringify([session])), STORAGE_KEY, buildSession());

  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  await page.goto(`${base}/sandbox/session/${SESSION_ID}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('canvas');
  await sleep(900);

  // ---- 横向溢出 ----
  const overflow = await page.evaluate(() => ({
    docWidth: document.documentElement.scrollWidth,
    winWidth: window.innerWidth,
  }));
  record('窄屏无横向溢出', overflow.docWidth <= overflow.winWidth + 2, `${overflow.docWidth} vs ${overflow.winWidth}`);

  // ---- canvas 仍可用 ----
  const canvasBox = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height), label: canvas.getAttribute('aria-label') ?? '' };
  });
  record('窄屏 canvas 有可用尺寸', canvasBox.width > 200 && canvasBox.height > 120, `${canvasBox.width}×${canvasBox.height}`);
  record('窄屏 canvas 无障碍标签完整', canvasBox.label.includes('件摆件'), canvasBox.label);

  // ---- 触摸目标（CONTRACT §7：≥ 44×44px，容差 1px） ----
  const targets = await page.evaluate(() => {
    const selectors = [
      '.timeline__controls .btn',
      '.timeline__chip',
      '.timeline__filter',
      '.annotation-item__jump',
      '.annotation-item .btn',
      '.replay-page .btn',
    ];
    const out = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // 隐藏元素
        if (rect.height < 43 || rect.width < 43) {
          out.push(`${selector}: ${Math.round(rect.width)}×${Math.round(rect.height)} "${(el.textContent ?? '').trim().slice(0, 10)}"`);
        }
      }
    }
    return out;
  });
  record('窄屏触摸目标 ≥ 44px', targets.length === 0, targets.slice(0, 5).join(' | '));

  // ---- 分布条窄屏布局 ----
  const distLayout = await page.evaluate(() => {
    const row = document.querySelector('.stats-dist__row');
    if (!row) return null;
    const track = row.querySelector('.stats-dist__track');
    const label = row.querySelector('.stats-dist__label');
    const value = row.querySelector('.stats-dist__value');
    const rowRect = row.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const valueRect = value.getBoundingClientRect();
    return {
      rowWidth: Math.round(rowRect.width),
      trackWidth: Math.round(trackRect.width),
      // 窄屏下数值应在轨道右侧、标签在轨道上方
      valueRightOfTrack: valueRect.left >= trackRect.right - 2,
      labelAboveTrack: labelRect.bottom <= trackRect.top + 2,
      noOverflow: rowRect.right <= window.innerWidth + 2,
    };
  });
  record('分布条窄屏存在', distLayout !== null);
  record('分布条不超出视口', distLayout?.noOverflow === true, `row=${distLayout?.rowWidth}`);
  record('分布条数值在轨道右侧', distLayout?.valueRightOfTrack === true);
  record('分布条标签在轨道上方（两行布局）', distLayout?.labelAboveTrack === true);

  // ---- 时间轴控件不溢出 ----
  const controlsOverflow = await page.evaluate(() => {
    const controls = document.querySelector('.timeline__controls');
    if (!controls) return { ok: false, detail: 'missing' };
    const rect = controls.getBoundingClientRect();
    return {
      ok: rect.right <= window.innerWidth + 2 && rect.left >= -2,
      detail: `${Math.round(rect.left)}..${Math.round(rect.right)} / ${window.innerWidth}`,
    };
  });
  record('时间轴控件在视口内', controlsOverflow.ok === true, controlsOverflow.detail);

  // ---- 批注输入框窄屏可用 ----
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('在这一步加批注'))?.click();
  });
  await sleep(400);
  const textareaBox = await page.evaluate(() => {
    const el = document.querySelector('#annotation-input');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(rect.right) };
  });
  record('窄屏批注输入框可用', (textareaBox?.height ?? 0) >= 60, `${textareaBox?.width}×${textareaBox?.height}`);
  record('窄屏批注输入框不溢出', (textareaBox?.right ?? 9999) <= 377, `right=${textareaBox?.right}`);

  // ---- 已有批注的展示 ----
  await page.keyboard.press('Escape').catch(() => {});
  const annotationText = await page.evaluate(() => document.querySelector('.annotation-item__text')?.textContent ?? '');
  record('已有批注正常显示', annotationText.includes('这里放了一棵树'), annotationText.slice(0, 20));

  record('无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
});

process.exitCode = report(results, '回放页窄屏核查');
