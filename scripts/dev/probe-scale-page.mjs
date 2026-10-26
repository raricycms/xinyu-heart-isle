import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4440 }, async ({ page, base }) => {
  await page.goto(`${base}/scales/phq-9`, { waitUntil: 'networkidle2' });
  await new Promise(r=>setTimeout(r,1500));
  const txt = await page.evaluate(() => (document.querySelector('main')?.innerText ?? document.body.innerText).slice(0,600));
  console.log('=== /scales/phq-9 正文 ===');
  console.log(txt);
});
process.exit(0);
