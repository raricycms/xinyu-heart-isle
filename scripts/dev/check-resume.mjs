/**
 * 验证「从回放页续接会话」端到端流程。
 *
 * 场景：回放页点「从这一步接着摆」→ 跳 /sandbox?from=<id>&cursor=<n>
 *       → SandboxPage 读参数、fork 出新会话、清掉 URL 参数、原会话不变。
 */
import process from 'node:process';
import { withSandboxPage, report } from './harness.mjs';

const { steps, fails } = await withSandboxPage({ port: 4300 }, async ({ page, base, record }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]');

  // 放两件沙具，制造多步事件流
  // SymbolTray 的按钮是 [data-testid="lib-item"] + aria-label="放入沙具：<名>"
  const libItems = await page.$$('[data-testid="lib-item"]');
  record('沙具库渲染出条目', libItems.length > 0, `${libItems.length} 个`);
  for (const el of libItems.slice(0, 2)) {
    await el.click();
    await new Promise((r) => setTimeout(r, 400));
  }

  const eventCount = await page
    .$eval('[data-testid="sandbox-event-count"]', (n) => Number(n.textContent ?? '0'))
    .catch(() => 0);
  // 1 条 session.start + 2 条 item.add = 3 条
  record('构造出多步会话', eventCount >= 3, `${eventCount} 条事件`);

  // 保存：工具栏按钮只开面板，面板里的 confirm 才真写
  await page.click('[data-testid="sandbox-save"]');
  await page.waitForSelector('[data-testid="sandbox-save-confirm"]', { timeout: 8000 });
  const titleInput = await page.$('.wb-modal input.input, .wb-modal input[type="text"]');
  if (titleInput) {
    await titleInput.click({ clickCount: 3 });
    await titleInput.type('续接验证');
  }
  await page.click('[data-testid="sandbox-save-confirm"]');
  await new Promise((r) => setTimeout(r, 1000));

  const readSessions = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem('xinyu.sessions');
      if (!raw) return [];
      try {
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : (list.items ?? list.value ?? []);
      } catch {
        return [];
      }
    });

  const sessions = await readSessions();
  const target = sessions.find((s) => s && s.title === '续接验证') ?? sessions[0];
  if (!record('保存后取到会话 id', Boolean(target?.id), target?.id ?? '未找到')) return;

  const sessionId = target.id;
  const before = { events: target.events?.length ?? 0, title: target.title };

  // 带续接参数进入工作台
  await page.goto(`${base}/sandbox?from=${sessionId}&cursor=2`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]');
  await new Promise((r) => setTimeout(r, 1200));

  record('URL 参数被清除', !page.url().includes('from='), page.url());

  const resumedCount = await page
    .$eval('[data-testid="sandbox-event-count"]', (n) => Number(n.textContent ?? '0'))
    .catch(() => -1);
  record(
    '续接后事件数被截断到 cursor',
    resumedCount >= 0 && resumedCount <= 3,
    `${resumedCount} 条（原会话 ${before.events} 条）`,
  );

  const afterList = await readSessions();
  const after = afterList.find((s) => s && s.id === sessionId);
  record('原会话事件数未变', (after?.events?.length ?? -1) === before.events, `${before.events} -> ${after?.events?.length}`);
  record('原会话标题未变', after?.title === before.title, `${before.title} -> ${after?.title}`);

  // 无参数进入应是全新会话
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]');
  await new Promise((r) => setTimeout(r, 500));
  const cleanCount = await page
    .$eval('[data-testid="sandbox-event-count"]', (n) => Number(n.textContent ?? '0'))
    .catch(() => -1);
  record('无参数进入是全新会话', cleanCount === 1, `${cleanCount} 条事件（应为 1 条 session.start）`);
});

report({ steps, fails }, '会话续接');
process.exit(fails.length === 0 ? 0 : 1);
