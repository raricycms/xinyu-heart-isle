import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4408 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  await page.click('[data-testid="sandbox-tool-raise"]');
  await new Promise(r=>setTimeout(r,300));
  const out = await page.evaluate(() => {
    const bar = document.querySelector('.wb-stage > .ss-toolbar');
    const b = bar.getBoundingClientRect();
    const kids = [...bar.children].map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: String(el.className).slice(0,42), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) };
    });
    const tools = [...bar.querySelectorAll('.ss-tool')].map(el => Math.round(el.getBoundingClientRect().width));
    return { bar: { w: Math.round(b.width), h: Math.round(b.height) }, kids, tools };
  });
  console.log(JSON.stringify(out, null, 2));
});
process.exit(0);
