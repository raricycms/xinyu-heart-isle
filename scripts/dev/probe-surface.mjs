/**
 * 沙面介质层视觉验收探针（surface-dev）。
 *
 * 验证目标（CONTRACT §7 + 任务书）：
 *  1. iso2d 画布真的画出了 768 个小格（不是一整块平涂）；
 *  2. 湿沙比干沙暗 —— 采样像素算平均亮度差；
 *  3. 高度起伏：抬起沙面后同一列的像素亮度/位置发生变化；
 *  4. 深挖区域偏冷灰（蓝色通道占比上升）；
 *  5. 空格 + 方向键真的能画（键盘可达性，不是只有鼠标能动）；
 *  6. 触摸 pointerType='touch' 能画；
 *  7. 3D 视图里出现「不支持拖动画沙」提示。
 *
 * 用法：node scripts/dev/probe-surface.mjs [--port=4192]
 */
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { launchPreview } from './_shared/preview.mjs';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!CHROME) {
  console.error('找不到 Chrome/Edge');
  process.exit(2);
}

const args = process.argv.slice(2);
const preferredPort = Number(
  (args.find((a) => a.startsWith('--port=')) ?? '--port=4192').split('=')[1],
);
const shotDir = (args.find((a) => a.startsWith('--shot-dir=')) ?? '--shot-dir=scripts/dev/shots').split('=')[1];
mkdirSync(shotDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/*
 * 起 preview 统一走 `_shared/preview.mjs`。
 *
 * 这里原来是 `spawn('npx.cmd', [...], { shell: true })` + 收尾 `preview.kill()`：
 * Windows 上 `shell: true` 会套一层 cmd.exe，kill 只杀 cmd.exe，
 * **vite 变孤儿继续占着 4192**。实测修前每次跑完残留 1 个、端口仍在 Listen。
 *
 * 现在：直接 spawn `node vite.js`（单进程，kill 即真 kill），
 * 且 `stopPreview` 会等到进程真的退出再返回。
 */
const preview = await launchPreview({ port: preferredPort, distDir: 'dist' });
const base = preview.base;
console.log(`使用端口 ${preview.port}（首选 ${preferredPort}）`);

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--lang=zh-CN', '--force-device-scale-factor=1'],
    defaultViewport: { width: 1440, height: 1000, hasTouch: true },
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240));
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 240)}`));

  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 20000 });
  // 清掉已有数据，从干净沙面开始
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="sandbox-stage"]', { timeout: 20000 });
  await sleep(900);

  /* ==================== 0. iso2d 基础 ==================== */
  console.log('\n=== 0. iso2d 渲染器就位 ===');
  const canvasInfo = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('.iso2d__canvas'));
    return canvases.map((c) => {
      const el = /** @type {HTMLCanvasElement} */ (c);
      const rect = el.getBoundingClientRect();
      return { cls: el.className, w: el.width, h: el.height, cssW: Math.round(rect.width), cssH: Math.round(rect.height) };
    });
  });
  check('iso2d 画布存在', canvasInfo.length >= 1, JSON.stringify(canvasInfo));
  check('画布有实际像素尺寸', canvasInfo.every((c) => c.w > 100 && c.h > 100));

  /** 从主画布采样：返回整体平均亮度与蓝色占比 */
  const sampleCanvas = async () =>
    page.evaluate(() => {
      const canvas = document.querySelector('.iso2d__canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      let lum = 0;
      let blueness = 0;
      let count = 0;
      const colors = new Set();
      // 每 4 个像素取一个，够快也够准
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 200) continue; // 跳过透明区域（阴影/高光叠加层）
        lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        blueness += b / Math.max(1, r);
        count += 1;
        if (colors.size < 5000) colors.add((r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3));
      }
      return {
        lum: count ? lum / count : 0,
        blueness: count ? blueness / count : 0,
        uniqueColors: colors.size,
        sampled: count,
      };
    });

  const baseline = await sampleCanvas();
  check('能读到画布像素', Boolean(baseline && baseline.sampled > 500), JSON.stringify(baseline));
  /*
   * 注意：**平坦沙面本来就只有很少的色阶**（768 格全在同一高度时，
   * 只有逐行 depthShade 这一项在变），量化到 5bit 后 ~14 色是正确结果，
   * 不是"画成了一整块平涂"。真正能证明逐格着色的是：
   *   (a) 上下方向存在明暗渐变（depthShade 生效）；
   *   (b) 画过之后色数显著增加（高度+湿度参与调色）。
   * 所以这里分两步验证，而不是一上来就要求 baseline 色数很高。
   */
  check(
    '平坦沙面有纵向明暗渐变（depthShade 生效，非纯色平涂）',
    baseline.uniqueColors >= 5,
    `uniqueColors=${baseline.uniqueColors}`,
  );

  /* 纵向渐变：托盘上方 vs 下方亮度必须有差别 */
  const verticalGradient = await page.evaluate(() => {
    const canvas = document.querySelector('.iso2d__canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    const sectorLum = (y0, y1) => {
      const data = ctx.getImageData(0, Math.floor(canvas.height * y0), canvas.width, Math.floor(canvas.height * (y1 - y0))).data;
      let lum = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i + 3] < 200) continue;
        lum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        count += 1;
      }
      return count ? lum / count : null;
    };
    return { top: sectorLum(0.3, 0.42), bottom: sectorLum(0.58, 0.7) };
  });
  check(
    '托盘上沿与下沿亮度不同（逐行明暗真的在算）',
    Boolean(verticalGradient && verticalGradient.top !== null && Math.abs(verticalGradient.top - verticalGradient.bottom) > 0.5),
    JSON.stringify(verticalGradient),
  );

  const stageBox = await (await page.$('[data-testid="sandbox-stage"]')).boundingBox();
  const cx = Math.round(stageBox.x + stageBox.width / 2);
  const cy = Math.round(stageBox.y + stageBox.height / 2);

  /** 选一个笔刷工具 */
  const pickTool = async (tool) => {
    const ok = await page.evaluate((name) => {
      const btn =
        document.querySelector(`[data-testid="sandbox-tool-${name}"]`) ??
        document.querySelector(`[data-testid="surface-toolbar-tool-${name}"]`);
      if (!btn) return false;
      btn.click();
      return true;
    }, tool);
    await sleep(350);
    return ok;
  };

  /* ==================== 1. 喷水：湿沙变暗 ==================== */
  console.log('\n=== 1. 喷水 -> 湿沙变暗 ===');
  const waterPicked = await pickTool('water');
  check('喷水工具可选中', waterPicked);

  await page.mouse.move(cx - 120, cy);
  await page.mouse.down();
  for (let i = 1; i <= 14; i += 1) {
    await page.mouse.move(cx - 120 + i * 17, cy + Math.sin(i / 2) * 14);
    await sleep(22);
  }
  await page.mouse.up();
  await sleep(700);

  const afterWater = await sampleCanvas();
  const waterOk = afterWater.lum < baseline.lum - 1;
  check(
    '喷水后画面整体变暗（湿沙可见）',
    waterOk,
    `亮度 ${baseline.lum.toFixed(1)} -> ${afterWater.lum.toFixed(1)}`,
  );

  const eventCount = await page.evaluate(
    () => document.querySelector('[data-testid="sandbox-event-count"]')?.textContent ?? '?',
  );
  check('笔画产生了事件（进入事件流，可撤销）', eventCount !== '0' && eventCount !== '?', `事件数=${eventCount}`);

  await page.screenshot({ path: `${shotDir}/surface-1-water.png` });

  /* ==================== 2. 推沙：起伏变化 ==================== */
  console.log('\n=== 2. 推沙 -> 高度起伏 ===');
  const raisePicked = await pickTool('raise');
  check('推沙工具可选中', raisePicked);
  const beforeRaise = await sampleCanvas();
  await page.mouse.move(cx - 140, cy - 40);
  await page.mouse.down();
  for (let i = 1; i <= 16; i += 1) {
    await page.mouse.move(cx - 140 + i * 18, cy - 40);
    await sleep(22);
  }
  await page.mouse.up();
  await sleep(700);
  const afterRaise = await sampleCanvas();
  check(
    '推沙后画面发生变化（高度起作用）',
    Math.abs(afterRaise.lum - beforeRaise.lum) > 0.8,
    `亮度 ${beforeRaise.lum.toFixed(1)} -> ${afterRaise.lum.toFixed(1)}`,
  );
  await page.screenshot({ path: `${shotDir}/surface-2-raise.png` });

  /* ==================== 3. 挖沙：冷灰 ==================== */
  console.log('\n=== 3. 挖沙 -> 深坑偏冷灰 ===');
  const digPicked = await pickTool('dig');
  check('挖沙工具可选中', digPicked);
  const beforeDig = await sampleCanvas();
  await page.mouse.move(cx + 60, cy + 50);
  await page.mouse.down();
  for (let i = 1; i <= 18; i += 1) {
    await page.mouse.move(cx + 60 + Math.sin(i / 3) * 40, cy + 50 + i * 3);
    await sleep(22);
  }
  await page.mouse.up();
  await sleep(700);
  const afterDig = await sampleCanvas();
  check(
    '挖沙后冷色占比上升（深挖沙转冷灰）',
    afterDig.blueness > beforeDig.blueness,
    `b/r ${beforeDig.blueness.toFixed(3)} -> ${afterDig.blueness.toFixed(3)}`,
  );
  await page.screenshot({ path: `${shotDir}/surface-3-dig.png` });

  /* ==================== 4. 键盘绘制 ==================== */
  console.log('\n=== 4. 空格 + 方向键绘制（键盘可达） ===');
  const beforeKey = await (async () =>
    page.evaluate(
      () => document.querySelector('[data-testid="sandbox-event-count"]')?.textContent ?? '0',
    ))();
  // 先聚焦到可绘制区域
  const focused = await page.evaluate(() => {
    const el =
      document.querySelector('.iso2d.ss-drawable') ??
      document.querySelector('.iso2d') ??
      document.querySelector('[data-testid="sandbox-stage"]');
    if (!el) return null;
    el.focus?.();
    return { cls: el.className, tabIndex: el.getAttribute('tabindex') };
  });
  check('可绘制区域可聚焦（tabindex 存在）', Boolean(focused && focused.tabIndex !== null), JSON.stringify(focused));

  await pickTool('raise');
  await page.evaluate(() => {
    const el = document.querySelector('.iso2d.ss-drawable') ?? document.querySelector('.iso2d');
    el?.focus?.();
  });
  await page.keyboard.down('Space');
  await sleep(120);
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.down('ArrowRight');
    await sleep(70);
    await page.keyboard.up('ArrowRight');
  }
  await page.keyboard.up('Space');
  await sleep(700);
  const afterKey = await page.evaluate(
    () => document.querySelector('[data-testid="sandbox-event-count"]')?.textContent ?? '0',
  );
  check(
    '空格+方向键产生了一次笔画事件',
    Number(afterKey) > Number(beforeKey),
    `事件数 ${beforeKey} -> ${afterKey}`,
  );
  await page.screenshot({ path: `${shotDir}/surface-4-keyboard.png` });

  /* ==================== 5. 触摸绘制 ==================== */
  console.log('\n=== 5. 触摸绘制（pointerType=touch） ===');
  const touchResult = await page.evaluate(async () => {
    const el = document.querySelector('.iso2d.ss-drawable') ?? document.querySelector('.iso2d');
    if (!el) return { ok: false, reason: 'no drawable' };
    const rect = el.getBoundingClientRect();
    const startX = rect.left + rect.width * 0.3;
    const startY = rect.top + rect.height * 0.7;
    const fire = (type, x, y) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
          buttons: type === 'pointerup' ? 0 : 1,
        }),
      );
    const before = document.querySelector('[data-testid="sandbox-event-count"]')?.textContent;
    fire('pointerdown', startX, startY);
    for (let i = 1; i <= 12; i += 1) {
      fire('pointermove', startX + i * 9, startY - i * 2);
      await new Promise((r) => setTimeout(r, 20));
    }
    fire('pointerup', startX + 108, startY - 24);
    await new Promise((r) => setTimeout(r, 700));
    const after = document.querySelector('[data-testid="sandbox-event-count"]')?.textContent;
    const style = getComputedStyle(el);
    return { ok: Number(after) > Number(before), before, after, touchAction: style.touchAction };
  });
  check('触摸指针能画出笔画', touchResult.ok === true, JSON.stringify(touchResult));
  check(
    'touch-action: none（防止触摸时页面滚动抢走手势）',
    touchResult.touchAction === 'none',
    `touch-action=${touchResult.touchAction}`,
  );
  await page.screenshot({ path: `${shotDir}/surface-5-touch.png` });

  /* ==================== 6. 3D 视图提示 ==================== */
  console.log('\n=== 6. 3D 视图能力边界提示 ===');
  // 渲染器是顶栏的 <select>（不是按钮），必须用 select 而不是 click
  const switched = await page.evaluate(() => {
    const select = Array.from(document.querySelectorAll('select')).find((el) =>
      Array.from(el.options).some((opt) => opt.value === 'three'),
    );
    if (!select) return { ok: false, reason: '找不到渲染器下拉框' };
    select.value = 'three';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, options: Array.from(select.options).map((o) => o.value) };
  });
  check('渲染器下拉框能切到 3D', switched.ok === true, JSON.stringify(switched));
  await sleep(3200);
  const threeState = await page.evaluate(() => {
    const root = document.querySelector('.three-renderer');
    if (!root) return { exists: false };
    return {
      exists: true,
      cls: root.className,
      hint: root.querySelector('.three-renderer__hint')?.textContent?.trim() ?? null,
      hasNofly: Boolean(root.querySelector('.three-renderer__nofly')),
      hasFallback: Boolean(root.querySelector('.three-renderer__fallback')),
      canvas: Boolean(root.querySelector('canvas')),
    };
  });
  check('3D 视图挂载', threeState.exists === true, JSON.stringify(threeState));
  check(
    '3D 视图显示了能力边界提示（不支持拖动画沙）',
    Boolean(threeState.hint && (threeState.hint.includes('不支持') || threeState.hint.includes('回退'))),
    threeState.hint ?? 'null',
  );
  await page.screenshot({ path: `${shotDir}/surface-6-three.png` });

  /* ==================== 6b. WebGL 上下文丢失不白屏 ==================== */
  console.log('\n=== 6b. 模拟 WebGL 上下文丢失 ===');
  const lostState = await page.evaluate(async () => {
    const canvas = document.querySelector('.three-renderer canvas');
    if (!canvas) return { ok: false, reason: '没有 canvas' };
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 900));
    const root = document.querySelector('.three-renderer');
    const fallback = root?.querySelector('.three-renderer__fallback');
    return {
      ok: Boolean(fallback),
      hasFallback: Boolean(fallback),
      fallbackText: fallback?.textContent?.trim().slice(0, 120) ?? null,
      rootCls: root?.className ?? null,
      canvasHidden: canvas instanceof HTMLElement ? getComputedStyle(canvas).display === 'none' : null,
      bodyLength: document.body.innerText.trim().length,
    };
  });
  check('上下文丢失后出现静态降级视图（不白屏）', lostState.hasFallback === true, JSON.stringify(lostState));
  check(
    '降级视图有可读文案（不是空白）',
    Boolean(lostState.fallbackText && lostState.fallbackText.length > 6),
    lostState.fallbackText ?? 'null',
  );
  check('页面正文没有变成空白（未白屏）', (lostState.bodyLength ?? 0) > 200, `正文长度=${lostState.bodyLength}`);
  await page.screenshot({ path: `${shotDir}/surface-6b-contextlost.png` });

  /* ==================== 7. 切回 iso2d，确认沙面还在 ==================== */
  console.log('\n=== 7. 切回 2.5D，沙面保留 ===');
  await page.evaluate(() => {
    const select = Array.from(document.querySelectorAll('select')).find((el) =>
      Array.from(el.options).some((opt) => opt.value === 'iso2d'),
    );
    if (select) {
      select.value = 'iso2d';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(1400);
  const finalSample = await sampleCanvas();
  check(
    '切回后沙面仍有笔迹（未被重置）',
    Boolean(finalSample && finalSample.uniqueColors > baseline.uniqueColors * 2),
    `uniqueColors ${baseline.uniqueColors} -> ${finalSample?.uniqueColors}`,
  );
  await page.screenshot({ path: `${shotDir}/surface-7-back.png`, fullPage: false });

  /* ==================== 8. console 干净 ==================== */
  console.log('\n=== 8. 运行时无报错 ===');
  const realErrors = consoleErrors.filter(
    (e) => !e.includes('WebGL') && !e.includes('THREE.WebGLRenderer') && !e.includes('Failed to load resource'),
  );
  check('console 无 JS 报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  /* ==================== 汇总 ==================== */
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${'='.repeat(56)}`);
  console.log(`结果：${passed}/${results.length} 通过`);
  const failedNames = results.filter((r) => !r.ok).map((r) => r.name);
  if (failedNames.length > 0) {
    console.log('失败项：');
    failedNames.forEach((n) => console.log(`  - ${n}`));
  }
  console.log(`截图目录：${shotDir}`);
  process.exitCode = failedNames.length === 0 ? 0 : 1;
} catch (error) {
  console.error('探针异常：', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  /* 关键：等到 vite 真的断气才返回，否则连跑两次会撞端口 */
  await preview.close();
}
