import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4409 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  const info = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="surface-silence-toggle"]');
    const wrap = document.querySelector('.wb-silence');
    const r = (e) => { if(!e) return null; const b=e.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}; };
    return {
      found: Boolean(el),
      toggleRect: r(el),
      wrapRect: r(wrap),
      wrapClass: wrap?.className ?? null,
      parent: wrap?.parentElement?.className ?? null,
      wrapDisplay: wrap ? getComputedStyle(wrap).display : null,
      wrapPos: wrap ? getComputedStyle(wrap).position : null,
    };
  });
  console.log(JSON.stringify(info, null, 2));
});
process.exit(0);
