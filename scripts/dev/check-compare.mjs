/**
 * 对比页核查：并排快照 + 事实差异清单 + 窄屏布局。
 *
 * 核查项：
 * - 恰好选 2 次时出现两张并排 canvas（各自的最终画面）；
 * - 差异清单只列事实，且不含任何评价性词汇；
 * - 两列「并排数字」存在；
 * - 窄屏（375px）下并排改为单列、无横向溢出；
 * - 触摸目标 ≥ 44px；
 * - 无 console 错误。
 *
 * 运行：node scripts/dev/check-compare.mjs
 */
import { withSandboxPage, report, sleep } from './harness.mjs';

const STORAGE_KEY = 'xinyu.sessions';

function item(id, symbolId, x, y, extra = {}) {
  return { id, symbolId, x, y, scale: 1.4, rotation: 0, z: 1, ...extra };
}

function makeSession(id, title, at, sceneId, items, events) {
  return {
    id,
    at,
    schemaVersion: 2,
    title,
    mode: 'self',
    sceneId,
    items,
    events,
    locked: false,
  };
}

function sessionEvents(sceneId, itemList) {
  const events = [{ t: 0, type: 'session.start', payload: { sceneId, mode: 'self' } }];
  let t = 1000;
  for (const entry of itemList) {
    events.push({ t, type: 'item.add', itemId: entry.id, payload: { item: entry } });
    t += 1000;
  }
  return events;
}

const first = (() => {
  const items = [
    item('a', 'tree', 0.25, 0.35),
    item('b', 'house', 0.65, 0.6),
  ];
  return makeSession('cmp_a', '第一次', '2026-10-20T09:00:00.000Z', 'beach', items, sessionEvents('beach', items));
})();

const second = (() => {
  const items = [
    item('a', 'tree', 0.2, 0.3),
    item('c', 'boat', 0.75, 0.35),
    item('d', 'mountain', 0.5, 0.15),
  ];
  return makeSession('cmp_b', '第二次', '2026-10-26T09:00:00.000Z', 'night', items, sessionEvents('night', items));
})();

const results = await withSandboxPage({}, async ({ base, page, record, consoleErrors }) => {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((key, list) => localStorage.setItem(key, JSON.stringify(list)), STORAGE_KEY, [first, second]);

  await page.goto(`${base}/sandbox/compare`, { waitUntil: 'networkidle0' });
  await sleep(600);

  // ---- 1. 不选时没有并排 ----
  record('初始没有并排快照', (await page.$$('.compare-pair__grid canvas')).length === 0);

  // ---- 2. 选两次 ----
  const picks = await page.$$('.compare-pick');
  record('会话选择列表有两项', picks.length === 2, `${picks.length} 项`);
  for (const pick of picks) {
    await pick.click();
    await sleep(200);
  }
  await page.evaluate(() => document.fonts.ready);
  await sleep(1000);

  const canvasCount = await page.$$eval('.compare-pair__grid canvas', (nodes) => nodes.length);
  record('选中两次后出现并排两张 canvas', canvasCount === 2, `${canvasCount} 张`);

  // 两张画面应不同（不同会话的最终画面）
  const pairBuffers = [];
  for (const handle of await page.$$('.compare-pair__grid canvas')) {
    pairBuffers.push(await handle.screenshot({ encoding: 'binary' }));
  }
  record(
    '两张并排画面内容不同',
    pairBuffers.length === 2 && !pairBuffers[0].equals(pairBuffers[1]),
    `${pairBuffers[0]?.length} vs ${pairBuffers[1]?.length} bytes`,
  );

  // ---- 3. 两张 canvas 各自有 aria-label 且标出步数 ----
  const labels = await page.$$eval('.compare-pair__grid canvas', (nodes) =>
    nodes.map((n) => n.getAttribute('aria-label') ?? ''),
  );
  record(
    '并排画面各有无障碍标签',
    labels.length === 2 && labels.every((label) => label.includes('件摆件')),
    labels.join(' || '),
  );

  // ---- 4. 差异清单 ----
  const diffCheck = await page.evaluate(() => {
    const card = document.querySelector('.compare-diff');
    if (!card) return null;
    const rows = [...card.querySelectorAll('.compare-diff__table tbody tr')].map((tr) =>
      [...tr.querySelectorAll('th,td')].map((cell) => cell.textContent?.trim() ?? ''),
    );
    return { text: card.textContent ?? '', rows };
  });
  record('差异清单存在', diffCheck !== null);
  record('差异清单有多行事实', (diffCheck?.rows.length ?? 0) >= 5, `${diffCheck?.rows.length} 行`);

  const factNames = (diffCheck?.rows ?? []).map((row) => row[0]);
  record('包含摆件数一行', factNames.includes('摆件数'), factNames.join(','));
  record('包含场景一行', factNames.includes('场景'));

  // 摆件数：第一次 2 件 → 第二次 3 件，变化应为 +1
  const itemRow = (diffCheck?.rows ?? []).find((row) => row[0] === '摆件数');
  record('摆件数前后值正确', itemRow?.[1] === '2' && itemRow?.[2] === '3', itemRow?.join(' / ') ?? '');
  record('摆件数差值带符号', itemRow?.[3] === '+1', itemRow?.[3] ?? '');

  // 场景应显示「换场景」
  const sceneRow = (diffCheck?.rows ?? []).find((row) => row[0] === '场景');
  record('场景变化显示为换场景', sceneRow?.[3] === '换场景', sceneRow?.join(' / ') ?? '');

  // ---- 5. 伦理红线：不得出现评价性词汇 ----
  const pageText = await page.evaluate(() => document.body.textContent ?? '');
  const banned = ['进步', '退步', '改善', '恶化', '健康度', '好转', '变差', '变得更好'];
  const found = banned.filter((word) => pageText.includes(word));
  record('页面不含评价性词汇', found.length === 0, found.join(',') || '无');

  // ---- 6. 并排数字 ----
  const columns = await page.$$('.compare-col');
  record('并排数字有两列', columns.length === 2, `${columns.length} 列`);

  // ---- 7. 触摸目标 ≥ 44px ----
  const smallTargets = await page.evaluate(() => {
    const tooSmall = [];
    for (const el of document.querySelectorAll('.compare-pick, .compare-pair__actions button, .btn')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height < 44) {
        tooSmall.push(`${el.textContent?.trim().slice(0, 12) || el.className}:${Math.round(rect.height)}px`);
      }
    }
    return tooSmall;
  });
  record('触摸目标 ≥ 44px', smallTargets.length === 0, smallTargets.slice(0, 4).join(', '));

  // ---- 8. 窄屏布局 ----
  await page.setViewport({ width: 375, height: 800 });
  await sleep(700);
  const mobile = await page.evaluate(() => {
    const grid = document.querySelector('.compare-pair__grid');
    const gridCols = grid ? getComputedStyle(grid).gridTemplateColumns : '';
    return {
      gridCols,
      docWidth: document.documentElement.scrollWidth,
      winWidth: window.innerWidth,
      pairCanvasWidth: document.querySelector('.compare-pair__grid canvas')?.getBoundingClientRect().width ?? 0,
    };
  });
  record('窄屏下并排改为单列', !mobile.gridCols.includes(' '), mobile.gridCols);
  record('窄屏无横向溢出', mobile.docWidth <= mobile.winWidth + 2, `${mobile.docWidth} vs ${mobile.winWidth}`);
  record('窄屏下画面仍有宽度', mobile.pairCanvasWidth > 100, `${Math.round(mobile.pairCanvasWidth)}px`);

  record('无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
});

process.exitCode = report(results, '对比页核查');
