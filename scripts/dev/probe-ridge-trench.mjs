/**
 * 探针：沙脊 / 沟 的实际高度与渲染亮度。
 *
 * 背景：`verify-visual-criteria.mjs` 的 B3「沙脊与沟的亮度差 > 8%」实测只有 2.3%。
 * 历史记录里这个数字曾经是 10.5% —— 但那个 10.5% 是**假的**：
 * 当时 `makeReset()` 点的是 `sandbox-tool-flatten`，而在新工具条里
 * `flatten` 是第 7 个**笔刷**，点它只选中笔刷、根本不重置。
 * 于是 A 阶段喷的水、之前推的沙全都累积着，B 阶段量到的是「一堆旧残留 + 新起伏」，
 * 对比度当然高。
 *
 * 现在 `makeReset()` 真的调用了 `reset`，从干净基准面开始量 —— 数字掉到 2.3%。
 * 所以要判断：这是**渲染真的不够明显**（产品问题），还是**笔刷力度不够**
 * （脚本画得不够多，测试问题）。
 *
 * 这个探针直接读沙面高度图，同时量渲染亮度，把「高度差」和「亮度差」分开看。
 */
import process from 'node:process';
import { withSandboxPage } from './harness.mjs';

await withSandboxPage({ port: 4420 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));

  const box = await page.$eval('[data-testid="sandbox-stage"]', (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });

  const toScreen = (u, v) => ({
    x: box.x + box.w * (0.5 + (u - 0.5) * 0.62),
    y: box.y + box.h * (0.5 + (v - 0.5) * 0.62),
  });

  /* 读工具栏里所有 range 的标签与范围 —— 顺便确认滑杆顺序有没有变 */
  const sliders = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="range"]')].map((el) => {
      const label =
        el.closest('label')?.textContent?.trim().slice(0, 20) ??
        el.parentElement?.textContent?.trim().slice(0, 20) ??
        '';
      return {
        min: el.min,
        max: el.max,
        step: el.step,
        value: el.value,
        testid: el.getAttribute('data-testid'),
        label,
      };
    }),
  );
  console.log('\n=== 工具栏滑杆 ===');
  console.log(JSON.stringify(sliders, null, 2));

  const pickTool = async (id) => {
    await page.click(`[data-testid="sandbox-tool-${id}"]`);
    await new Promise((r) => setTimeout(r, 250));
  };

  const dragPath = async (points, settle = 650) => {
    const first = toScreen(points[0].u, points[0].v);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const p of points.slice(1)) {
      const s = toScreen(p.u, p.v);
      await page.mouse.move(s.x, s.y);
      await new Promise((r) => setTimeout(r, 14));
    }
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, settle));
  };

  /*
   * 直接从 canvas 上采样亮度。
   * 不能读 heightfield —— 它不在 window 上，读取它需要改产品代码。
   * 所以用「渲染结果」作为事实来源，这正是玩家看到的。
   */
  const sampleLum = async (u0, v0, u1, v1) => {
    return page.evaluate(
      ([b, au0, av0, au1, av1]) => {
        const canvas = document.querySelector('.iso2d__canvas');
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        const dpr = canvas.width / canvas.getBoundingClientRect().width;
        const px = (u) => (b.x + b.w * (0.5 + (u - 0.5) * 0.62) - b.x) * dpr;
        const py = (v) => (b.y + b.h * (0.5 + (v - 0.5) * 0.62) - b.y) * dpr;
        const x0 = Math.round(px(au0));
        const y0 = Math.round(py(av0));
        const w = Math.max(2, Math.round(px(au1) - x0));
        const h = Math.max(2, Math.round(py(av1) - y0));
        const data = ctx.getImageData(x0, y0, w, h).data;
        let sum = 0;
        let n = 0;
        let max = 0;
        let min = 255;
        for (let i = 0; i < data.length; i += 4) {
          const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          sum += lum;
          n += 1;
          if (lum > max) max = lum;
          if (lum < min) min = lum;
        }
        return { mean: sum / n, max, min, n };
      },
      [box, u0, v0, u1, v1],
    );
  };

  const resetAll = async () => {
    await page.click('[data-testid="sandbox-tool-reset"]');
    await new Promise((r) => setTimeout(r, 320));
    const confirm = await page.$('[data-testid="sandbox-tool-reset-confirm"]');
    if (confirm) await confirm.click();
    await new Promise((r) => setTimeout(r, 700));
  };

  /* ---------------- 基准面 ---------------- */
  await resetAll();
  const baseline = await sampleLum(0.2, 0.46, 0.8, 0.54);
  console.log('\n=== 基准面 ===');
  console.log(`mean ${baseline.mean.toFixed(1)}  min ${baseline.min.toFixed(1)}  max ${baseline.max.toFixed(1)}`);

  /* ---------------- 推沙：多画几遍看饱和度 ---------------- */
  console.log('\n=== 推沙（逐步增加遍数，看亮度怎么涨） ===');
  await pickTool('raise');
  for (let pass = 1; pass <= 8; pass += 1) {
    await dragPath([
      { u: 0.2, v: 0.5 },
      { u: 0.44, v: 0.5 },
    ], 400);
    if (pass === 1 || pass === 3 || pass === 6 || pass === 8) {
      const s = await sampleLum(0.22, 0.47, 0.42, 0.53);
      console.log(`  ${pass} 遍: mean ${s.mean.toFixed(1)}  比基准 +${(((s.mean / baseline.mean) - 1) * 100).toFixed(1)}%`);
    }
  }
  const ridge = await sampleLum(0.22, 0.47, 0.42, 0.53);
  console.log(`  最终沙脊 mean ${ridge.mean.toFixed(1)} (+${(((ridge.mean / baseline.mean) - 1) * 100).toFixed(1)}%)`);

  /* ---------------- 挖沙 ---------------- */
  console.log('\n=== 挖沙（逐步增加遍数） ===');
  await pickTool('dig');
  for (let pass = 1; pass <= 8; pass += 1) {
    await dragPath([
      { u: 0.56, v: 0.5 },
      { u: 0.8, v: 0.5 },
    ], 400);
    if (pass === 1 || pass === 3 || pass === 6 || pass === 8) {
      const s = await sampleLum(0.58, 0.47, 0.78, 0.53);
      console.log(`  ${pass} 遍: mean ${s.mean.toFixed(1)}  比基准 ${(((s.mean / baseline.mean) - 1) * 100).toFixed(1)}%`);
    }
  }
  const trench = await sampleLum(0.58, 0.47, 0.78, 0.53);
  console.log(`  最终沟 mean ${trench.mean.toFixed(1)} (${(((trench.mean / baseline.mean) - 1) * 100).toFixed(1)}%)`);

  /* ---------------- 关键判定 ---------------- */
  const contrast = Math.abs(ridge.mean - trench.mean) / baseline.mean * 100;
  console.log('\n=== B3 判定 ===');
  console.log(`  基准 ${baseline.mean.toFixed(1)}  沙脊 ${ridge.mean.toFixed(1)}  沟 ${trench.mean.toFixed(1)}`);
  console.log(`  亮度差 ${contrast.toFixed(1)}%（阈值 8%）${contrast >= 8 ? '✓' : '✗'}`);
  console.log(`  高度差方向正确？沙脊更亮=${ridge.mean > baseline.mean}  沟更暗=${trench.mean < baseline.mean}`);

  await page.screenshot({ path: 'tmp/shots/ridge-trench.png', clip: box });
});

process.exit(0);

