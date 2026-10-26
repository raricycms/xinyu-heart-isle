/**
 * 复现 E2E 报告的 /sandbox/compare 刷新 404。
 *
 * 问题：smoke.ts 的「深链接刷新」场景第 3 次 reload 报了 404，
 * 但用 Invoke-WebRequest 直接请求是 200。可能是：
 *   a) 监听器在 reload 前挂上，抓到了上一次 reload 的残留响应；
 *   b) 真的有一个子资源 404；
 *   c) 与懒加载 chunk 的时序有关。
 * 这个脚本把每次请求的状态码打出来，定位到底漏了什么。
 */
import process from 'node:process';
import { withSandboxPage, report } from './harness.mjs';

const { steps, fails } = await withSandboxPage({ port: 4322 }, async ({ page, base, record }) => {
  const failures = [];
  const allRequests = [];

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    allRequests.push(`${status} ${url.replace(base, '')}`);
    if (status >= 400) failures.push(`${status} ${url.replace(base, '')}`);
  });
  page.on('requestfailed', (req) => {
    failures.push(`FAILED ${req.url().replace(base, '')} — ${req.failure()?.errorText}`);
  });

  // 第一次进入
  await page.goto(`${base}/sandbox/compare`, { waitUntil: 'networkidle2' });
  const firstText = await page.evaluate(() => document.body.innerText.length);
  record('首次访问渲染', firstText > 60, `${firstText} 字`);
  record('首次无失败请求', failures.length === 0, failures.join(' | '));

  // 清空记录后刷新
  failures.length = 0;
  allRequests.length = 0;
  await page.reload({ waitUntil: 'networkidle2' });
  const reloadText = await page.evaluate(() => document.body.innerText.length);
  record('刷新后渲染', reloadText > 60, `${reloadText} 字`);
  record('刷新后无失败请求', failures.length === 0, failures.join(' | '));

  // 再刷新一次（smoke 的第 3 次）
  failures.length = 0;
  allRequests.length = 0;
  await page.reload({ waitUntil: 'networkidle2' });
  const thirdText = await page.evaluate(() => document.body.innerText.length);
  record('第三次刷新后渲染', thirdText > 60, `${thirdText} 字`);
  record('第三次刷新后无失败请求', failures.length === 0, failures.join(' | '));

  if (failures.length > 0) {
    record('失败请求明细', false, failures.slice(0, 8).join('\n      '));
  }
  record('全部请求', true, allRequests.join('\n      '));

  // 对照：直接请求 HTML 的状态码
  const res = await page.goto(`${base}/sandbox/compare`, { waitUntil: 'domcontentloaded' });
  record('直接请求状态码 200', res?.status() === 200, String(res?.status()));
});

report({ steps, fails }, 'compare 深链接刷新');
process.exit(fails.length === 0 ? 0 : 1);
