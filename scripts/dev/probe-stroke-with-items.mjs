/**
 * 探针：托盘上**有摆件**时，沙面笔画还能不能落笔？
 *
 * 背景：`check-sandbox-flow.mjs` 跑到第 5 步时托盘上已有 3 件摆件，
 * 此时点「推沙」再拖动，事件数 6 → 6 不动。但 `probe-surface-stroke.mjs`
 * （空托盘）一直绿。所以变量是「有摆件」。
 *
 * 这个探针把三种情况并排比：
 *   A. 空托盘 + 推沙 + 画中心
 *   B. 加 3 件后 + 推沙 + 画中心
 *   C. 加 3 件后 + 推沙 + 画角落
 * 每种都报 `elementFromPoint`、pointerdown 目标、事件数变化。
 */
import process from 'node:process';
import { withSandboxPage } from './harness.mjs';

await withSandboxPage({ port: 4403 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  const readEvents = () =>
    page.$eval('[data-testid="sandbox-event-count"]', (el) => Number(el.textContent ?? '0'));

  const box = await page.$eval('[data-testid="sandbox-stage"]', (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });

  /** 在归一化坐标处画一笔，返回 {before, after, hitTarget} */
  const strokeAt = async (fx, fy, label) => {
    await page.evaluate(() => {
      window.__hits = [];
      if (!window.__hitInstalled) {
        window.__hitInstalled = true;
        window.addEventListener(
          'pointerdown',
          (e) => {
            window.__hits.push(`${e.target.tagName}.${String(e.target.className).slice(0, 24)}`);
          },
          true,
        );
      }
    });

    const sx = box.x + box.w * fx;
    const sy = box.y + box.h * fy;
    const hit = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? `${el.tagName}.${String(el.className).slice(0, 30)}` : null;
      },
      [sx, sy],
    );

    const before = await readEvents();
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(sx + i * 8, sy + Math.sin(i / 2) * 14);
      await new Promise((r) => setTimeout(r, 20));
    }
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 600));
    const after = await readEvents();
    const hits = await page.evaluate(() => window.__hits);

    console.log(
      `  ${label.padEnd(26)} (${String(Math.round(sx)).padStart(4)},${String(Math.round(sy)).padStart(3)}) ` +
        `elementFromPoint=${String(hit).padEnd(30)} 事件 ${before}→${after} ${after > before ? '✓' : '✗'}  hits=${JSON.stringify(hits)}`,
    );
    return after > before;
  };

  console.log('\n=== A. 空托盘 ===');
  await page.click('[data-testid="sandbox-tool-raise"]');
  await new Promise((r) => setTimeout(r, 300));
  await strokeAt(0.5, 0.5, 'A 中心');

  console.log('\n=== 加 3 件摆件 ===');
  const libCount = await page.$$eval('[data-testid="lib-item"]', (els) => els.length);
  for (const index of [0, 2, 5]) {
    const items = await page.$$('[data-testid="lib-item"]');
    if (items[index]) {
      await items[index].click();
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  console.log(`  沙具库 ${libCount} 个，已点 3 个；在场件数 =`, await page.$eval('[data-testid="sandbox-item-count"]', (el) => el.textContent));

  // 重新确认工具仍是推沙
  const pressed = await page.$eval('[data-testid="sandbox-tool-raise"]', (el) =>
    el.getAttribute('aria-pressed'),
  );
  console.log('  推沙 aria-pressed =', pressed);
  if (pressed !== 'true') {
    await page.click('[data-testid="sandbox-tool-raise"]');
    await new Promise((r) => setTimeout(r, 300));
    const again = await page.$eval('[data-testid="sandbox-tool-raise"]', (el) =>
      el.getAttribute('aria-pressed'),
    );
    console.log('  重新点击后 aria-pressed =', again);
  }

  console.log('\n=== B. 有摆件 · 画中心 ===');
  await strokeAt(0.5, 0.5, 'B 中心');

  console.log('\n=== C. 有摆件 · 画各处 ===');
  for (const [fx, fy, label] of [
    [0.3, 0.4, 'C 左上'],
    [0.7, 0.35, 'C 右上'],
    [0.35, 0.7, 'C 左下'],
    [0.72, 0.68, 'C 右下'],
  ]) {
    await strokeAt(fx, fy, label);
  }

  // 最后确认：切到「摆件」模式再切回来，能不能恢复
  console.log('\n=== D. 切回摆件模式再切回推沙 ===');
  await page.click('[data-testid="sandbox-tool-select"]');
  await new Promise((r) => setTimeout(r, 250));
  await page.click('[data-testid="sandbox-tool-raise"]');
  await new Promise((r) => setTimeout(r, 250));
  await strokeAt(0.5, 0.45, 'D 中心');
});

process.exit(0);
