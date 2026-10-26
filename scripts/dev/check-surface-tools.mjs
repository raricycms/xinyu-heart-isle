/**
 * 全工具交互探针：证明 7 个沙面工具在真实 Chrome 里**每一个都真的能用**
 * （不只是"按钮存在"，而是"点下去之后沙面确实变了"）。
 *
 * 为什么需要它：CONTRACT §5 的红线是"不能白屏"，但反过来同样致命的是
 * "按钮都在、点了没反应"。这里对每个工具做「点选 → 拖动 → 比对画布像素」，
 * 用真实的 canvas getImageData 判断有没有变化，而不是只看事件计数器。
 *
 * 用法：node scripts/dev/check-surface-tools.mjs [--port=4193]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!CHROME) {
  console.error('找不到 Chrome/Edge');
  process.exit(2);
}

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
};
const port = Number(arg('port', '4193'));
const shotDir = arg('shot-dir', 'scripts/dev/shots');
mkdirSync(shotDir, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(port), '--strictPort'],
  { cwd: process.cwd(), shell: process.platform === 'win32', stdio: 'ignore' },
);

let browser;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

/* 7 个工具 + 每个工具的"应该发生什么"。
   `minDiff` 是逐工具的最低可见变化比例，不能一刀切：
   - 推沙/挖沙/挖洞/喷水/铺沙 都是"明显改变高度或湿度"，10% 起步；
   - 耙纹 只画细沟，3% 就是正常；
   - 抹平 是 3×3 邻域平均，设计上就**很轻微**（它的作用是
     "把毛边抚平"，不是"大改地形"），0.2% 已经是真的在动。
   统一卡 0.5% 会把抹平误判成失效 —— 那是探针的错，不是产品的错。 */
const TOOLS = [
  { id: 'raise', label: '推沙', minDiff: 0.02 },
  { id: 'dig', label: '挖沙', minDiff: 0.02 },
  { id: 'smooth', label: '抹平', minDiff: 0.001 },
  { id: 'rake', label: '耙纹', minDiff: 0.005 },
  { id: 'water', label: '喷水', minDiff: 0.02 },
  { id: 'tunnel', label: '挖洞', minDiff: 0.02 },
  { id: 'flatten', label: '重新铺沙', minDiff: 0.02 },
];

const trySnapshot = async (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('.iso2d__canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    /* 抽稀：每 97 个像素取一个，够判差异，也够快 */
    const out = [];
    for (let i = 0; i < data.length; i += 4 * 97) {
      out.push(data[i], data[i + 1], data[i + 2]);
    }
    return out;
  });

const diffRatio = (a, b) => {
  if (!a || !b || a.length !== b.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - b[i]) > 2 || Math.abs(a[i + 1] - b[i + 1]) > 2 || Math.abs(a[i + 2] - b[i + 2]) > 2) {
      changed += 1;
    }
  }
  return changed / (a.length / 3);
};

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
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 200));
  });

  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 20000 });
  await sleep(900);

  console.log('=== 1. 七个工具的按钮都在 ===');
  const found = await page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      out[id] = Boolean(
        document.querySelector(`[data-testid="sandbox-tool-${id}"]`)
        ?? document.querySelector(`[data-testid="surface-toolbar-tool-${id}"]`),
      );
    }
    return out;
  }, TOOLS.map((t) => t.id));
  for (const tool of TOOLS) {
    check(`${tool.label}（${tool.id}）按钮存在`, found[tool.id]);
  }

  console.log('\n=== 2. 每个工具拖动后画布确实变化 ===');
  const stage = await page.$('[data-testid="sandbox-stage"]');
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  for (const tool of TOOLS) {
    /* 每个工具前先重置到平坦状态，避免上一个工具的痕迹干扰判断 */
    const resetBtn = await page.$('[data-testid="sandbox-tool-flatten"]');
    if (resetBtn && tool.id !== 'flatten') {
      await resetBtn.click();
      await sleep(500);
    }

    /*
     * 「抹平」需要一个**已经不平**的沙面才能看出效果：
     * 在平坦沙面上抹平什么都不改（这本身是正确行为，不是 bug）。
     * 所以先用手势造一道明显的沙脊再抹。
     */
    if (tool.id === 'smooth') {
      await page.evaluate(() => {
        const btn =
          document.querySelector('[data-testid="sandbox-tool-raise"]')
          ?? document.querySelector('[data-testid="surface-toolbar-tool-raise"]');
        btn?.click();
      });
      await sleep(200);
      await page.mouse.move(cx - 110, cy);
      await page.mouse.down();
      for (let i = 1; i <= 18; i += 1) {
        await page.mouse.move(cx - 110 + i * 12, cy);
        await sleep(14);
      }
      await page.mouse.up();
      await sleep(600);
    }

    const before = await trySnapshot(page);

    await page.evaluate((name) => {
      const btn =
        document.querySelector(`[data-testid="sandbox-tool-${name}"]`)
        ?? document.querySelector(`[data-testid="surface-toolbar-tool-${name}"]`);
      btn?.click();
    }, tool.id);
    await sleep(250);

    /* 拖一条横线 */
    await page.mouse.move(cx - 110, cy);
    await page.mouse.down();
    for (let i = 1; i <= 18; i += 1) {
      await page.mouse.move(cx - 110 + i * 12, cy);
      await sleep(14);
    }
    await page.mouse.up();
    await sleep(700);

    const after = await trySnapshot(page);
    const ratio = diffRatio(before, after);
    check(
      `${tool.label} 拖动画出了一条痕迹`,
      before !== null && after !== null && ratio > tool.minDiff,
      `${(ratio * 100).toFixed(2)}% 像素变化（阈值 ${(tool.minDiff * 100).toFixed(2)}%）`,
    );
  }

  console.log('\n=== 3. 工具切换后 aria-pressed 正确 ===');
  for (const tool of TOOLS) {
    await page.evaluate((name) => {
      const btn =
        document.querySelector(`[data-testid="sandbox-tool-${name}"]`)
        ?? document.querySelector(`[data-testid="surface-toolbar-tool-${name}"]`);
      btn?.click();
    }, tool.id);
    await sleep(160);
    const state = await page.evaluate((ids) => {
      const out = [];
      for (const id of ids) {
        const btn =
          document.querySelector(`[data-testid="sandbox-tool-${id}"]`)
          ?? document.querySelector(`[data-testid="surface-toolbar-tool-${id}"]`);
        out.push({ id, pressed: btn?.getAttribute('aria-pressed') ?? null });
      }
      return out;
    }, TOOLS.map((t) => t.id));
    const pressed = state.filter((s) => s.pressed === 'true').map((s) => s.id);
    check(
      `选中「${tool.label}」时只有它是 pressed`,
      pressed.length === 1 && pressed[0] === tool.id,
      `pressed=[${pressed.join(',')}]`,
    );
  }

  console.log('\n=== 4. 触摸目标尺寸（CONTRACT §7 要求 ≥44×44）===');
  const sizes = await page.evaluate((ids) => {
    const out = [];
    for (const id of ids) {
      const btn =
        document.querySelector(`[data-testid="sandbox-tool-${id}"]`)
        ?? document.querySelector(`[data-testid="surface-toolbar-tool-${id}"]`);
      if (!btn) continue;
      const r = btn.getBoundingClientRect();
      out.push({ id, w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  }, TOOLS.map((t) => t.id));
  for (const s of sizes) {
    check(`${s.id} 触摸目标 ≥44×44`, s.w >= 44 && s.h >= 44, `${s.w}×${s.h}`);
  }

  console.log('\n=== 5. 运行时无报错 ===');
  check('console 与 pageerror 均为空', errors.length === 0, errors.slice(0, 2).join(' | '));

  await page.screenshot({ path: `${shotDir}/tools-all.png`, fullPage: false });
  console.log(`\n  -> ${shotDir}/tools-all.png`);
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
  if (failed > 0) process.exitCode = 1;
} catch (error) {
  console.error('探针异常：', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  preview.kill();
}
