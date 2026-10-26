import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4411 }, async ({ page, base }) => {
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  const info = await page.evaluate(() => {
    const r = (el) => { if(!el) return null; const b=el.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}; };
    return {
      stage: r(document.querySelector('[data-testid="sandbox-stage"]')),
      inspector: r(document.querySelector('.wb-inspector')),
      toolbar: r(document.querySelector('.wb-stage > .ss-toolbar')),
      silence: r(document.querySelector('[data-testid="surface-silence-toggle"]')),
      docHeight: document.documentElement.scrollHeight,
    };
  });
  console.log(JSON.stringify(info, null, 2));
});
process.exit(0);
