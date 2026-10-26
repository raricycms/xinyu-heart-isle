import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4421 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  const info = await page.evaluate(() => {
    const c = document.querySelector('.iso2d__canvas');
    const r = c.getBoundingClientRect();
    const trayW = r.width * 0.88;
    const trayH = trayW * 0.6;
    return {
      canvasCss: { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) },
      canvasBacking: { w: c.width, h: c.height },
      dpr: c.width / r.width,
      tray: { left: Math.round(r.left + (r.width - trayW)/2), top: Math.round(r.top + (r.height - trayH)/2 + trayH*0.08), w: Math.round(trayW), h: Math.round(trayH) },
    };
  });
  console.log(JSON.stringify(info, null, 2));
});
process.exit(0);
