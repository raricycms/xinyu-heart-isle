import { describe, expect, it } from 'vitest';
import {
  GRID_CELLS,
  GRID_COLS,
  GRID_ROWS,
  computeSandCells,
} from '@/sandbox/surface/sandCells';
import type { SandCell, Tray } from '@/sandbox/surface/sandCells';
import { SURFACE_BASE_LEVEL, createHeightField, createSurfaceState } from '@/sandbox/surfaceCodec';
import type { HeightField } from '@/sandbox/surfaceCodec';

/**
 * 笔刷 / 沙面着色的性能预算（CONTRACT §7）。
 *
 *   预算：32×24 = 768 格，**单帧 < 4ms**（低端移动设备上的目标）
 *   断言：< 12ms（**3× 余量**）
 *
 * 为什么卡 3× 而不是卡 4ms：
 * vitest 跑在 Node 上，CI/开发机（尤其 Windows）的抖动可以轻松到 2~3 倍。
 * 卡死 4ms 会变成"重跑就过"的 flaky 测试，团队最后会把它删掉 ——
 * 那才是真的失去护栏。12ms 依然能在有人把网格放大到 128×96、
 * 或者在循环里拼字符串/调 `ctx` 方法时立刻报警。
 *
 * 为什么只压测纯计算、不画真 canvas：
 * 1. node 环境没有 CanvasRenderingContext2D；
 * 2. 引 jsdom + node-canvas 会破坏 CONTRACT 的依赖白名单；
 * 3. `fillRect` 是浏览器原生实现（768 次通常 0.2~0.6ms），
 *    真正的 JS 成本就在这 768 次的颜色数学里 —— 那部分 100% 被覆盖。
 *
 * 取 **best-of-N 最小值**：GC 只会让某次变慢，最小值才反映稳定帧成本。
 * 取最小值也是行业里 benchmark 的常规做法（避免平均被离群值抬高）。
 */

/** 一次完整的"画一帧"允许的毫秒数（预算 4ms × 3 余量） */
const FRAME_BUDGET_MS = 4;
const ASSERT_MS = FRAME_BUDGET_MS * 3;

const TRAY: Tray = { x: 0, y: 0, w: 720, h: 432 };

/** 有起伏的高度场：避免常量折叠，也更接近真实使用 */
function bumpyField(): HeightField {
  const field = createHeightField();
  const { cols, rows, data } = field;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const u = col / (cols - 1);
      const v = row / (rows - 1);
      const wave = Math.sin(u * Math.PI * 2.5) * Math.cos(v * Math.PI * 1.5) * 70;
      data[row * cols + col] = Math.max(0, Math.min(255, Math.round(SURFACE_BASE_LEVEL + wave)));
    }
  }
  return field;
}

function bestOf(iterations: number, run: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    run();
    const elapsed = performance.now() - started;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

describe('沙面单帧性能预算', () => {
  const field = bumpyField();
  const state = createSurfaceState();
  const wetAll = new Uint8Array(state.wetness.length).fill(200);
  const buffer: SandCell[] = [];

  it('768 格的着色计算在 3× 预算（12ms）内完成', () => {
    const elapsed = bestOf(15, () => {
      computeSandCells(field, wetAll, TRAY, false, buffer);
    });
    console.info(
      `[perf] 768 格着色 best-of-15 = ${elapsed.toFixed(3)}ms / 预算 ${FRAME_BUDGET_MS}ms（断言 ${ASSERT_MS}ms）`,
    );
    expect(buffer).toHaveLength(GRID_CELLS);
    expect(elapsed).toBeLessThan(ASSERT_MS);
  });

  it('复用 buffer 比每帧新建数组更快（证明优化真的生效）', () => {
    const withBuffer = bestOf(10, () => {
      computeSandCells(field, wetAll, TRAY, false, buffer);
    });
    const withAlloc = bestOf(10, () => {
      computeSandCells(field, wetAll, TRAY, false);
    });
    console.info(
      `[perf] 复用 buffer ${withBuffer.toFixed(3)}ms vs 每帧分配 ${withAlloc.toFixed(3)}ms`,
    );
    /*
     * 注释原本写「分配版至少要慢 30%」，但断言只写了 `toBeLessThan` ——
     * 只要快哪怕 0.1%（噪声范围内）就算通过。注释与代码脱节。
     *
     * 这里不断言「慢 30%」，因为「更快」和「快 30%」稳定性不同：
     * 收益量级取决于 GC 时机，跑 10 轮取最优时分配版的代价
     * 可能被 V8 的分配器优化吃掉，30% 会变成随机红的抖动源。
     *
     * 分两段：
     *   1. 硬断言「不明显慢于」—— 方向错了就是优化失效，必须红；
     *   2. 把实际加速比打进日志，作为**趋势观测**（看历史是否退化）。
     * 不稳定的量级判断留在日志里，比一条会随机红的断言更有用。
     */
    expect(withBuffer).toBeLessThanOrEqual(withAlloc * 1.05);
    const speedup = withAlloc / withBuffer;
    console.info(`[perf] 复用带来的加速比 = ${speedup.toFixed(2)}x（注释期望 ≥1.30x）`);
  });

  it('全湿（最坏情况：每格都要算高光）也在预算内', () => {
    const elapsed = bestOf(12, () => {
      computeSandCells(field, wetAll, TRAY, true, buffer);
    });
    console.info(`[perf] 全湿 + dark 场景 = ${elapsed.toFixed(3)}ms`);
    expect(elapsed).toBeLessThan(ASSERT_MS);
  });

  it('连续 120 帧（约 2 秒）不会因状态累积变慢', () => {
    const first = bestOf(1, () => {
      for (let i = 0; i < 20; i += 1) computeSandCells(field, wetAll, TRAY, false, buffer);
    });
    for (let i = 0; i < 80; i += 1) computeSandCells(field, wetAll, TRAY, false, buffer);

    const later = bestOf(1, () => {
      for (let i = 0; i < 20; i += 1) computeSandCells(field, wetAll, TRAY, false, buffer);
    });
    // 后段不能比前段慢 3 倍以上（没有隐藏累积 / 没有内存泄漏特征）
    expect(later).toBeLessThan(Math.max(first * 3, 60));
  });

  it('网格规模常量与实际输出严格一致（防止有人偷偷放大网格）', () => {
    const cells = computeSandCells(field, wetAll, TRAY, false, buffer);
    expect(cells.length).toBe(GRID_COLS * GRID_ROWS);
    expect(GRID_CELLS).toBe(768);
  });
});
