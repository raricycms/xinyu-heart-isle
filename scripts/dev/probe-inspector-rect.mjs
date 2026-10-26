import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4404 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  const items = await page.$$('[data-testid="lib-item"]');
  await items[0].click();
  await new Promise((r) => setTimeout(r, 500));
  const info = await page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const insp = document.querySelector('.wb-inspector');
    const stage = document.querySelector('[data-testid="sandbox-stage"]');
    return {
      stage: r(stage),
      inspector: r(insp),
      inspectorCount: document.querySelectorAll('.wb-inspector').length,
      parents: insp ? [insp.parentElement?.className, insp.parentElement?.parentElement?.className] : null,
    };
  });
  console.log(JSON.stringify(info, null, 2));
});
process.exit(0);
