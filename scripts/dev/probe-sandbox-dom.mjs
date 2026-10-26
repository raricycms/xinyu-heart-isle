/**
 * 探针：沙盘页真实 DOM 与存储行为。
 *
 * 背景：`scripts/dev/check-sandbox-flow.mjs`（早期写的）报
 * 「改大小产生了事件: 4 → 4」「保存后本机有会话数据: 0 条」「挖沙工具可用」失败。
 * 但 qa-dev 的 `scripts/e2e/smoke.ts` 里「沙盘交互」「沙面工具」两个场景是全绿的。
 *
 * 两者矛盾。这个探针不做断言，只把「页面上真实存在什么」和
 * 「存储里真实写了什么」原样打出来，用来判断是我的脚本选择器过时，
 * 还是 smoke 测得太浅、掩盖了真实缺陷。
 */
import process from 'node:process';
import { withSandboxPage } from './harness.mjs';

await withSandboxPage({ port: 4399 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));

  /* 1. 页面上所有 data-testid —— 用来发现过时的选择器 */
  const testids = await page.evaluate(() => {
    const all = new Set();
    document.querySelectorAll('[data-testid]').forEach((el) => {
      all.add(el.getAttribute('data-testid'));
    });
    return [...all].sort();
  });
  console.log('\n=== 沙盘页所有 data-testid ===');
  console.log(testids.join('\n'));

  /* 2. 所有可见控件，看工具条到底叫什么 */
  const controls = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input, select, button, [role="button"]').forEach((el) => {
      if (el.closest('[aria-hidden="true"]')) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        (el.textContent ?? '').trim().slice(0, 24);
      out.push({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        testid: el.getAttribute('data-testid') || '',
        label,
      });
    });
    return out;
  });
  console.log('\n=== 可见控件（前 40 个）===');
  controls
    .slice(0, 40)
    .forEach((c) =>
      console.log(
        `<${c.tag}${c.type ? ' type=' + c.type : ''}> testid=${c.testid || '-'} 「${c.label}」`,
      ),
    );

  /* 3. 放一个沙具，看事件数与存储 */
  const before = await page.evaluate(() => ({
    eventCount: document.querySelector('[data-testid="sandbox-event-count"]')?.textContent ?? null,
    keys: Object.keys(localStorage),
  }));
  console.log('\n=== 放沙具前 ===');
  console.log('event-count 文本:', JSON.stringify(before.eventCount));
  console.log('localStorage keys:', before.keys.join(', ') || '(空)');

  const picked = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="lib-item"]');
    if (!el) return null;
    el.click();
    return el.getAttribute('aria-label') || (el.textContent ?? '').trim().slice(0, 20) || 'clicked';
  });
  console.log('\n点击的沙具:', picked);
  await new Promise((r) => setTimeout(r, 900));

  const after = await page.evaluate(() => ({
    eventCount: document.querySelector('[data-testid="sandbox-event-count"]')?.textContent ?? null,
    keys: Object.keys(localStorage),
    sessionsLen: (localStorage.getItem('xinyu.sessions') ?? '').length,
  }));
  console.log('\n=== 放沙具后（未保存）===');
  console.log('event-count 文本:', JSON.stringify(after.eventCount));
  console.log('localStorage keys:', after.keys.join(', ') || '(空)');
  console.log('xinyu.sessions 长度:', after.sessionsLen, '(0 表示还没落盘，正常)');

  /* 4. 找保存按钮 */
  const buttonLabels = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .map((b) => (b.textContent ?? '').trim())
      .filter((t) => t.length > 0 && t.length < 20),
  );
  console.log('\n=== 所有按钮文案 ===');
  console.log(buttonLabels.join(' | '));

  const saved = await page.evaluate(() => {
    const target = [...document.querySelectorAll('button')].find((b) => {
      const t = (b.textContent ?? '').trim();
      return t === '保存' || t.includes('保存');
    });
    if (!target) return { found: false };
    target.click();
    return { found: true, label: (target.textContent ?? '').trim() };
  });
  console.log('\n点击保存（应打开 SavePanel）:', JSON.stringify(saved));
  await new Promise((r) => setTimeout(r, 1200));

  // 「保存沙盘」只是打开面板，面板里还有一步确认（可能要填标题/备注）
  const panelInfo = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"], dialog, .dialog, .sheet');
    const buttons = [...document.querySelectorAll('button')]
      .map((b) => (b.textContent ?? '').trim())
      .filter((t) => t && t.length < 16);
    const inputs = [...document.querySelectorAll('input, textarea')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      placeholder: el.getAttribute('placeholder') || '',
      label: el.closest('label')?.textContent?.trim().slice(0, 20) || '',
    }));
    return {
      hasDialog: Boolean(dialog),
      dialogClass: dialog?.className ?? null,
      buttons,
      inputs,
    };
  });
  console.log('\n=== 保存面板内容 ===');
  console.log('有 dialog 元素:', panelInfo.hasDialog, panelInfo.dialogClass ?? '');
  console.log('输入框:', JSON.stringify(panelInfo.inputs));
  console.log('按钮:', panelInfo.buttons.slice(-12).join(' | '));

  // 点面板里的确认按钮：面板里最后一个「保存沙盘」是真正的提交按钮
  // （工具条上第一个「保存沙盘」只是开面板）。用 last 而不是 first。
  const confirmed = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const matches = buttons.filter((b) => (b.textContent ?? '').trim() === '保存沙盘');
    if (matches.length === 0) {
      return {
        found: false,
        all: buttons.map((b) => (b.textContent ?? '').trim()).filter(Boolean).slice(-12),
      };
    }
    const target = matches[matches.length - 1];
    target.click();
    return { found: true, label: '保存沙盘', matches: matches.length };
  });
  console.log('\n点击面板确认:', JSON.stringify(confirmed));
  await new Promise((r) => setTimeout(r, 2000));

  const post = await page.evaluate(() => {
    const sizes = {};
    for (const k of Object.keys(localStorage)) sizes[k] = (localStorage.getItem(k) ?? '').length;
    const raw = localStorage.getItem('xinyu.sessions');
    let shape = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : (parsed?.items ?? []);
        shape = {
          topLevelIsArray: Array.isArray(parsed),
          count: list.length,
          firstId: list[0]?.id ?? null,
          firstKeys: list[0] ? Object.keys(list[0]).join(',') : null,
          firstEventCount: list[0]?.events?.length ?? null,
        };
      } catch (e) {
        shape = { parseError: String(e) };
      }
    }
    return { sizes, shape };
  });
  console.log('\n=== 保存后 localStorage ===');
  console.log('各键字节长度:', JSON.stringify(post.sizes));
  console.log('sessions 结构:', JSON.stringify(post.shape, null, 2));

  /* 5. 沙面工具：点一个工具再画一笔 */
  const toolInfo = await page.evaluate(() => {
    const toolButtons = [...document.querySelectorAll('button')].filter((b) => {
      const t = (b.textContent ?? '').trim();
      return /挖|堆|推|抚|喷|抹|压|湿/.test(t);
    });
    return toolButtons.map((b) => (b.textContent ?? '').trim());
  });
  console.log('\n=== 识别到的沙面工具按钮 ===');
  console.log(toolInfo.join(' | ') || '(按文案没找到，可能用 aria-label)');

  const ariaTools = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label]')]
      .map((el) => el.getAttribute('aria-label'))
      .filter((l) => /挖|堆|推|抚|喷|抹|压|湿|沙/.test(l ?? '')),
  );
  console.log('\n=== aria-label 里的沙面工具 ===');
  console.log(ariaTools.join(' | ') || '(无)');
});

process.exit(0);
