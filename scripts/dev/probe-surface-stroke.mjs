/**
 * 探针：沙面工具条到底有没有把笔迹写进事件流。
 *
 * 背景：`check-sandbox-flow.mjs` 报
 *   - 「一笔沙面绘制产生了事件」 4 → 4
 *   - 「挖沙工具可用」失败
 * 但同一时期 `scripts/e2e/smoke.ts` 的「沙面工具：7 个工具均可点击且不报错」
 * 是 8/8 全绿。差别在于：smoke 只验证「点了不报错」，
 * 没验证「点了真的改了沙面」。
 *
 * 这个探针把每一步的事件数、沙面版本号、以及 canvas 的像素是否变化都打出来，
 * 定位到底是：
 *   a) 工具点了但没画（pointer 事件没接上）；
 *   b) 画了但没进事件流（strokeSurface 没被调用）；
 *   c) 我的脚本鼠标坐标落在画布外。
 */
import process from 'node:process';
import { withSandboxPage } from './harness.mjs';

await withSandboxPage({ port: 4401 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));

  const readEvents = () =>
    page.$eval('[data-testid="sandbox-event-count"]', (el) => Number(el.textContent ?? '0'));

  /* 1. 沙面工具条是否存在 */
  const toolbar = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="sandbox-toolbar"]');
    if (!bar) return { exists: false };
    const buttons = [...bar.querySelectorAll('button')].map((b) => ({
      testid: b.getAttribute('data-testid'),
      label: b.getAttribute('aria-label') ?? (b.textContent ?? '').trim(),
      pressed: b.getAttribute('aria-pressed'),
      w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height),
    }));
    return { exists: true, buttons };
  });
  console.log('\n=== 沙面工具条 ===');
  if (!toolbar.exists) {
    console.log('工具条不存在！');
  } else {
    toolbar.buttons.forEach((b) =>
      console.log(
        `  ${b.testid ?? '-'} 「${b.label}」 ${b.w}×${b.h} pressed=${b.pressed ?? '-'}`,
      ),
    );
  }

  /* 2. 舞台与 canvas 的几何 */
  const geom = await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="sandbox-stage"]');
    const canvases = [...document.querySelectorAll('canvas')];
    return {
      stage: stage
        ? (() => {
            const r = stage.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          })()
        : null,
      canvasCount: canvases.length,
      canvases: canvases.map((c) => {
        const r = c.getBoundingClientRect();
        return {
          cls: c.className,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }),
    };
  });
  console.log('\n=== 几何 ===');
  console.log('stage:', JSON.stringify(geom.stage));
  console.log('canvas 数量:', geom.canvasCount);
  geom.canvases.forEach((c) => console.log(`  canvas.${c.cls} @ (${c.x},${c.y}) ${c.w}×${c.h}`));

  /* 3. 选个工具，画一笔，看事件数与像素 */
  const canvasPixels = () =>
    page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4 * 97) sum += data[i] + data[i + 1] + data[i + 2];
      return sum;
    });

  const beforeEvents = await readEvents();
  const beforePixel = await canvasPixels();
  console.log('\n=== 画之前 ===');
  console.log('事件数:', beforeEvents, '像素指纹:', beforePixel);

  if (toolbar.exists) {
    const raiseBtn = await page.$('[data-testid="sandbox-tool-raise"]');
    if (raiseBtn) {
      await raiseBtn.click();
      await new Promise((r) => setTimeout(r, 300));
      const pressed = await page.$eval('[data-testid="sandbox-tool-raise"]', (el) =>
        el.getAttribute('aria-pressed'),
      );
      console.log('点击推沙后 aria-pressed:', pressed);
    }

    const box = geom.canvases[0] ?? geom.stage;
    if (box) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      console.log(`在 (${Math.round(cx)},${Math.round(cy)}) 附近画一笔`);

      await page.mouse.move(cx - 60, cy);
      await page.mouse.down();
      for (let i = 1; i <= 10; i += 1) {
        await page.mouse.move(cx - 60 + i * 12, cy + Math.sin(i / 2) * 15);
        await new Promise((r) => setTimeout(r, 20));
      }
      await page.mouse.up();
      await new Promise((r) => setTimeout(r, 800));

      const afterEvents = await readEvents();
      const afterPixel = await canvasPixels();
      console.log('\n=== 画之后 ===');
      console.log('事件数:', afterEvents, afterEvents > beforeEvents ? `✓ +${afterEvents - beforeEvents}` : '✗ 没变');
      console.log(
        '像素指纹:',
        afterPixel,
        afterPixel !== beforePixel ? '✓ 画面变了' : '✗ 画面没变',
      );
    }
  }

  /* 4. localStorage 里的 session.surface 有没有内容 */
  const surfaceInfo = await page.evaluate(() => {
    const raw = localStorage.getItem('xinyu.sessions');
    if (!raw) return '(还没保存，正常)';
    const list = JSON.parse(raw);
    const s = list[0];
    return {
      surfaceLen: s?.surface ? s.surface.length : 0,
      surfaceMagic: s?.surface ? s.surface.slice(0, 2) : null,
      eventTypes: (s?.events ?? []).map((e) => e.type),
    };
  });
  console.log('\n=== 保存后的 surface ===');
  console.log(JSON.stringify(surfaceInfo));
});

process.exit(0);
