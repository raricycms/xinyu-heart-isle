/**
 * 探针：为什么沙面笔画提交不了事件。
 *
 * 背景：我把页面内联的 `.wb-surfacebar` 换成 `SurfaceToolbar` 组件后，
 * `probe-surface-stroke.mjs` 从「事件数 1 → 2 ✓」退化成「1 → 1 ✗」，
 * 但像素指纹仍然变化（说明笔刷光标画出来了，只是没提交笔画）。
 *
 * 这个探针逐层排除：
 *   1. 画布中心点上 `elementFromPoint` 到底是谁？是否被工具栏盖住？
 *   2. pointerdown 事件有没有到达 canvas？用捕获阶段监听器数一遍。
 *   3. `onSurfaceStroke` 是否被调用？（页面上挂一个计数器）
 */
import process from 'node:process';
import { withSandboxPage } from './harness.mjs';

await withSandboxPage({ port: 4402 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  const readEvents = () =>
    page.$eval('[data-testid="sandbox-event-count"]', (el) => Number(el.textContent ?? '0'));

  /* 布局：工具栏在哪儿、舞台在哪儿、谁盖住了中心点 */
  const layout = await page.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    };
    const stage = document.querySelector('[data-testid="sandbox-stage"]');
    const canvas = document.querySelector('canvas');
    const toolbar = document.querySelector('[data-testid="sandbox-toolbar"]');
    const box = canvas?.getBoundingClientRect();
    const cx = box ? box.x + box.width / 2 : 0;
    const cy = box ? box.y + box.height / 2 : 0;
    const atCenter = document.elementFromPoint(cx, cy);
    return {
      stage: r(stage),
      canvas: r(canvas),
      toolbar: r(toolbar),
      toolbarParent: toolbar?.parentElement?.className ?? null,
      center: { x: Math.round(cx), y: Math.round(cy) },
      atCenter: atCenter
        ? `${atCenter.tagName}.${String(atCenter.className).slice(0, 40)}`
        : null,
      stagePosition: stage ? getComputedStyle(stage).position : null,
      toolbarPosition: toolbar ? getComputedStyle(toolbar).position : null,
    };
  });
  console.log('\n=== 布局 ===');
  console.log(JSON.stringify(layout, null, 2));

  /* 装一个捕获阶段计数器，看 pointer 事件流 */
  await page.evaluate(() => {
    window.__probe = { down: 0, move: 0, up: 0, targets: [] };
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      window.addEventListener(
        type,
        (e) => {
          const key = type === 'pointerdown' ? 'down' : type === 'pointermove' ? 'move' : 'up';
          window.__probe[key] += 1;
          if (type === 'pointerdown') {
            window.__probe.targets.push(
              `${e.target.tagName}.${String(e.target.className).slice(0, 30)}`,
            );
          }
        },
        true,
      );
    }
  });

  /* 选推沙，然后在中心画一笔 */
  await page.click('[data-testid="sandbox-tool-raise"]');
  await new Promise((r) => setTimeout(r, 300));
  const before = await readEvents();

  const { x, y } = layout.center;
  await page.mouse.move(x - 60, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(x - 60 + i * 12, y + Math.sin(i / 2) * 12);
    await new Promise((r) => setTimeout(r, 25));
  }
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1000));

  const after = await readEvents();
  const probe = await page.evaluate(() => window.__probe);
  console.log('\n=== pointer 事件流 ===');
  console.log('down:', probe.down, 'move:', probe.move, 'up:', probe.up);
  console.log('pointerdown 目标:', JSON.stringify(probe.targets));
  console.log('\n=== 事件数 ===');
  console.log(`${before} -> ${after}`, after > before ? '✓ 提交了' : '✗ 没提交');

  /* 画布上的绘制宿主有没有 touch-action / pointer-events 限制 */
  const canvasStyle = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const host = c?.closest('.ss-drawable') ?? c?.parentElement;
    const cs = c ? getComputedStyle(c) : null;
    const hs = host ? getComputedStyle(host) : null;
    return {
      hostClass: host?.className ?? null,
      canvasPointerEvents: cs?.pointerEvents ?? null,
      canvasTouchAction: cs?.touchAction ?? null,
      hostPointerEvents: hs?.pointerEvents ?? null,
      hostTouchAction: hs?.touchAction ?? null,
    };
  });
  console.log('\n=== 画布样式 ===');
  console.log(JSON.stringify(canvasStyle, null, 2));
});

process.exit(0);
