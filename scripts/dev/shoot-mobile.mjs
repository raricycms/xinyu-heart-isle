import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4412 }, async ({ page, base }) => {
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  await page.screenshot({ path: 'tmp/shots/mobile-sandbox.png' });
  console.log('shot');
});
process.exit(0);
