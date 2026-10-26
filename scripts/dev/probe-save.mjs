/**
 * 定点验证保存路径：区分工具栏「保存沙盘」（打开面板）与面板内「保存沙盘」（真正写入）。
 */
import { withSandboxPage, report, sleep } from './harness.mjs';

const results = await withSandboxPage({}, async ({ base, page, record }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 15000 });
  await sleep(600);

  await (await page.$$('[data-testid="sandbox-lib-item"]'))[0].click();
  await sleep(300);
  await (await page.$$('[data-testid="sandbox-lib-item"]'))[3].click();
  await sleep(300);

  const titleInput = await page.$('input[aria-label="沙盘名称"]');
  await titleInput.click({ clickCount: 3 });
  await titleInput.type('夜里的海');
  await sleep(200);

  await page.click('[data-testid="sandbox-save"]');
  await sleep(600);

  const panelState = await page.evaluate(() => {
    const card = document.querySelector('.wb-card');
    const textareas = Array.from(document.querySelectorAll('.wb-card textarea'));
    return {
      cardVisible: Boolean(card),
      textareaCount: textareas.length,
      cardText: card?.textContent?.slice(0, 100) ?? null,
    };
  });
  record('点工具栏保存后打开保存面板', panelState.cardVisible, JSON.stringify(panelState));

  const confirmBtn = await page.$('[data-testid="sandbox-save-confirm"]');
  record('面板内有保存确认按钮', Boolean(confirmBtn));
  if (confirmBtn) await confirmBtn.click();
  await sleep(1800);

  const keys = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      out[k] = (localStorage.getItem(k) ?? '').length;
    }
    return out;
  });
  console.log('  localStorage:', JSON.stringify(keys));

  const raw = await page.evaluate(() => localStorage.getItem('xinyu.sessions'));
  let list = [];
  if (raw) {
    const parsed = JSON.parse(raw);
    list = Array.isArray(parsed) ? parsed : [parsed];
    list.forEach((s) =>
      console.log(
        `  会话: id=${s.id} title=${s.title} items=${s.items?.length} events=${s.events?.length} locked=${s.locked}`,
      ),
    );
  }
  record('保存后 xinyu.sessions 有 1 条', list.length === 1, `实际 ${list.length} 条`);
  record('保存的标题正确', list[0]?.title === '夜里的海', list[0]?.title ?? 'none');
  record('保存含 2 个摆件', list[0]?.items?.length === 2, `${list[0]?.items?.length}`);

  const toast = await page.evaluate(() => document.querySelector('.toast')?.textContent ?? null);
  console.log('  toast:', JSON.stringify(toast));

  // 刷新后仍在
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(900);
  const afterReload = await page.evaluate(() => document.body.innerText);
  record('刷新后沙盘页正常', afterReload.length > 200, `${afterReload.length} 字`);

  await page.goto(`${base}/records`, { waitUntil: 'networkidle2' });
  await sleep(900);
  const records = await page.evaluate(() => document.body.innerText);
  record('记录页出现该沙盘标题', records.includes('夜里的海'));
  record('记录页出现「沙盘」分组', records.includes('沙盘'));

  await page.goto(`${base}/`, { waitUntil: 'networkidle2' });
  await sleep(900);
  const home = await page.evaluate(() => document.body.innerText);
  record('首页最近记录出现该沙盘', home.includes('夜里的海'));

  // 回放页深链
  if (list[0]?.id) {
    await page.goto(`${base}/sandbox/session/${list[0].id}`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    const replay = await page.evaluate(() => document.body.innerText);
    record('回放页深链可打开', replay.length > 100, `${replay.length} 字`);
  }
});

process.exit(report(results, '保存路径验证'));
