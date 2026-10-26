import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4407 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  const raise = await page.$('[data-testid="sandbox-tool-raise"]');
  await raise.click();
  await new Promise(r=>setTimeout(r,300));
  const box = await page.$eval('[data-testid="sandbox-stage"]', el => { const b = el.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}; });
  const sx = box.x + box.w*0.32, sy = box.y + box.h*0.55;
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i=1;i<=18;i++){ await page.mouse.move(sx+i*8, sy+Math.sin(i/2.5)*26); await new Promise(r=>setTimeout(r,16)); }
  await page.mouse.up();
  await new Promise(r=>setTimeout(r,900));
  await page.screenshot({ path: 'tmp/shots/crop-stage.png', clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  // 工具条溢出诊断
  const tb = await page.evaluate(() => {
    const bar = document.querySelector('.wb-stage > .ss-toolbar');
    const insp = document.querySelector('.wb-inspector');
    const r = (el) => { if(!el) return null; const b = el.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}; };
    return {
      toolbar: r(bar),
      inspector: r(insp),
      scrollW: bar?.scrollWidth, clientW: bar?.clientWidth,
      overflowX: bar ? getComputedStyle(bar).overflowX : null,
      zToolbar: bar ? getComputedStyle(bar).zIndex : null,
      zInspector: insp ? getComputedStyle(insp).zIndex : null,
    };
  });
  console.log(JSON.stringify(tb, null, 2));
});
process.exit(0);
