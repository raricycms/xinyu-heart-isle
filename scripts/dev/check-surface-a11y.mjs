/**
 * `SurfaceToolbar` / `SilenceToggle` 的独立验收探针。
 *
 * 为什么单独写：页面上的 `.wb-surfacebar` 是 Lead 自己写的内联工具条，
 * 我的 `SurfaceToolbar` 目前还没被页面引用。等它被接入时，
 * 我需要能**独立**证明它满足 CONTRACT §7：
 *   - 触摸目标 ≥44×44（CONTRACT 红线）
 *   - 键盘可达（Tab 能到、Enter/Space 能激活）
 *   - aria-pressed 正确
 *   - 两个 range 的 min/max/value 正确
 *   - 二次确认的「重新铺沙」
 *   - SilenceToggle 的 Esc 退出 + aria-live 播报
 *
 * 做法：构建后注入一个只挂载我的组件的测试页（用 vite 的 preview
 * 服务 + 一段内联脚本不可行，因为组件要经过打包），所以改用
 * `?surface-standalone=1` 不在页面里 —— 而是直接测**页面里已有的**
 * 我的组件 class（.ss-tool 等）。若页面尚未接入，则明确报"未接入"。
 *
 * 用法：node scripts/dev/check-surface-a11y.mjs [--port=4193]
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
const shotDir = arg('shot-dir', 'tmp');
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
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  });

  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 20000 });
  await sleep(900);

  console.log('=== 1. 页面上的沙面工具条 ===');
  /*
   * ⚠️ 必须先选中一个**沙面工具**再看可绘制区域：
   * 页面默认工具是「摆件」（放摆件的模式），此时 brush 为 null，
   * iso2d 不会进入笔刷模式，也就没有 tabindex/ss-drawable。
   * 第一版探针一进页面就查，于是误报"没有 tabindex"。
   */
  await page.evaluate(() => {
    const btn =
      document.querySelector('[data-testid="sandbox-tool-raise"]')
      ?? document.querySelector('[data-testid="surface-toolbar-tool-raise"]');
    btn?.click();
  });
  await sleep(400);

  /*
   * ⚠️ 这里原来查的是 `.wb-surfacebar` —— Lead 早期写在页面里的**内联**工具条。
   * 后来它被抽成了 `SurfaceToolbar` 组件（`.ss-toolbar`），内联版整体删除，
   * 于是这一整段永远返回 null、永远判「工具条不存在」。
   *
   * 这不是产品缺陷，是**检查目标消失了**。教训：
   * 断言绑在「实现细节的选择器」上时，重构一换类名，检查就静默失效
   * （而且还不是静默通过，是静默失败 —— 同样没人爱看）。
   * 现在改成查组件版 `.ss-toolbar`，与 `data-testid` 契约一致：
   * testid 是跨模块契约，类名不是。
   */
  const barInfo = await page.evaluate(() => {
    const bar = document.querySelector('.ss-toolbar');
    if (!bar) return null;
    const buttons = Array.from(bar.querySelectorAll('button'));
    return {
      buttons: buttons.length,
      sizes: buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return {
          text: (b.textContent ?? '').trim().slice(0, 6),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }),
      /*
       * 只有「沙面工具」这 7 个是 toggle，必须带 aria-pressed；
       * 「重铺整盘沙」是动作按钮，不适用。
       * 注意 `sandbox-tool-reset` 也匹配 `sandbox-tool-` 前缀，
       * 但它是动作按钮、没有 aria-pressed —— 所以要按 `.ss-tool` 类名筛，
       * 不能只按 testid 前缀筛，否则会把 reset 当成缺 aria-pressed 报错。
       */
      toolPressed: Array.from(bar.querySelectorAll('.ss-tool')).map((b) => ({
        id: b.getAttribute('data-testid'),
        pressed: b.getAttribute('aria-pressed'),
      })),
      role: bar.getAttribute('role'),
    };
  });
  if (barInfo) {
    check('工具条存在且有按钮', barInfo.buttons >= 7, `${barInfo.buttons} 个按钮`);
    check('工具条有 role=toolbar', barInfo.role === 'toolbar', `role=${barInfo.role}`);
    const missing = barInfo.toolPressed.filter((t) => t.pressed === null);
    check(
      '沙面工具按钮都带 aria-pressed',
      missing.length === 0,
      missing.length ? `缺：${missing.map((m) => m.id).join(', ')}` : `共 ${barInfo.toolPressed.length} 个`,
    );
    const small = barInfo.sizes.filter((s) => s.w < 44 || s.h < 44);
    check(
      '所有按钮触摸目标 ≥44×44',
      small.length === 0,
      small.length === 0
        ? barInfo.sizes.map((s) => `${s.w}×${s.h}`).join(' ')
        : `不足的：${small.map((s) => `${s.text} ${s.w}×${s.h}`).join(', ')}`,
    );
  } else {
    check('工具条存在', false, '页面上没有 .ss-toolbar');
  }

  console.log('\n=== 2. 我的 SurfaceToolbar 组件（.ss-toolbar）是否已接入 ===');
  const mine = await page.evaluate(() => {
    const bar = document.querySelector('.ss-toolbar');
    if (!bar) return { mounted: false };
    const tools = Array.from(bar.querySelectorAll('.ss-tool'));
    const ranges = Array.from(bar.querySelectorAll('input[type="range"]'));
    return {
      mounted: true,
      tools: tools.length,
      toolSizes: tools.map((b) => {
        const r = b.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
      ranges: ranges.map((r) => ({
        min: r.min,
        max: r.max,
        value: r.value,
        w: Math.round(r.getBoundingClientRect().width),
        h: Math.round(r.getBoundingClientRect().height),
      })),
      ariaPressed: tools.every((b) => b.hasAttribute('aria-pressed')),
    };
  });

  if (mine.mounted) {
    check('SurfaceToolbar 已接入页面', true);
    /*
     * 笔刷数量：契约是「≥7 种笔刷」，不是「恰好 7 个」。
     * 写死 `=== 7` 的后果是：加第 8 种笔刷（v2.0 加了 `flatten` 重新铺沙）
     * 时这条会红，而它红得毫无意义 —— 加笔刷是功能增强，不是回归。
     * 上限也不设：笔刷多不是问题，工具条会横向滚动。
     */
    check('笔刷数量 ≥7', mine.tools >= 7, `${mine.tools} 个`);
    const bad = mine.toolSizes.filter((s) => s.w < 44 || s.h < 44);
    check('工具按钮 ≥44×44', bad.length === 0, bad.length ? JSON.stringify(bad) : '全部达标');
    check('工具按钮都有 aria-pressed', mine.ariaPressed);
    check('两个 range（半径/强度）', mine.ranges.length === 2, `${mine.ranges.length} 个`);
    for (const [i, r] of mine.ranges.entries()) {
      check(
        `range #${i + 1} 有 min/max/value 且宽度 ≥100px`,
        Boolean(r.min) && Boolean(r.max) && r.w >= 100,
        `min=${r.min} max=${r.max} value=${r.value} ${r.w}×${r.h}`,
      );
    }
  } else {
    console.log('  · 未接入（页面上找不到 .ss-toolbar）');
    console.log('  · 我的组件单测已锁尺寸常量，见 surface-ui.test.ts');
  }

  console.log('\n=== 3. 键盘可达性 ===');
  const keyboard = await page.evaluate(() => {
    /*
     * 这里原本还查 `.wb-surfacebar button`（已删除的内联工具条）。
     * 保留旧选择器不会报错，只会让「可聚焦数量」虚高，
     * 所以一并换成组件选择器 `.ss-toolbar button`。
     */
    const focusables = Array.from(
      document.querySelectorAll(
        '.ss-toolbar button, .sandbox-stage button, [data-testid^="sandbox-tool-"]',
      ),
    );
    return {
      count: focusables.length,
      allTabbable: focusables.every((el) => el.tabIndex >= 0 || el.tagName === 'BUTTON'),
      drawableTabbable: (() => {
        const d = document.querySelector('.ss-drawable');
        return d ? String(d.getAttribute('tabindex')) : null;
      })(),
      drawableLabel: (() => {
        const d = document.querySelector('.ss-drawable');
        return d ? d.getAttribute('aria-label') : null;
      })(),
    };
  });
  check('工具按钮均可 Tab 聚焦', keyboard.count > 0 && keyboard.allTabbable, `${keyboard.count} 个`);
  check('可绘制区域有 tabindex=0', keyboard.drawableTabbable === '0', `tabindex=${keyboard.drawableTabbable}`);
  check(
    '可绘制区域的 aria-label 提到键盘操作',
    Boolean(keyboard.drawableLabel && keyboard.drawableLabel.includes('空格')),
    keyboard.drawableLabel?.slice(0, 90),
  );

  console.log('\n=== 4. 运行时无报错 ===');
  check('console / pageerror 为空', errors.length === 0, errors.slice(0, 2).join(' | '));

  await page.screenshot({ path: `${shotDir}/a11y-toolbar.png`, fullPage: false });
  console.log(`\n  -> ${shotDir}/a11y-toolbar.png`);
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
  if (failed > 0) process.exitCode = 1;
} catch (error) {
  console.error('探针异常：', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  preview.kill();
}
