import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4406 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  await page.screenshot({ path: 'tmp/shots/final-sandbox.png', fullPage: false });
  const items = await page.$$('[data-testid="lib-item"]');
  for (const i of [0,2,5]) if (items[i]) { await items[i].click(); await new Promise(r=>setTimeout(r,250)); }
  const raise = await page.$('[data-testid="sandbox-tool-raise"]');
  if (raise) { await raise.click(); await new Promise(r=>setTimeout(r,250)); }
  const box = await page.$eval('[data-testid="sandbox-stage"]', el => { const b = el.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}; });
  const sx = box.x + box.w*0.42, sy = box.y + box.h*0.62;
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i=1;i<=14;i++){ await page.mouse.move(sx+i*9, sy+Math.sin(i/2)*22); await new Promise(r=>setTimeout(r,18)); }
  await page.mouse.up();
  await new Promise(r=>setTimeout(r,800));
  await page.screenshot({ path: 'tmp/shots/final-sandbox-painted.png', fullPage: false });
  // 390 宽
  await page.setViewport({ width: 390, height: 844 });
  await new Promise(r=>setTimeout(r,900));
  await page.screenshot({ path: 'tmp/shots/final-sandbox-390.png', fullPage: false });
  console.log('done');
});
process.exit(0);
