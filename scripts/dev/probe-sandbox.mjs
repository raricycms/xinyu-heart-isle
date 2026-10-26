/**
 * 定点探针：查清三件事为什么没生效。
 * 1. 沙面笔刷点击后 brush 是否为 null（工具状态没传下去）
 * 2. 滑块 input 事件后 api 是否收到 scaleItem
 * 3. 保存后 localStorage 到底写了哪些 key
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
const port = 4181;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(port), '--strictPort'],
  { cwd: process.cwd(), shell: process.platform === 'win32', stdio: 'ignore' },
);

let browser;
try {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${base}/`)).ok) break;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--lang=zh-CN'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));

  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 15000 });
  await sleep(700);

  /* ---------------- 1. 笔刷：点工具后看 DOM 与 canvas ---------------- */
  console.log('\n=== 1. 沙面笔刷 ===');
  const raiseBtn = await page.$('[data-testid="sandbox-tool-raise"]');
  await raiseBtn.click();
  await sleep(400);

  const brushState = await page.evaluate(() => {
    const iso = document.querySelector('.iso2d');
    const canvases = Array.from(document.querySelectorAll('.iso2d__canvas'));
    return {
      isoExists: Boolean(iso),
      isoClass: iso?.className ?? null,
      canvasCount: canvases.length,
      canvasSizes: canvases.map((c) => {
        const el = /** @type {HTMLCanvasElement} */ (c);
        const rect = el.getBoundingClientRect();
        return `${el.className}: ${Math.round(rect.width)}x${Math.round(rect.height)} buf=${el.width}x${el.height}`;
      }),
      ariaPressed: document
        .querySelector('[data-testid="sandbox-tool-raise"]')
        ?.getAttribute('aria-pressed'),
      dom2dExists: Boolean(document.querySelector('.dom2d')),
    };
  });
  console.log(JSON.stringify(brushState, null, 2));

  // 在 canvas 上派发真实 pointer 事件
  const stageBox = await (await page.$('[data-testid="sandbox-stage"]')).boundingBox();
  const cx = stageBox.x + stageBox.width / 2;
  const cy = stageBox.y + stageBox.height / 2;
  console.log(`  舞台中心 (${Math.round(cx)}, ${Math.round(cy)})`);

  const target = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, 400);
    return {
      tag: el?.tagName ?? null,
      cls: el?.className ?? null,
      testid: el?.getAttribute?.('data-testid') ?? null,
    };
  });
  console.log('  舞台中心处的实际元素:', JSON.stringify(target));

  // 直接监听是否触发 pointerdown
  await page.evaluate(() => {
    window.__probe = { pointerdown: 0, pointerup: 0, strokeCalls: 0 };
    const stage = document.querySelector('[data-testid="sandbox-stage"]');
    stage?.addEventListener('pointerdown', () => { window.__probe.pointerdown += 1; }, true);
    stage?.addEventListener('pointerup', () => { window.__probe.pointerup += 1; }, true);
  });

  const eventsBefore = await page.$eval('[data-testid="sandbox-event-count"]', (e) => e.textContent);
  await page.mouse.move(cx - 100, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(cx - 100 + i * 18, cy + Math.sin(i / 2) * 20);
    await sleep(20);
  }
  await page.mouse.up();
  await sleep(700);

  const probe = await page.evaluate(() => window.__probe);
  const eventsAfter = await page.$eval('[data-testid="sandbox-event-count"]', (e) => e.textContent);
  console.log('  事件捕获:', JSON.stringify(probe));
  console.log(`  事件计数: ${eventsBefore} -> ${eventsAfter}`);

  const surfaceInfo = await page.evaluate(() => {
    const raw = localStorage.getItem('xinyu.sessions');
    return { hasSessionsKey: Boolean(raw) };
  });
  console.log('  localStorage.xinyu.sessions 存在:', surfaceInfo.hasSessionsKey);

  /* ---------------- 2. 滑块 ---------------- */
  console.log('\n=== 2. 属性面板滑块 ===');
  const itemCount = await page.$$eval('[data-testid="sandbox-lib-item"]', (els) => els.length);
  await page.$$eval('[data-testid="sandbox-lib-item"]', (els) => els[0].click());
  await sleep(500);
  const inspector = await page.$('[aria-label="摆件属性"]');
  console.log('  属性面板:', Boolean(inspector));
  if (inspector) {
    const sliderInfo = await page.evaluate(() => {
      const panel = document.querySelector('[aria-label="摆件属性"]');
      const ranges = Array.from(panel?.querySelectorAll('input[type="range"]') ?? []);
      return ranges.map((r) => {
        const el = /** @type {HTMLInputElement} */ (r);
        return { label: el.getAttribute('aria-label'), value: el.value, min: el.min, max: el.max, step: el.step };
      });
    });
    console.log('  滑块:', JSON.stringify(sliderInfo, null, 2));

    const before = await page.$eval('[data-testid="sandbox-event-count"]', (e) => e.textContent);
    // 用 puppeteer 原生方式拖动第一个滑块
    const ranges = await page.$$('[aria-label="摆件属性"] input[type="range"]');
    if (ranges[0]) {
      const box = await ranges[0].boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 8 });
      await page.mouse.up();
      await sleep(600);
    }
    const after = await page.$eval('[data-testid="sandbox-event-count"]', (e) => e.textContent);
    console.log(`  拖动滑块事件计数: ${before} -> ${after}`);
  }

  /* ---------------- 3. 保存 ---------------- */
  console.log('\n=== 3. 保存路径 ===');
  const titleInput = await page.$('input[aria-label="沙盘名称"]');
  console.log('  标题输入框:', Boolean(titleInput));
  await page.click('[data-testid="sandbox-save"]');
  await sleep(500);
  const panelOpen = await page.evaluate(() => {
    const textarea = document.querySelector('.wb-card textarea');
    return { savePanelVisible: Boolean(textarea) };
  });
  console.log('  保存面板:', JSON.stringify(panelOpen));

  if (panelOpen.savePanelVisible) {
    // 点面板里的保存按钮（第二个 data-testid=sandbox-save 在 Toolbar，面板里的是普通 Button）
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const target = btns.find((b) => (b.textContent ?? '').trim() === '保存沙盘');
      if (target) {
        target.click();
        return true;
      }
      return false;
    });
    console.log('  点击面板保存按钮:', clicked);
    await sleep(1500);
  }

  const storageKeys = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      out[key] = (localStorage.getItem(key) ?? '').length;
    }
    return out;
  });
  console.log('  localStorage keys:', JSON.stringify(storageKeys, null, 2));

  const sessionRaw = await page.evaluate(() => localStorage.getItem('xinyu.sessions'));
  if (sessionRaw) {
    try {
      const parsed = JSON.parse(sessionRaw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      console.log(`  xinyu.sessions 里有 ${list.length} 条`);
      if (list[0]) {
        console.log(`    第一条: id=${list[0].id} title=${list[0].title} items=${list[0].items?.length} events=${list[0].events?.length}`);
      }
    } catch (error) {
      console.log('  解析失败:', String(error));
    }
  } else {
    console.log('  !! xinyu.sessions 为空');
  }

  const toastText = await page.evaluate(() => {
    const toast = document.querySelector('.toast, [role="status"], [role="alert"]');
    return toast?.textContent ?? null;
  });
  console.log('  toast:', toastText);
} catch (error) {
  console.error('探针异常:', error);
} finally {
  if (browser) await browser.close();
  preview.kill();
}
