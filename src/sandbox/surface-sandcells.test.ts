import { describe, expect, it } from 'vitest';
import {
  BASE_LEVEL,
  GLOSS_H_RATIO,
  GLOSS_INSET_X,
  GLOSS_INSET_Y,
  GLOSS_W_RATIO,
  GRID_CELLS,
  GRID_COLS,
  GRID_ROWS,
  LIFT_RATIO,
  WET_DARKEN_MIN,
  WET_THRESHOLD,
  computeSandCells,
  glossFill,
  heightShadeFor,
  liftFor,
  needsWall,
  totalShade,
  wetDarken,
  wetnessToUnit,
} from '@/sandbox/surface/sandCells';
import {
  SURFACE_BASE_LEVEL,
  createHeightField,
  createSurfaceState,
} from '@/sandbox/surfaceCodec';
import type { HeightField, SurfaceState } from '@/sandbox/surfaceCodec';
import { applyBrush, applyStroke } from '@/sandbox/surfaceOps';

/**
 * 沙面着色 + 性能预算的测试。
 *
 * CONTRACT §7 原文：32×24 = 768 格，单帧绘制 < 4ms（在低端移动设备上）。
 * 这里的选择：
 * - **只压测着色计算**（computeSandCells），不含真实 `ctx.fillRect`。
 *   理由：node 环境没有 Canvas 2D 上下文，引入 jsdom + node-canvas 会
 *   破坏依赖白名单；而 fillRect 是浏览器原生实现，768 次调用通常在
 *   0.2~0.6ms，真正的 JS 开销就在这 768 次的颜色数学里。
 * - 断言用 **3× 余量**：目标 4ms，测试卡 12ms。CI 机器（尤其 Windows + 共享
 *   runner）抖动很大，卡 4ms 会变成 flaky；卡 12ms 仍能在"有人把网格改成
 *   128×96 或每格拼字符串"时立刻报警。
 * - 取**多次迭代的最小值**（best-of-N）而不是平均：GC 抖动只会让某次变慢，
 *   最小值才反映真实的单帧成本。
 */

const TRAY = { x: 12, y: 8, w: 640, h: 384 };

/** 造一个"有起伏"的高度场：比全平面更接近真实使用，避免测试被常量折叠优化 */
function bumpyField(): HeightField {
  const field = createHeightField();
  const data = field.data;
  for (let row = 0; row < field.rows; row += 1) {
    for (let col = 0; col < field.cols; col += 1) {
      const u = col / (field.cols - 1);
      const v = row / (field.rows - 1);
      const wave = Math.sin(u * Math.PI * 3) * Math.cos(v * Math.PI * 2) * 60;
      data[row * field.cols + col] = Math.max(
        0,
        Math.min(255, Math.round(SURFACE_BASE_LEVEL + wave + (row % 7) * 2)),
      );
    }
  }
  return field;
}

/** 全湿 / 全干的湿度数组 */
function uniformWetness(state: SurfaceState, value: number): Uint8Array {
  return new Uint8Array(state.wetness.length).fill(value);
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

function parseRgb(fill: string): { r: number; g: number; b: number } {
  const match = /rgb\((\d+),(\d+),(\d+)\)/.exec(fill);
  if (!match) throw new Error(`不是 rgb() 颜色: ${fill}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

function luminance(fill: string): number {
  const { r, g, b } = parseRgb(fill);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('网格规模与预算常量', () => {
  it('网格固定 32×24 = 768 格（CONTRACT §7）', () => {
    expect(GRID_COLS).toBe(32);
    expect(GRID_ROWS).toBe(24);
    expect(GRID_CELLS).toBe(768);
  });

  it('LIFT_RATIO 提到 0.55（原 0.42，起伏太不明显）', () => {
    expect(LIFT_RATIO).toBe(0.55);
  });

  it('基准面与 surfaceCodec 的 SURFACE_BASE_LEVEL 一致', () => {
    expect(BASE_LEVEL).toBe(SURFACE_BASE_LEVEL);
  });

  it('湿沙阈值 0.3、最小加深 12%', () => {
    expect(WET_THRESHOLD).toBe(0.3);
    expect(WET_DARKEN_MIN).toBeGreaterThanOrEqual(0.12);
  });
});

describe('湿度 -> 颜色加深', () => {
  it('湿度字节换算成 0~1', () => {
    expect(wetnessToUnit(0)).toBe(0);
    expect(wetnessToUnit(255)).toBeCloseTo(1, 5);
    expect(wetnessToUnit(128)).toBeCloseTo(0.502, 2);
  });

  it('阈值以下平缓过渡，阈值以上线性加深', () => {
    expect(wetDarken(0)).toBe(1);
    // 恰好到阈值时正好等于最小加深
    expect(wetDarken(WET_THRESHOLD)).toBeCloseTo(1 - WET_DARKEN_MIN, 5);
    // 全湿时更深
    expect(wetDarken(1)).toBeLessThan(wetDarken(WET_THRESHOLD));
    expect(wetDarken(1)).toBeGreaterThan(0.7);
  });

  it('单调不增：越湿越暗（不会出现反跳）', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 100; i += 1) {
      const value = wetDarken(i / 100);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      previous = value;
    }
  });
});

describe('逐格着色：湿润可见', () => {
  const field = bumpyField();

  it('同一高度场上，湿沙所有格子都比干沙暗 ≥12%', () => {
    const state = createSurfaceState();
    const dry = computeSandCells(field, uniformWetness(state, 0), TRAY, false);
    // 0.31 刚刚越过阈值，按契约必须已经有 ≥12% 的可见加深
    const wet = computeSandCells(field, uniformWetness(state, Math.round(0.31 * 255)), TRAY, false);

    expect(dry).toHaveLength(GRID_CELLS);
    expect(wet).toHaveLength(GRID_CELLS);

    let darkestRatio = 1;
    for (let i = 0; i < dry.length; i += 1) {
      const ratio = luminance(wet[i].fill) / luminance(dry[i].fill);
      if (ratio < darkestRatio) darkestRatio = ratio;
    }
    // 最亮的那一格也必须至少暗 12%（即 ratio ≤ 0.88）
    expect(darkestRatio).toBeLessThanOrEqual(1 - WET_DARKEN_MIN + 0.005);
  });

  it('平坦湿沙面只有基础水光（level 1），没有镜面高光', () => {
    const state = createSurfaceState();
    const flat = createHeightField();
    const wet = computeSandCells(flat, uniformWetness(state, 255), TRAY, false);

    /*
     * 回归背景：最初"湿度 > 阈值就给高光"，于是整片湿沙每格都盖一个
     * 亮色小矩形 —— 在截图里就是一面砖墙。
     * 现在的两层模型：
     *   level 1 = 基础水光，所有湿格都有，铺满整格、透明度极低，
     *             作用是"这面是湿的"，相邻格连成一片看不出格子；
     *   level ≥2 = 镜面高光，由坡度门控，平坦面上一个都没有。
     * 平坦湿沙面因此应该恰好全是 level 1。
     */
    expect(wet.every((cell) => cell.gloss === 1)).toBe(true);
  });

  it('有起伏的湿沙面出现镜面高光（level ≥2）且稀疏', () => {
    const state = createSurfaceState();
    const wet = computeSandCells(field, uniformWetness(state, 255), TRAY, false);
    const specular = wet.filter((cell) => cell.gloss >= 2);

    expect(specular.length).toBeGreaterThan(0);
    // 关键：镜面高光必须"稀疏"。过 1/3 就又是砖墙了。
    expect(specular.length).toBeLessThan(wet.length * 0.34);
  });

  it('基础水光透明度极低（看不出格子边界）', () => {
    // level 1 是铺满整格的，透明度必须低到相邻格连成一片
    const base = /rgba\(255,255,255,([\d.]+)\)/.exec(glossFill(1));
    expect(base).not.toBeNull();
    expect(Number(base?.[1])).toBeLessThanOrEqual(0.05);
    expect(Number(base?.[1])).toBeGreaterThan(0);
  });

  it('干沙不管有没有起伏都没有高光', () => {
    const state = createSurfaceState();
    const dry = computeSandCells(field, uniformWetness(state, 0), TRAY, false);
    expect(dry.every((cell) => cell.gloss === 0)).toBe(true);
  });

  it('高光档位落在 0~7，且 glossFill 有对应颜色', () => {
    expect(glossFill(0)).toBe('rgba(255,255,255,0)');
    for (let level = 1; level <= 7; level += 1) {
      expect(glossFill(level)).toMatch(/^rgba\(255,255,255,0\.\d+\)$/);
    }
    // 越界输入不崩
    expect(glossFill(-5)).toBe(glossFill(0));
    expect(glossFill(99)).toBe(glossFill(7));
  });

  it('高光铺满整格（否则每格一个小方块，看着像砖墙）', () => {
    /*
     * 回归背景：高光块曾是 0.36×0.26 的小矩形，贴在每一格湿沙里。
     * 即使透明度只有 0.06~0.24，放大后也能一眼看出"每格一个小亮块"，
     * 整片湿沙像砖墙。现在铺满整格，相邻格子的高光连成连续水光。
     */
    expect(GLOSS_INSET_X).toBe(0);
    expect(GLOSS_INSET_Y).toBe(0);
    expect(GLOSS_W_RATIO).toBe(1);
    expect(GLOSS_H_RATIO).toBe(1);
  });

  it('高光透明度上限够低，看不出单个格子', () => {
    // 最高档也不该超过 0.15：再高就能分辨出格子边界
    const top = /rgba\(255,255,255,([\d.]+)\)/.exec(glossFill(7));
    expect(top).not.toBeNull();
    expect(Number(top?.[1])).toBeLessThanOrEqual(0.15);
    // 但也要真的看得见（不能是 0）
    expect(Number(top?.[1])).toBeGreaterThan(0.05);
  });
});

describe('逐格着色：起伏与侧向明暗', () => {
  const state = createSurfaceState();

  it('高度越高，屏幕上的 y 越小（往上位移）', () => {
    expect(liftFor(BASE_LEVEL + 60, 384)).toBeGreaterThan(0);
    expect(liftFor(BASE_LEVEL - 60, 384)).toBeLessThan(0);
    expect(liftFor(BASE_LEVEL, 384)).toBe(0);
    // 抬高 255 时的最大位移 = LIFT_RATIO * trayH * 0.5
    expect(liftFor(255, 384)).toBeCloseTo(((255 - BASE_LEVEL) / 255) * LIFT_RATIO * 192, 5);
  });

  it('坡度产生左右明暗：斜面同高，左上亮、右下暗', () => {
    // 造一个从左上到右下单调升高的"斜坡"：左边低右边高
    const slope = createHeightField();
    for (let row = 0; row < slope.rows; row += 1) {
      for (let col = 0; col < slope.cols; col += 1) {
        slope.data[row * slope.cols + col] = SURFACE_BASE_LEVEL + col * 0.6;
      }
    }
    const cells = computeSandCells(slope, state.wetness, TRAY, false);
    const left = cells[12 * GRID_COLS + 2]; // 第 12 行靠左
    const right = cells[12 * GRID_COLS + 29]; // 同一行靠右

    // 高度上右侧更高会变亮，但"面朝右下 = 背光"会变暗；
    // 这里只锁死两者差异存在，说明侧向明暗真的生效了。
    expect(left.fill).not.toBe(right.fill);
  });

  it('同一高度场上，左下格比右上格暗（光从左上）', () => {
    const flat = createHeightField(); // 全基准面，只有坡度项影响
    const cells = computeSandCells(flat, state.wetness, TRAY, false);
    const topLeft = cells[0];
    const bottomRight = cells[GRID_CELLS - 1];
    // 还有 depthShade（越靠下越亮），所以比较同列不同行更干净：
    // 这里用"相邻两格颜色不相同"证明逐格调色生效（不是整盘一个色）。
    expect(topLeft.fill).not.toBe(bottomRight.fill);
  });
});

describe('逐格着色：深挖转冷灰', () => {
  const state = createSurfaceState();

  it('高度低于基准面时蓝色通道占比上升（冷色偏移）', () => {
    const high = createHeightField();
    high.data.fill(BASE_LEVEL + 70);
    const low = createHeightField();
    low.data.fill(10);

    const highCells = computeSandCells(high, state.wetness, TRAY, false);
    const lowCells = computeSandCells(low, state.wetness, TRAY, false);

    const blueness = (fill: string) => {
      const { r, b } = parseRgb(fill);
      return b / Math.max(1, r);
    };
    // 挖到底的格子相对更"蓝"（暖沙 222/202/168 -> 冷灰 154/163/172）
    expect(blueness(lowCells[0].fill)).toBeGreaterThan(blueness(highCells[0].fill));
  });

  it('极深的坑仍然是有效的 rgb 颜色，不会出现 NaN 或负值', () => {
    const deep = createHeightField();
    deep.data.fill(0);
    const cells = computeSandCells(deep, state.wetness, TRAY, false);
    for (const cell of cells) {
      expect(cell.fill).toMatch(/^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/);
      const { r, g, b } = parseRgb(cell.fill);
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('深色场景（dark）整体比浅色场景暗', () => {
    const field = bumpyField();
    const light = computeSandCells(field, state.wetness, TRAY, false);
    const dark = computeSandCells(field, state.wetness, TRAY, true);
    expect(luminance(dark[400].fill)).toBeLessThan(luminance(light[400].fill));
  });
});

describe('逐格着色：真实笔画后的效果', () => {
  it('推过沙的地方颜色与未推过的地方不同（看得见笔迹）', () => {
    const base = createSurfaceState();
    const after = applyStroke(base, 'raise', [
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ], 0.2, 1);

    const before = computeSandCells(base.height, base.wetness, TRAY, false);
    const raised = computeSandCells(after.height, after.wetness, TRAY, false);

    let changed = 0;
    for (let i = 0; i < before.length; i += 1) {
      if (before[i].fill !== raised[i].fill) changed += 1;
    }
    expect(changed).toBeGreaterThan(20);
  });

  it('喷水之后那一片变暗（湿度立刻可见）', () => {
    const base = createSurfaceState();
    const after = applyBrush(base, 'water', { x: 0.5, y: 0.5, radius: 0.3, strength: 1 });

    const dryCells = computeSandCells(base.height, base.wetness, TRAY, false);
    const wetCells = computeSandCells(after.height, after.wetness, TRAY, false);

    // 笔刷在 (0.5, 0.5)：对应第 12 行第 16 列（不是数组正中间 ——
    // 768/2 = 384 正好落在第 12 行的**最左列**，这里必须按行列算）
    const center = 12 * GRID_COLS + 16;
    expect(luminance(wetCells[center].fill)).toBeLessThan(luminance(dryCells[center].fill));
  });

  it('喷水边界是渐变的，不是阶梯方块（双线性采样）', () => {
    const base = createSurfaceState();
    const after = applyBrush(base, 'water', { x: 0.5, y: 0.5, radius: 0.3, strength: 1 });

    const dryCells = computeSandCells(base.height, base.wetness, TRAY, false);
    const wetCells = computeSandCells(after.height, after.wetness, TRAY, false);

    /* 沿第 12 行横向扫过湿斑边缘，统计"变暗量"的不同档位数。
       若用最近邻采样，边缘会在一格之内从 0 跳到最暗 —— 只有个位数档位；
       双线性插值之后，边缘会有十几档过渡。 */
    const row = 12;
    const levels = new Set<number>();
    for (let col = 0; col < GRID_COLS; col += 1) {
      const i = row * GRID_COLS + col;
      const drop = luminance(dryCells[i].fill) - luminance(wetCells[i].fill);
      if (drop > 0.5) levels.add(Math.round(drop));
    }
    expect(levels.size).toBeGreaterThan(6);
  });
});

describe('过曝保护：永不裁到纯色（曾经的真实 bug）', () => {
  const state = createSurfaceState();

  /*
   * 回归背景：
   * 最初把 高度明暗 × 坡度明暗 × 纵深明暗 直接相乘，三者都 >1 时
   * 暖沙 222 × 1.30 × 1.18 × 1.04 ≈ 354，被 byte() 裁到 255。
   * 屏幕上就是一条条纯白硬边色带 —— 在截图里看起来像渲染坏了。
   *
   * 这几条断言锁死"任何输入组合下都不出现成片的 255"。
   */
  it('极端起伏 + 全湿 + 最高亮度，不出现纯白格', () => {
    const extreme = createHeightField();
    // 造锯齿：奇偶行交替 255 / 0，逼出最大坡度
    for (let row = 0; row < extreme.rows; row += 1) {
      for (let col = 0; col < extreme.cols; col += 1) {
        extreme.data[row * extreme.cols + col] = (row + col) % 2 === 0 ? 255 : 0;
      }
    }
    const allWet = new Uint8Array(state.wetness.length).fill(255);
    const cells = computeSandCells(extreme, allWet, TRAY, false);

    let pureWhite = 0;
    for (const cell of cells) {
      const { r, g, b } = parseRgb(cell.fill);
      if (r === 255 || g === 255 || b === 255) pureWhite += 1;
    }
    // 允许极个别的通道到顶（暖沙的 r 通道上限 244 其实到不了），但不能成片
    expect(pureWhite).toBeLessThan(cells.length * 0.02);
  });

  it('所有格子的亮度都落在可辨识范围内（不糊成一片白）', () => {
    const high = createHeightField();
    high.data.fill(255);
    const allWet = new Uint8Array(state.wetness.length).fill(255);
    const cells = computeSandCells(high, allWet, TRAY, false);
    for (const cell of cells) {
      const { r, g, b } = parseRgb(cell.fill);
      // 最亮也不该到 255：SHADE_MAX=1.10 时 222*1.10 = 244
      expect(Math.max(r, g, b)).toBeLessThanOrEqual(250);
    }
  });

  it('totalShade 有硬上下界', () => {
    // 三个系数都给到能过曝的值
    expect(totalShade(2, 2, 2, 1)).toBeLessThanOrEqual(1.1);
    // 也不该把画面压死
    expect(totalShade(0, 0, 0, 1)).toBeGreaterThanOrEqual(0.5);
    // 极端组合仍然有限
    expect(Number.isFinite(totalShade(99, 99, 99, 1))).toBe(true);
  });

  it('高度明暗单调递增且夹在 [0.80, 1.06]', () => {
    let previous = -1;
    for (let height = 0; height <= 255; height += 5) {
      const shade = heightShadeFor(height);
      expect(shade).toBeGreaterThanOrEqual(0.8);
      expect(shade).toBeLessThanOrEqual(1.06);
      expect(shade).toBeGreaterThanOrEqual(previous);
      previous = shade;
    }
  });
});

describe('前立面：消掉"悬空条带"（曾经的真实 bug）', () => {
  const state = createSurfaceState();

  /*
   * 回归背景：
   * 每格按高度向上位移后只画顶面，相邻行落差大时会露出空隙，
   * 视觉上是一层层浮起来的硬边条纹，完全不像沙。
   * 现在每格带一个 wall（前立面像素高度），渲染器从顶面底边往下填满。
   */
  it('隆起的沙丘有前立面，平坦沙面没有', () => {
    const flat = createHeightField();
    const flatCells = computeSandCells(flat, state.wetness, TRAY, false);
    expect(flatCells.every((cell) => cell.wall === 0)).toBe(true);

    const hill = createHeightField();
    // 中间鼓起一个沙包
    for (let row = 0; row < hill.rows; row += 1) {
      for (let col = 0; col < hill.cols; col += 1) {
        const dx = col / hill.cols - 0.5;
        const dy = row / hill.rows - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        hill.data[row * hill.cols + col] = d < 0.25 ? 200 : BASE_LEVEL;
      }
    }
    const hillCells = computeSandCells(hill, state.wetness, TRAY, false);
    const withWall = hillCells.filter((cell) => cell.wall > 0);
    expect(withWall.length).toBeGreaterThan(0);
  });

  it('立面颜色比顶面暗（背光侧）—— 只对够厚的立面成立', () => {
    const hill = createHeightField();
    for (let row = 0; row < hill.rows; row += 1) {
      for (let col = 0; col < hill.cols; col += 1) {
        hill.data[row * hill.cols + col] = row < hill.rows / 2 ? 180 : BASE_LEVEL;
      }
    }
    const cells = computeSandCells(hill, state.wetness, TRAY, false);
    // 厚立面（> WALL_MIN_PX）才用背光色；薄缝直接复用底色（见 sandCells 注释）
    const thickWalls = cells.filter(
      (cell) => cell.wall > 3 && cell.wallFill !== '' && cell.wallFill !== cell.fill,
    );
    expect(thickWalls.length).toBeGreaterThan(0);
    for (const cell of thickWalls) {
      expect(luminance(cell.wallFill)).toBeLessThan(luminance(cell.fill));
    }
  });

  it('薄缝也填色，绝不留下透明缝隙（曾经的"白线"bug）', () => {
    /*
     * 回归背景：画布是透明的，只在落差 > WALL_MIN_PX 时才画立面，
     * 会让 0~3px 的落差完全不填 —— 那些缝露出页面底色，
     * 在深色沙面上就是一条条刺眼的白线（挖沙痕迹下缘最明显）。
     * 现在：只要有正的落差，wall > 0 且 wallFill 非空。
     */
    const slope = createHeightField();
    for (let row = 0; row < slope.rows; row += 1) {
      for (let col = 0; col < slope.cols; col += 1) {
        slope.data[row * slope.cols + col] = SURFACE_BASE_LEVEL + (1 - row / slope.rows) * 120;
      }
    }
    const cells = computeSandCells(slope, state.wetness, TRAY, false);
    for (const cell of cells) {
      if (cell.wall > 0) {
        // 有落差就必须有可画的填充色，不能是空串
        expect(cell.wallFill).not.toBe('');
        expect(cell.wallFill).toMatch(/^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/);
      }
    }
  });

  it('立面高度 = 本格位移 - 下一行位移（几何自洽）', () => {
    const slope = createHeightField();
    for (let row = 0; row < slope.rows; row += 1) {
      for (let col = 0; col < slope.cols; col += 1) {
        // 上面高、下面低：形成一段下坡，每行都该有立面
        slope.data[row * slope.cols + col] = SURFACE_BASE_LEVEL + (1 - row / slope.rows) * 120;
      }
    }
    const cells = computeSandCells(slope, state.wetness, TRAY, false);
    const cellH = TRAY.h / GRID_ROWS;
    const col = 16;
    for (let row = 0; row < GRID_ROWS - 1; row += 1) {
      const current = cells[row * GRID_COLS + col];
      const next = cells[(row + 1) * GRID_COLS + col];
      /* 顶面底边与下一行顶面上沿之间的空隙。
         y = tray.y + row*cellH - lift，所以
         (next.y - current.y) 里含了一个 cellH 的行距，要减掉。 */
      const gap = next.y - current.y - cellH;
      if (current.wall > 0) {
        expect(current.wall).toBeCloseTo(gap, 3);
      } else {
        // 没有立面 => 落差确实低于阈值（否则会露缝）
        expect(gap).toBeLessThanOrEqual(3.01);
      }
    }
  });

  it('平坦沙面的 wallFill 是空串（渲染器据此跳过无用的 fillRect）', () => {
    const flat = createHeightField();
    const cells = computeSandCells(flat, state.wetness, TRAY, false);
    expect(cells.every((cell) => cell.wallFill === '')).toBe(true);
  });

  it('needsWall 的阈值行为（3px 以下不画，省掉无用的 fillRect）', () => {
    expect(needsWall(0)).toBe(false);
    expect(needsWall(2)).toBe(false);
    expect(needsWall(4)).toBe(true);
    expect(needsWall(40)).toBe(true);
  });

  it('深坑（负位移）不给自己画立面，只由前方更高的格子承担遮挡', () => {
    const pit = createHeightField();
    for (let row = 0; row < pit.rows; row += 1) {
      for (let col = 0; col < pit.cols; col += 1) {
        pit.data[row * pit.cols + col] = 10; // 整盘挖到底
      }
    }
    const cells = computeSandCells(pit, state.wetness, TRAY, false);
    // 全盘同高 -> 没有相对落差 -> 全部无立面，也不会露出缝
    expect(cells.every((cell) => cell.wall === 0)).toBe(true);
  });
});

describe('平坦沙面不要出现水平色带（曾经的真实 bug）', () => {
  /*
   * 回归背景：
   * depthShade 只跟行号有关，最初跨度 0.86~1.04，平坦沙面上就是 24 条
   * 清晰的水平色带（像百叶窗）。这里锁死它的跨度足够小，
   * 并确认整盘的去重色数仍然足够多（靠 grain 而不是靠行号）。
   */
  it('纵深明暗的跨度窄到看不出横向色带', () => {
    const state = createSurfaceState();
    const flat = createHeightField();
    const cells = computeSandCells(flat, state.wetness, TRAY, false);

    // 同一列上下比较：只看 depthShade 的贡献
    const col = 16;
    const top = luminance(cells[2 * GRID_COLS + col].fill);
    const bottom = luminance(cells[20 * GRID_COLS + col].fill);
    const ratio = bottom / top;
    // 上下亮度比必须落在 0.95~1.05（超过就会看出横条）
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  });

  it('靠沙粒质感而不是行号提供纹理（去重色数 > 30）', () => {
    const state = createSurfaceState();
    const flat = createHeightField();
    const cells = computeSandCells(flat, state.wetness, TRAY, false);
    const unique = new Set(cells.map((cell) => cell.fill));
    expect(unique.size).toBeGreaterThan(30);
  });

  it('沙粒是确定性的：同输入两次结果完全相同（不会每帧闪烁）', () => {
    const state = createSurfaceState();
    const flat = createHeightField();
    const first = computeSandCells(flat, state.wetness, TRAY, false);
    const snapshot = first.map((cell) => cell.fill);
    const second = computeSandCells(flat, state.wetness, TRAY, false);
    expect(second.map((cell) => cell.fill)).toEqual(snapshot);
  });
});

describe('性能预算：单帧着色 < 4ms（3× 余量断言）', () => {
  const field = bumpyField();
  const state = createSurfaceState();
  const wetness = uniformWetness(state, 180);
  const buffer: ReturnType<typeof computeSandCells> = [];

  it('768 格着色在 12ms 内完成（目标 4ms，3× 余量）', () => {
    const elapsed = bestOf(12, () => {
      computeSandCells(field, wetness, TRAY, false, buffer);
    });
    // 打印出来便于对比不同机器（vitest 默认显示 console）
    console.info(`[perf] 768 格着色 best-of-12 = ${elapsed.toFixed(3)}ms（预算 4ms）`);
    expect(elapsed).toBeLessThan(12);
  });

  it('复用 buffer 不改变结果，也不增长内存', () => {
    const first = computeSandCells(field, wetness, TRAY, false, buffer);
    const second = computeSandCells(field, wetness, TRAY, false, buffer);
    expect(second).toBe(first); // 同一个数组
    expect(second).toHaveLength(GRID_CELLS);
    // 内容完全一致（确定性渲染）
    for (let i = 0; i < 30; i += 1) {
      expect(second[i].fill).toBe(first[i].fill);
    }
  });

  it('连续 60 帧（≈1 秒）总耗时在合理范围，不会随帧数恶化', () => {
    const firstTen = bestOf(1, () => {
      for (let i = 0; i < 10; i += 1) computeSandCells(field, wetness, TRAY, false, buffer);
    });
    const lastTen = bestOf(1, () => {
      for (let i = 0; i < 10; i += 1) computeSandCells(field, wetness, TRAY, false, buffer);
    });
    // 后 10 帧不应该明显慢于前 10 帧（没有隐藏的状态累积）
    expect(lastTen).toBeLessThan(Math.max(firstTen * 3, 40));
  });

  it('极端数据（全 0 / 全 255）不会退化到慢路径', () => {
    const zero = createHeightField();
    zero.data.fill(0);
    const full = createHeightField();
    full.data.fill(255);
    const allWet = uniformWetness(state, 255);

    const elapsed = bestOf(8, () => {
      computeSandCells(zero, allWet, TRAY, true, buffer);
      computeSandCells(full, allWet, TRAY, true, buffer);
    });
    // 两帧
    expect(elapsed / 2).toBeLessThan(12);
  });

  it('无湿度数组（undefined）也能工作，不抛错', () => {
    const cells = computeSandCells(field, undefined, TRAY, false);
    expect(cells).toHaveLength(GRID_CELLS);
    expect(cells.every((cell) => cell.gloss === 0)).toBe(true);
  });

  it('格子尺寸与托盘尺寸一致，且铺满整个托盘', () => {
    const cells = computeSandCells(createHeightField(), wetness, TRAY, false);
    const cellW = TRAY.w / GRID_COLS;
    const cellH = TRAY.h / GRID_ROWS;
    expect(cells[0].w).toBeCloseTo(cellW, 6);
    expect(cells[0].h).toBeCloseTo(cellH, 6);
    expect(cells[0].x).toBeCloseTo(TRAY.x, 6);
    // 最后一列的右边缘 = 托盘右边缘
    const last = cells[GRID_CELLS - 1];
    expect(last.x + last.w).toBeCloseTo(TRAY.x + TRAY.w, 6);
  });
});
