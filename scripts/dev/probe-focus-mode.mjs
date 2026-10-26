import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4410 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  const state = async (label) => {
    const s = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="surface-silence-toggle"]');
      const r = t?.getBoundingClientRect();
      return {
        toggleInViewport: r ? (r.y >= 0 && r.y < innerHeight && r.x >= 0 && r.x < innerWidth) : false,
        toggleRect: r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : null,
        toolbar: Boolean(document.querySelector('[data-testid="sandbox-toolbar"]')),
        pressed: t?.getAttribute('aria-pressed'),
        hint: Boolean(document.querySelector('.wb-focushint')),
        sideCol: Boolean(document.querySelector('.wb-col--side')),
      };
    });
    console.log(`${label.padEnd(14)} toggle=${s.toggleInViewport ? '在视口内' : '视口外!'} @${s.toggleRect} aria-pressed=${s.pressed} 工具条=${s.toolbar} 提示=${s.hint} 右栏=${s.sideCol}`);
    return s;
  };
  await state('初始');
  await page.click('[data-testid="surface-silence-toggle"]');
  await new Promise(r=>setTimeout(r,500));
  await state('进入专注后');
  await page.screenshot({ path: 'tmp/shots/focus-mode.png' });
  // 点出口
  await page.click('[data-testid="surface-silence-toggle"]');
  await new Promise(r=>setTimeout(r,500));
  await state('点按钮退出');
  // 再进一次，用 Esc
  await page.click('[data-testid="surface-silence-toggle"]');
  await new Promise(r=>setTimeout(r,400));
  await page.keyboard.press('Escape');
  await new Promise(r=>setTimeout(r,500));
  await state('Esc 退出');
});
process.exit(0);
