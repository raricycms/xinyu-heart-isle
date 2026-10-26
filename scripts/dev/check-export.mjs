/** 导出核查：点击「导出 .md」是否真的生成可下载的 Blob、内容是否合规 */
import { withSandboxPage, report, sleep } from './harness.mjs';

const STORAGE_KEY = 'xinyu.sessions';
const SESSION_ID = 'session_export_check';

const session = {
  id: SESSION_ID,
  at: '2026-10-20T09:00:00.000Z',
  schemaVersion: 2,
  title: '导出核查/含|竖线',
  mode: 'self',
  sceneId: 'night',
  items: [{ id: 'a', symbolId: 'tree', x: 0.3, y: 0.4, scale: 1.6, rotation: 0, z: 1 }],
  events: [
    { t: 0, type: 'session.start', payload: { sceneId: 'beach', mode: 'self' } },
    { t: 1200, type: 'item.add', itemId: 'a', payload: { item: { id: 'a', symbolId: 'tree', x: 0.3, y: 0.4, scale: 1.6, rotation: 0, z: 1 } } },
    { t: 2600, type: 'item.add', itemId: 'b', payload: { item: { id: 'b', symbolId: 'house', x: 0.6, y: 0.5, scale: 1.5, rotation: 0, z: 2 } } },
    { t: 5000, type: 'scene.change', payload: { sceneId: 'night' } },
  ],
  locked: false,
};

const results = await withSandboxPage({}, async ({ base, page, record, consoleErrors }) => {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((key, s) => localStorage.setItem(key, JSON.stringify([s])), STORAGE_KEY, session);

  await page.goto(`${base}/sandbox/session/${SESSION_ID}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('canvas');
  await sleep(900);

  // 拦截 Blob / createObjectURL，拿到导出文本
  await page.evaluate(() => {
    window.__exported = null;
    window.__exports = [];
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.text().then((text) => window.__exports.push({ text, type: blob.type, size: blob.size }));
      return originalCreate(blob);
    };
    // 阻止真的跳转下载
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched() {
      if (this.download) {
        window.__exported = { download: this.download, href: String(this.href).slice(0, 30) };
        return undefined;
      }
      return originalClick.call(this);
    };
  });

  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('导出 .md'))?.click();
  });
  await sleep(1200);

  const exported = await page.evaluate(() => window.__exported);
  const exports = await page.evaluate(() => window.__exports);

  record('点击导出产生下载', exported !== null, JSON.stringify(exported));
  record('下载文件名为 .md', Boolean(exported?.download?.endsWith('.md')), exported?.download ?? '');
  record(
    '文件名已清洗非法字符',
    !/[\\/:*?"<>|]/.test(exported?.download ?? 'x'),
    exported?.download ?? '',
  );

  const md = exports[0]?.text ?? '';
  record('导出内容是 Blob 文本', md.length > 100, `${md.length} 字符, type=${exports[0]?.type}`);
  record('导出含免责说明', md.includes('不代表任何评价'), md.slice(0, 40));
  record('导出含会话标题（竖线已转义）', md.includes('导出核查/含\\|竖线') || md.includes('导出核查'), '');
  record('导出含事件类型分布', md.includes('事件类型'));
  record('导出含沙具清单', md.includes('树') || md.includes('tree'));
  record('导出无 undefined/NaN', !md.includes('undefined') && !md.includes('NaN'));

  // 表格结构：按连续块分组，每个块内部列数必须一致（不同块可以是 2 列或 3 列）
  // 统计竖线时忽略转义过的（单元格内的 \| 是合法转义，不是列分隔符）
  const countPipes = (line) => (line.match(/(?<!\\)\|/g) ?? []).length;
  const mdLines = md.split('\n');
  const blocks = [];
  let current = null;
  for (const line of mdLines) {
    if (line.startsWith('|')) {
      if (!current) {
        current = [];
        blocks.push(current);
      }
      current.push(countPipes(line));
    } else {
      current = null;
    }
  }
  const badBlocks = blocks.filter((block) => new Set(block).size !== 1);
  record(
    'Markdown 每个表格块内列数一致',
    badBlocks.length === 0 && blocks.length >= 3,
    `${blocks.length} 个表格块，异常 ${badBlocks.length} 个`,
  );
  record(
    '表格内竖线已转义而非断开列',
    md.includes('导出核查/含\\|竖线'),
    md.includes('导出核查/含\\|竖线') ? '已转义' : '未转义',
  );

  // 伦理红线
  const banned = ['进步', '退步', '改善', '恶化', '健康度', '好转', '变差'];
  const found = banned.filter((word) => md.includes(word));
  record('导出内容不含评价性词汇', found.length === 0, found.join(',') || '无');

  record('无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
});

process.exitCode = report(results, '统计导出核查');
