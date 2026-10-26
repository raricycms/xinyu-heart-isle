import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4422 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  const before = await page.evaluate(() => [...document.querySelectorAll('input[type=range]')].map(el => ({ id: el.getAttribute('data-testid'), v: el.value, min: el.min, max: el.max })));
  // 模拟脚本 A 阶段的做法：sliders[1]='0.35', sliders[0]='1'
  const sliders = await page.$$('input[type="range"]');
  for (const [index, value] of [[1,'0.35'],[0,'1']]) {
    await page.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, sliders[index], value);
    await new Promise(r=>setTimeout(r,150));
  }
  const after = await page.evaluate(() => [...document.querySelectorAll('input[type=range]')].map(el => ({ id: el.getAttribute('data-testid'), v: el.value })));
  console.log('before:', JSON.stringify(before));
  console.log('after :', JSON.stringify(after));
});
process.exit(0);
