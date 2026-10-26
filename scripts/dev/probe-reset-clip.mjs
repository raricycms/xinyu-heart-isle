import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4430 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise(r=>setTimeout(r,1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r=>setTimeout(r,1600));
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.ss-toolbar');
    const r = bar.getBoundingClientRect();
    const reset = document.querySelector('[data-testid="sandbox-tool-reset"]');
    const rr = reset.getBoundingClientRect();
    const stage = document.querySelector('.wb-stage').getBoundingClientRect();
    return {
      bar: { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right), scrollW: bar.scrollWidth, clientW: bar.clientWidth },
      reset: { x: Math.round(rr.x), w: Math.round(rr.width), right: Math.round(rr.right), text: reset.textContent.trim() },
      stage: { x: Math.round(stage.x), w: Math.round(stage.width), right: Math.round(stage.right) },
      resetClippedByBar: rr.right > r.right - 1,
      resetOutsideStage: rr.right > stage.right,
      barPadding: getComputedStyle(bar).padding,
    };
  });
  console.log(JSON.stringify(m, null, 2));
});
process.exit(0);
