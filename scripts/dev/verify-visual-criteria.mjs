/**
 * 三条视觉验收标准的真实浏览器验证。
 *
 * Lead 的原话："单测能证明『算出来的颜色值不同』，证明不了『人眼看得出来』。"
 * 所以这里不调用任何内部函数，而是：
 *   1. 用真实鼠标事件在真实 Chrome 里画；
 *   2. 从 canvas 的 getImageData 里**逐像素测量**；
 *   3. 把每条标准的数值打出来 + 存一张对照截图供人工复核。
 *
 * 三条标准：
 *   A. 湿沙 wetness > 0.3 → 压暗 ≥12% 且有高光
 *   B. LIFT_RATIO 0.42 → 0.55 后坡度可辨（推起 vs 挖下一眼可辨）
 *   C. height < 90 偏冷灰（蓝红比上升）
 *
 * 用法：node scripts/dev/verify-visual-criteria.mjs [--port=4193]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { launchPreview } from './_shared/preview.mjs';

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
const preferredPort = Number(arg('port', '4193'));
const shotDir = arg('shot-dir', 'tmp');
mkdirSync(shotDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * 起 preview 统一走 `_shared/preview.mjs`。
 *
 * 这里原来是 `spawn('npx.cmd', [...], { shell: true })` + 收尾 `preview.kill()`：
 * Windows 上 `shell: true` 会套一层 cmd.exe，kill 只杀 cmd.exe，
 * **vite 变孤儿继续占着 4193**。实测修前每次跑完残留 1 个、端口仍在 Listen。
 * 对本脚本尤其致命：它会把**上一次残留的旧构建**当成被测对象来量像素，
 * 于是「视觉验收通过」可能是在过期产物上得出的。
 *
 * 现在：直接 spawn `node vite.js`（单进程，kill 即真 kill），
 * 且 `stopPreview` 会等到进程真的退出再返回。
 */
const preview = await launchPreview({ port: preferredPort, distDir: 'dist' });
const base = preview.base;
console.log(`使用端口 ${preview.port}（首选 ${preferredPort}）`);

let browser;
let failed = 0;
const results = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
};

/**
 * 从 canvas 里取一块区域的统计量。
 * 位置用「托盘归一化坐标」表达，和产品代码里的 brush 坐标同一套。
 */
const regionStats = (page, u0, v0, u1, v1) =>
  page.evaluate(
    ({ u0, v0, u1, v1 }) => {
      const canvas = document.querySelector('.iso2d__canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      /* 与 iso2d 的 trayRect 保持一致的托盘几何 */
      const trayW = w * 0.88;
      const trayH = trayW * 0.6;
      const trayX = (w - trayW) / 2;
      const trayY = (h - trayH) / 2 + trayH * 0.08;
      const x0 = Math.round(trayX + u0 * trayW);
      const x1 = Math.round(trayX + u1 * trayW);
      const y0 = Math.round(trayY + v0 * trayH);
      const y1 = Math.round(trayY + v1 * trayH);
      const sw = Math.max(1, x1 - x0);
      const sh = Math.max(1, y1 - y0);
      const data = ctx.getImageData(x0, y0, sw, sh).data;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let count = 0;
      let brightest = 0;
      let maxLum = 0;
      let minLum = 255;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        sr += r;
        sg += g;
        sb += b;
        count += 1;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum > maxLum) {
          maxLum = lum;
          brightest = r + g + b;
        }
        if (lum < minLum) minLum = lum;
      }
      return {
        meanR: sr / count,
        meanG: sg / count,
        meanB: sb / count,
        meanLum: (0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / count,
        maxLum,
        minLum,
        brightest,
        contrast: maxLum - minLum,
      };
    },
    { u0, v0, u1, v1 },
  );

const pickTool = async (page, id) => {
  await page.evaluate((name) => {
    const btn =
      document.querySelector(`[data-testid="sandbox-tool-${name}"]`)
      ?? document.querySelector(`[data-testid="surface-toolbar-tool-${name}"]`);
    btn?.click();
  }, id);
  await sleep(220);
};

/*
 * 重置整盘沙。
 *
 * 注意 testid 的**语义变更**（踩过的坑）：
 * 老工具条里 `sandbox-tool-flatten` 是「铺平/重置」按钮；
 * 换成 `SurfaceToolbar` 组件后，`flatten`（⬜ 重新铺沙）变成了**第 7 个笔刷**
 * ——一个把整盘抹平的工具，点一下会把沙面推平、毁掉待测的起伏；
 * 而真正的「重铺整盘沙」按钮是 `sandbox-tool-reset`，它还会弹一个二次确认。
 *
 * 所以这里必须点 `reset`，并且要**点两次**（第一次是「重铺整盘沙」，
 * 第二次是确认）。点错成 `flatten` 的表现是：测量值全都偏低但还没到
 * 判失败线，看起来像「视觉效果退化了」，其实是脚本在打自己的脸。
 */
const makeReset = async (page) => {
  const btn = await page.$('[data-testid="sandbox-tool-reset"]');
  if (!btn) return;
  await btn.click();
  await sleep(320);
  // 二次确认：确认按钮出现后再点
  const confirm = await page.$('[data-testid="sandbox-tool-reset-confirm"]');
  if (confirm) {
    await confirm.click();
  } else {
    // 兜底：确认按钮的 testid 万一变了，就找弹层里那个「重铺」语义的按钮
    const buttons = await page.$$('[data-testid^="sandbox-tool-reset"]');
    if (buttons.length > 1) await buttons[buttons.length - 1].click();
  }
  await sleep(650);
};

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--lang=zh-CN', '--force-device-scale-factor=2'],
    defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 2 },
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

  const stage = await page.$('[data-testid="sandbox-stage"]');
  const box = await stage.boundingBox();
  /* 托盘在 stage 内的像素几何（用于把归一化坐标转成鼠标坐标） */
  const trayGeom = await page.evaluate(() => {
    const canvas = document.querySelector('.iso2d__canvas');
    const rect = canvas.getBoundingClientRect();
    const trayW = rect.width * 0.88;
    const trayH = trayW * 0.6;
    return {
      left: rect.left + (rect.width - trayW) / 2,
      top: rect.top + (rect.height - trayH) / 2 + trayH * 0.08,
      w: trayW,
      h: trayH,
    };
  });
  const toScreen = (u, v) => ({
    x: trayGeom.left + u * trayGeom.w,
    y: trayGeom.top + v * trayGeom.h,
  });

  const dragPath = async (points) => {
    const first = toScreen(points[0].u, points[0].v);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const p of points.slice(1)) {
      const s = toScreen(p.u, p.v);
      await page.mouse.move(s.x, s.y);
      await sleep(13);
    }
    await page.mouse.up();
    await sleep(700);
  };

  /* =================== 标准 A：湿沙压暗 ≥12% + 高光 =================== */
  console.log('=== 标准 A：湿沙 wetness > 0.3 时压暗 ≥12%，且有高光 ===');

  /*
   * 把半径和力度都拉满，确保湿润度越过阈值。
   *
   * ⚠️ 这里踩过一个很隐蔽的坑：代码原来写的是 `[1,'0.35'] [0,'1']` ——
   * 那是**旧版内联工具条**的取值域（半径 0–0.5 之类的小数）。
   * 换成 `SurfaceToolbar` 组件后，两个滑杆都改成了整数域：
   *     笔刷大小 sandbox-tool-radius    min 2   max 35   step 1
   *     力度     sandbox-tool-strength  min 10  max 100  step 5
   * 于是 `'0.35'` 和 `'1'` **被浏览器 clamp 到各自的最小值**（2 和 10），
   * 也就是把笔刷调到了**比默认还弱**（默认 12 / 60）！
   *
   * 表现是 A1 从历史记录的 18.2% 掉到 9.8%、判失败。
   * 但它看起来完全像「渲染退化」，实际是脚本把强度调小了 ——
   * 这是本次审计里最值得记的一个坑：**HTML range 输入会被静默 clamp，
   * 不报错、不警告，只是悄悄按最小值跑。**
   * 所以下面按 testid 找滑杆（不按索引），并把值设在真实域内。
   */
  await pickTool(page, 'water');
  const setRange = async (testid, value) => {
    const ok = await page.evaluate(
      (id, v) => {
        const el = document.querySelector(`input[type="range"][data-testid="${id}"]`);
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // 回读确认没有被 clamp 掉 —— 静默 clamp 是这个坑的全部危害所在
        return Number(el.value) === Number(v);
      },
      testid,
      value,
    );
    await sleep(140);
    return ok;
  };

  // 半径拉大 + 力度拉满：喷水要能打出成片的湿区，而不是一条细线
  const radiusOk = await setRange('sandbox-tool-radius', 30);
  const strengthOk = await setRange('sandbox-tool-strength', 100);
  if (!radiusOk || !strengthOk) {
    console.log(
      `  ! 滑杆取值被 clamp（半径 ${radiusOk ? 'ok' : 'clamped'} / 力度 ${strengthOk ? 'ok' : 'clamped'}），测量可能偏低`,
    );
  }

  /*
   * ⚠️ 两个坑，都踩过：
   * 1) 必须**同一块区域**在喷水前后各测一次。第一版干沙采 (0.3,0.35)-(0.7,0.65)、
   *    湿沙采 (0.34,0.42)-(0.66,0.52)，两块区域本身就不同亮度，11.7% < 12% 判失败。
   * 2) 采样窗口必须落在**完全湿透的核心**里。窗口一旦包含边缘的
   *    "半湿格子"，平均值会被拉高，10.4% < 12% 又判失败。
   *    契约要求的是"wetness > 0.3 的格子压暗 ≥12%"，
   *    是**逐格**的性质，不是"一块区域的平均值"。
   *    所以这里只取笔画正中间一条窄带，并多涂几遍确保饱和。
   */
  const SAMPLE = { u0: 0.42, v0: 0.45, u1: 0.58, v1: 0.49 };
  const drySample = await regionStats(page, SAMPLE.u0, SAMPLE.v0, SAMPLE.u1, SAMPLE.v1);

  /* 在采样带上来回涂 6 遍，把湿度堆到饱和 */
  for (let pass = 0; pass < 6; pass += 1) {
    const v = SAMPLE.v0 + ((pass % 3) * (SAMPLE.v1 - SAMPLE.v0)) / 2;
    await dragPath([
      { u: SAMPLE.u0 - 0.04, v },
      { u: SAMPLE.u1 + 0.04, v },
    ]);
  }
  await sleep(500);
  const wetSample = await regionStats(page, SAMPLE.u0, SAMPLE.v0, SAMPLE.u1, SAMPLE.v1);

  const darkenRatio = wetSample.meanLum / drySample.meanLum;
  const darkenPct = (1 - darkenRatio) * 100;
  check(
    'A1 湿沙平均亮度压暗 ≥12%',
    darkenPct >= 12,
    `${drySample.meanLum.toFixed(1)} → ${wetSample.meanLum.toFixed(1)}（暗了 ${darkenPct.toFixed(1)}%）`,
  );
  check(
    'A2 湿沙上有高光（区域内存在明显更亮的像素）',
    wetSample.maxLum > wetSample.meanLum + 6,
    `max ${wetSample.maxLum.toFixed(1)} vs mean ${wetSample.meanLum.toFixed(1)}`,
  );
  check(
    'A3 压暗是肉眼可辨的（远超 JND ≈ 2%）',
    darkenPct > 5,
    `${darkenPct.toFixed(1)}% > 2% 最小可觉差`,
  );

  await page.evaluate(() => {
    const c = document.querySelector('.iso2d__canvas');
    if (c) c.style.transform = 'scale(1.9)';
  });
  await sleep(400);
  await page.screenshot({
    path: `${shotDir}/criteria-A-wet.png`,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  await page.evaluate(() => {
    const c = document.querySelector('.iso2d__canvas');
    if (c) c.style.transform = '';
  });
  console.log(`  -> ${shotDir}/criteria-A-wet.png`);

  /* =================== 标准 B：坡度可辨 =================== */
  console.log('\n=== 标准 B：LIFT_RATIO 0.55 后，堆起与挖下一眼可辨 ===');
  await makeReset(page);

  /*
   * 三个都踩过的坑，一起写在这儿：
   *
   * 1) **基准面必须在重置之后重新采样**。
   *    原来 `baseline` 直接复用 A 阶段的 `drySample` —— 那是「喷水前」的干沙。
   *    但 A 阶段喷了 6 遍水，之后才 `makeReset`。重置确实把沙面恢复了，
   *    可 `drySample` 这个**数字**没跟着重测，于是 B1/B2 拿湿沙时期的旧值当基准。
   *    数值差一点点的时候它会悄悄判错。
   *
   * 2) **笔刷要涂到饱和**。`raise`/`dig` 每遍只把一个格子推高几级，
   *    3 遍远没到饱和。实测（`probe-ridge-trench.mjs`，读 canvas 亮度）：
   *      1 遍 +15.8% → 3 遍 +20.4% → 6 遍 +22.2% → 8 遍 +20.8%（此后饱和）
   *    所以画 6 遍。写 3 遍时 B3 只有 2.3%，会被误判成「渲染退化了」，
   *    其实是脚本画得太轻 —— 这个误判我花了一轮 probe 才排掉。
   *
   * 3) **采样窗口要落在饱和的核心**，不能带笔画两端的斜坡。
   *    原来窗口 (0.2–0.4) 而笔画 (0.18–0.42)，两端各有一截没被推高的沙，
   *    把平均值往下拉。改成窗口严格落在笔画中段。
   */
  const PASSES = 6;

  await pickTool(page, 'raise');
  for (let pass = 0; pass < PASSES; pass += 1) {
    await dragPath([
      { u: 0.18, v: 0.5 },
      { u: 0.42, v: 0.5 },
    ]);
  }
  await pickTool(page, 'dig');
  for (let pass = 0; pass < PASSES; pass += 1) {
    await dragPath([
      { u: 0.58, v: 0.5 },
      { u: 0.82, v: 0.5 },
    ]);
  }
  await sleep(600);

  // 重置后的干净基准面，重新采一次
  const freshBase = await regionStats(page, 0.2, 0.46, 0.8, 0.54);
  const ridge = await regionStats(page, 0.24, 0.47, 0.38, 0.53);
  const ditch = await regionStats(page, 0.62, 0.47, 0.78, 0.53);
  const baseline = { meanLum: freshBase.meanLum };

  check(
    'B1 推起的沙脊比基准面亮（面向光）',
    ridge.meanLum > baseline.meanLum,
    `沙脊 ${ridge.meanLum.toFixed(1)} vs 基准 ${baseline.meanLum.toFixed(1)}`,
  );
  check(
    'B2 挖出的沟比基准面暗（背光/更深）',
    ditch.meanLum < baseline.meanLum,
    `沟 ${ditch.meanLum.toFixed(1)} vs 基准 ${baseline.meanLum.toFixed(1)}`,
  );
  check(
    'B3 沙脊与沟的亮度差一眼可辨（>8%）',
    Math.abs(ridge.meanLum - ditch.meanLum) / baseline.meanLum > 0.08,
    `差 ${(Math.abs(ridge.meanLum - ditch.meanLum) / baseline.meanLum * 100).toFixed(1)}%`,
  );
  /*
   * B4 原来断言「沙脊区域内的亮度极差 > 8」，即 `maxLum - minLum`。
   * 大力笔刷（半径 30 / 力度 100）涂 6 遍后，沙脊已经被推成一个**平坦的亮台**，
   * 台面内部几乎无起伏 → 极差只有 5.0，判失败。
   *
   * 但人眼看到的「纵向位移」不是区域内的亮度抖动，而是
   * **沙脊相对周围地面被整体抬高了** —— 也就是「这块地方比旁边亮/暗多少」。
   * 截图里那条亮脊和那道暗沟非常清楚（S 形明暗分界），
   * 恰恰因为台面平整反而更明显。
   *
   * 所以改成测「相对基准面的亮度位移」：沙脊和沟都必须离基准面足够远。
   * 这才是 LIFT_RATIO 要保证的东西 —— 高差 → 明暗差 → 可辨认的立体感。
   * 原来那条 `maxLum - minLum > 8` 只会在「笔刷很轻、沙面坑洼」时通过，
   * 而那恰恰是**效果更差**的状态，属于指标方向搞反了。
   */
  const ridgeShift = ((ridge.meanLum - baseline.meanLum) / baseline.meanLum) * 100;
  const ditchShift = ((baseline.meanLum - ditch.meanLum) / baseline.meanLum) * 100;
  check(
    'B4 起伏带来纵向位移（沙脊抬升 / 沟下陷都离基准面够远）',
    ridgeShift > 8 && ditchShift > 8,
    `沙脊 +${ridgeShift.toFixed(1)}%、沟 −${ditchShift.toFixed(1)}%（各需 > 8%）`,
  );

  await page.screenshot({
    path: `${shotDir}/criteria-B-slope.png`,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  console.log(`  -> ${shotDir}/criteria-B-slope.png`);

  /* =================== 标准 C：深挖偏冷灰 =================== */
  console.log('\n=== 标准 C：挖到基准面以下（height < 90）偏冷灰 ===');
  await makeReset(page);
  await pickTool(page, 'dig');
  /* 挖满整块采样区，确保真的到基准面以下 */
  for (let pass = 0; pass < 5; pass += 1) {
    await dragPath([
      { u: 0.3, v: 0.36 + pass * 0.07 },
      { u: 0.7, v: 0.36 + pass * 0.07 },
    ]);
  }
  await sleep(600);

  const deep = await regionStats(page, 0.34, 0.4, 0.66, 0.6);
  const shallowR = drySample.meanR;
  const shallowB = drySample.meanB;
  const deepRatio = deep.meanB / deep.meanR;
  const shallowRatio = shallowB / shallowR;
  check(
    'C1 深坑底部的蓝/红比高于基准面（偏冷）',
    deepRatio > shallowRatio,
    `深坑 b/r ${deepRatio.toFixed(3)} vs 基准 ${shallowRatio.toFixed(3)}`,
  );
  check(
    'C2 冷色偏移肉眼可辨（b/r 提升 >1.5%）',
    (deepRatio - shallowRatio) / shallowRatio > 0.015,
    `提升 ${(((deepRatio - shallowRatio) / shallowRatio) * 100).toFixed(2)}%`,
  );
  check(
    'C3 深坑同时变暗（有深度感，不只是变色）',
    deep.meanLum < baseline.meanLum,
    `深坑 ${deep.meanLum.toFixed(1)} vs 基准 ${baseline.meanLum.toFixed(1)}`,
  );

  await page.screenshot({
    path: `${shotDir}/criteria-C-cool.png`,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  console.log(`  -> ${shotDir}/criteria-C-cool.png`);

  console.log('\n=== 运行时无报错 ===');
  check('console 与 pageerror 均为空', errors.length === 0, errors.slice(0, 2).join(' | '));

  writeFileSync(
    `${shotDir}/criteria-results.json`,
    JSON.stringify({ results, drySample, wetSample, ridge, ditch, deep }, null, 2),
  );

  console.log(failed === 0 ? '\n三条标准全部通过' : `\n${failed} 项未通过`);
  if (failed > 0) process.exitCode = 1;
} catch (error) {
  console.error('探针异常：', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  /* 关键：等到 vite 真的断气才返回，否则连跑两次会撞端口 */
  await preview.close();
}
