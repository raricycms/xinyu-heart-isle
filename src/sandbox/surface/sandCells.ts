import { sampleHeight } from '@/sandbox/surfaceCodec';
import type { HeightField } from '@/sandbox/surfaceCodec';

/**
 * 沙面逐格着色（纯函数，不碰 DOM / React）。
 *
 * 单独成文件的原因有三个：
 * 1. **可测**：CONTRACT §7 要求 32×24 = 768 格的单帧着色 < 4ms。
 *    把着色算成纯数据，`brush.perf.test.ts` 才能在 node 环境里直接压测，
 *    不用起 jsdom 也不用真 canvas（jsdom 没有 2D 上下文）。
 * 2. **可复用**：dom2d 的缩略图、three 的高度网格都能用同一套
 *    "高度 + 湿度 -> 颜色"的规则，避免三个渲染器各调一个色。
 * 3. **渲染器只剩画**：iso2d 里不再藏着颜色数学，改视觉只需要改这里。
 *
 * 视觉规则（task-1 要求，逐条对应）：
 * - **湿润**：wetness/255 > 0.3 视为湿沙，颜色加深 **≥12%**（阈值以上再线性加深，
 *   最湿处约 -25%），并叠一层轻微高光（`gloss`），表示水膜反光。
 * - **起伏**：高度 0..255 映射到屏幕纵向位移 `LIFT_RATIO = 0.55`
 *   （原来 0.42，起伏太平看不出"沙"的质感）。
 * - **侧向明暗**：按坡度给每格调亮/调暗 —— 光从**左上**来，所以
 *   "朝左上倾斜的面"变亮、"朝右下倾斜的面"变暗，格与格之间才有立体的"棱"。
 * - **深挖**：height < 90（基准面，即 `SURFACE_BASE_LEVEL`）时向冷灰偏移，
 *   读起来像"挖到底下的湿沙"，与表面被推起的暖沙形成对比。
 *
 * ── 两个曾经踩过的坑（改色前务必读） ─────────────────────────────────────
 *
 * **坑 1：过曝成纯白。**
 * 最初把"高度明暗 × 坡度明暗 × 纵深明暗 × 湿度"四者直接相乘，
 * 三个系数都 >1 时暖沙 222 会被推到 222 × 1.30 × 1.18 × 1.04 = 354，
 * 被 `byte()` 裁到 255 —— 屏幕上出现一条条**纯白的硬边色带**，
 * 看起来像渲染坏了，实际上只是数值溢出。
 * 现在的做法：每个系数都有明确的上下界，乘积再统一 `clamp` 到
 * `SHADE_MAX = 1.10`（222 × 1.10 = 244，永远够不到 255）。
 *
 * **坑 2：悬空的色带（台阶感）。**
 * 每格按自己的高度向上位移后只画"顶面"，相邻格高度差大时会露出
 * 空隙，视觉上是一层层浮起来的硬边条纹，完全不像沙。
 * 现在给每格补一个**前立面**（`wall` / `wallFill`）：
 * 高度 = 本格顶面底边到"下一行地面"的落差，从顶面底边往下填满。
 * 因为绘制顺序是**从后往前**（行 0 -> 行 23），立面的下边缘恰好
 * 接上前一行顶面的上边缘，既不重叠也不留缝；而前方更高的沙丘
 * 会自然遮住后方的坑 —— 这就是正确的地形遮挡。
 */

/** 沙面网格：与 CONTRACT §7 的 768 格预算一致 */
export const GRID_COLS = 32;
export const GRID_ROWS = 24;
/** 网格格数（性能预算的分子） */
export const GRID_CELLS = GRID_COLS * GRID_ROWS;

/** 高度 -> 屏幕位移系数（相对托盘高度的一半） */
export const LIFT_RATIO = 0.55;
/** 基准面高度（= SURFACE_BASE_LEVEL），低于它的地方算"挖出来的坑" */
export const BASE_LEVEL = 90;
/** 湿沙阈值（归一化湿度） */
export const WET_THRESHOLD = 0.3;
/** 超过阈值后的最小加深比例（必须 ≥ 12%） */
export const WET_DARKEN_MIN = 0.12;
/** 坡度 -> 明暗强度 */
const SLOPE_SHADE_K = 0.012;
/** 侧向明暗的最大幅度（±18%，再多就脏了） */
const SLOPE_SHADE_MAX = 0.18;

/** 光照总强度的上限：守住"永远不裁到 255"这条线（见坑 1） */
const SHADE_MAX = 1.1;
const SHADE_MIN = 0.5;
/** 高度明暗范围：最深的坑 0.80，最高的沙脊 1.06 */
const HEIGHT_SHADE_MIN = 0.8;
const HEIGHT_SHADE_MAX = 1.06;
/**
 * 前立面是背光面，比顶面暗。
 * 0.72 会画出很硬的深色横条（"千层饼"），0.84 仍偏硬，0.93 才只是"沙坡的暗面"。
 */
const WALL_SHADE = 0.93;
/** 小于这个像素高度的落差就不画立面（省掉无用的字符串拼接） */
const WALL_MIN_PX = 3;
/**
 * 沙粒质感幅度（±）。0.03（±3%）会让平坦沙面看起来像马赛克/水磨石，
 * 0.006（±0.6%）才是"仔细看能看出是沙、退一步看是一整片"的粒度。
 */
const GRAIN_AMPLITUDE = 0.006;
/**
 * 高光门槛：specular 因子（0~1，1 = 微面正对反射方向）超过它才画高光。
 *
 * 0.62 是个刻意的"稀缺"阈值：平坦或缓坡上压根没有高光，只有沙丘的
 * 向光面/坑壁的拐角会闪一下。低于 0.4 时几乎每个湿格都会亮，
 * 整片湿沙就变成了砖墙（真实 bug，见 gloss 注释）。
 */
const SPECULAR_GATE = 0.62;
/**
 * 高度采样平滑次数。
 * 32×24 的格子直接从 128×96 的高度场采样时，笔刷边缘会被量化成
 * 一堆等高的"台阶"，渲染出来是一层层横条（千层饼）。
 * 在 **33×25 的角点样本**上做可分离 1-2-1 滤波（每轮成本 O(825)，
 * 远小于 768 格的着色本身），地形就连成坡了。
 *
 * 为什么是 3 轮：1 轮只能削掉最尖的边，2 轮仍有明显的等高台阶，
 * 3 轮之后相邻行的高差已经小于 1 个 cellH，看不出横条。
 * 继续加到 4 轮以上会开始把沙丘抹成圆顶，失去"被推起来"的体积感。
 */
const SMOOTH_PASSES = 3;

/* 立面计算用的临时缓冲（模块级复用，避免每帧 768×3 次分配） */
let SCRATCH_SHADE: Float32Array | null = null;
let SCRATCH_LIFT: Float32Array | null = null;
let SCRATCH_RGB: Float32Array | null = null;

/* 沙色：干沙暖、深处冷。dark = 夜间 / 深色场景 */
const DRY_LIGHT = [222, 202, 168] as const;
const DRY_DARK = [86, 80, 68] as const;
const COOL_LIGHT = [154, 163, 172] as const;
const COOL_DARK = [70, 77, 86] as const;

/**
 * 预先烘焙的高光底色。
 * 湿格可能有很多（整盘喷满水 = 768 格），每格拼一次 `rgba(...)` 字符串
 * 在低端机上就是可观的 GC 压力，所以按 8 档取现成字符串。
 *
 * 透明度上限刻意压到 0.13：0.24 时每一格的高光块都能被单独看出来，
 * 整片湿沙读起来像"砖墙"或"马赛克"。0.13 以下它只是让湿面**整体**
 * 泛一层水光，看不出单个格子的边界 —— 这才是"沙面上有水"的观感。
 */
const GLOSS_FILLS = [
  'rgba(255,255,255,0)',
  'rgba(255,255,255,0.035)',
  'rgba(255,255,255,0.05)',
  'rgba(255,255,255,0.065)',
  'rgba(255,255,255,0.08)',
  'rgba(255,255,255,0.095)',
  'rgba(255,255,255,0.11)',
  'rgba(255,255,255,0.13)',
] as const;

export interface Tray {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SandCell {
  /** 顶面的屏幕坐标（左上角） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 已算好的填充色，形如 `rgb(r,g,b)` */
  fill: string;
  /** 湿润高光的不透明度档位（0 = 不画） */
  gloss: number;
  /**
   * 前立面高度（像素）。0 表示这一格和前方地面齐平、不需要画立面。
   * 渲染器从顶面底边往下画这么高的一条暗色矩形，
   * 把"抬起的顶面"和"下一行地面"之间的空隙填满（见坑 2）。
   */
  wall: number;
  /** 立面的填充色（比顶面暗）；`wall === 0` 时是空字符串 */
  wallFill: string;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * 位置散列（整数 -> 整数）。用于沙粒质感。
 *
 * 必须是**纯函数**：同一格每帧都要得到同样的值，否则沙面会满屏闪烁。
 * 这里用经典的整数位混洗（xorshift 风格常数），比 `Math.sin(x*12.9898)`
 * 那种写法更快，也不会因为浮点精度在大坐标下退化。
 */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

function byte(value: number): number {
  const rounded = Math.round(value);
  return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded;
}

/** 高度 -> 屏幕纵向位移（像素，向屏幕上方为正） */
export function liftFor(height: number, trayH: number): number {
  return ((height - BASE_LEVEL) / 255) * LIFT_RATIO * trayH * 0.5;
}

/** 湿度字节 -> 0..1 */
export function wetnessToUnit(wet: number): number {
  return clamp(wet / 255, 0, 1);
}

/**
 * 湿沙加深系数（1 = 不变，0.75 = 深 25%）。
 * 阈值以上严格 ≥ WET_DARKEN_MIN，阈值以下线性过渡，保证视觉连续。
 */
export function wetDarken(wetUnit: number): number {
  if (wetUnit <= WET_THRESHOLD) return 1 - wetUnit * (WET_DARKEN_MIN / WET_THRESHOLD);
  return 1 - (WET_DARKEN_MIN + (wetUnit - WET_THRESHOLD) * 0.18);
}

/**
 * 综合明暗系数（导出供测试锁死"永不过曝"）。
 * 输入都是"1 = 不变"的乘数，输出被压进 [SHADE_MIN, SHADE_MAX]。
 */
export function totalShade(heightShade: number, sideShade: number, depthShade: number, darken: number): number {
  return clamp(heightShade * sideShade * depthShade * darken, SHADE_MIN, SHADE_MAX);
}

/** 高度明暗：越高的沙脊越亮，越深的坑越暗 */
export function heightShadeFor(height: number): number {
  const t = clamp((height - 20) / 220, 0, 1);
  return HEIGHT_SHADE_MIN + t * (HEIGHT_SHADE_MAX - HEIGHT_SHADE_MIN);
}

/** 立面是否够高到值得画 */
export function needsWall(wallPx: number): boolean {
  return wallPx > WALL_MIN_PX;
}

/**
 * 对 (cols+1)×(rows+1) 的角点高度做可分离盒滤波（1-2-1 权重）。
 *
 * 为什么需要：笔刷在 128×96 上留下的是**硬边**，直接按 32×24 采样时
 * 一整列格子会读到同一个高度值，渲染出来是一层层等高横条。
 * 在角点空间做平滑，等于把地形降采样成"坡"而不是"台阶"，
 * 成本只有 825×2 次加法，比 768 次 fillRect 便宜得多。
 *
 * 权重 1-2-1（≈高斯）在保持体积感的同时，不会像均值滤波那样把沙丘抹成圆顶。
 *
 * 实现用两个模块级缓冲做乒乓（可分离滤波的标准写法）：
 *   横向 A -> B，纵向 B -> A，所以 N 轮之后结果仍在 A 里，无需额外拷贝。
 * 边缘按"钳位"处理（越界取最近的内侧像素），避免沙面四周被压暗。
 */
const SMOOTH_A = { buf: null as Float32Array | null };
const SMOOTH_B = { buf: null as Float32Array | null };

function ensureSmoothBuffers(size: number): { a: Float32Array; b: Float32Array } {
  if (!SMOOTH_A.buf || SMOOTH_A.buf.length < size) {
    SMOOTH_A.buf = new Float32Array(size);
    SMOOTH_B.buf = new Float32Array(size);
  }
  return { a: SMOOTH_A.buf, b: SMOOTH_B.buf as Float32Array };
}

function smoothHeights(src: Float32Array, w: number, h: number, passes: number): Float32Array {
  if (passes <= 0) return src;
  const { a, b } = ensureSmoothBuffers(src.length);
  a.set(src);
  // 显式标注：TS 5.9 起 Float32Array 带 ArrayBufferLike 泛型参数，
  // 不写死会让 a / b 的推断类型与返回值不兼容（TS2322）。
  let from: Float32Array = a;
  let to: Float32Array = b;

  for (let pass = 0; pass < passes; pass += 1) {
    // 横向：from -> to
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      for (let x = 0; x < w; x += 1) {
        const left = from[row + (x === 0 ? 0 : x - 1)];
        const mid = from[row + x];
        const right = from[row + (x === w - 1 ? w - 1 : x + 1)];
        to[row + x] = (left + mid * 2 + right) * 0.25;
      }
    }
    // 纵向：to -> from（这样这一轮结束结果回到了 from）
    for (let y = 0; y < h; y += 1) {
      const up = (y === 0 ? 0 : y - 1) * w;
      const cur = y * w;
      const down = (y === h - 1 ? h - 1 : y + 1) * w;
      for (let x = 0; x < w; x += 1) {
        from[cur + x] = (to[up + x] + to[cur + x] * 2 + to[down + x]) * 0.25;
      }
    }
  }

  return from;
}

/**
 * 逐格算色。返回值可以直接交给 `ctx.fillRect`，调用方只负责画。
 *
 * **绘制顺序是有语义的**：必须按 row 从 0 到 rows-1（从后往前）画，
 * 每格先画立面再画顶面，前方的沙丘才能正确遮住后方的坑。
 *
 * @param field    高度场（128×96）
 * @param wetness  湿度（长度 = cols*rows，与高度场一一对应）
 * @param tray     托盘矩形（像素）
 * @param dark     深色场景
 * @param out      可选的复用数组，避免每帧重新分配 768 个对象
 */
export function computeSandCells(
  field: HeightField,
  wetness: Uint8Array | undefined,
  tray: Tray,
  dark: boolean,
  out?: SandCell[],
): SandCell[] {
  const cols = GRID_COLS;
  const rows = GRID_ROWS;
  const cellW = tray.w / cols;
  const cellH = tray.h / rows;

  /* 先把 (cols+1)×(rows+1) 个角点高度采样出来。
     逐格调 4 次 sampleHeight 是 3072 次双线性插值；先采角点只需 825 次，
     而且坡度可以直接读相邻角点，不必再插值。 */
  const hw = cols + 1;
  const hh = rows + 1;
  const rawHeights = new Float32Array(hw * hh);
  for (let j = 0; j <= rows; j += 1) {
    const v = j / rows;
    for (let i = 0; i <= cols; i += 1) {
      rawHeights[j * hw + i] = sampleHeight(field, i / cols, v);
    }
  }
  // 平滑（见 SMOOTH_PASSES 注释）：把笔刷边缘的"台阶"连成坡
  const heights = smoothHeights(rawHeights, hw, hh, SMOOTH_PASSES);

  const wetCols = field.cols;
  const wetRows = field.rows;
  const source = wetness && wetness.length >= wetCols * wetRows ? wetness : null;

  const cells = out ?? new Array<SandCell>(cols * rows);
  const base = dark ? DRY_DARK : DRY_LIGHT;
  const cool = dark ? COOL_DARK : COOL_LIGHT;

  /* 第一遍把"每格的位移与未调制底色"记下来，第二遍算立面时要用。
     用模块级复用的 Float32Array 而不是每帧 new，避免 768×3 次分配。 */
  const needed = cols * rows;
  if (!SCRATCH_SHADE || !SCRATCH_LIFT || !SCRATCH_RGB || SCRATCH_SHADE.length < needed) {
    SCRATCH_SHADE = new Float32Array(needed);
    SCRATCH_LIFT = new Float32Array(needed);
    SCRATCH_RGB = new Float32Array(needed * 3);
  }
  const shadeBuf: Float32Array = SCRATCH_SHADE;
  const liftBuf: Float32Array = SCRATCH_LIFT;
  const rgbBuf: Float32Array = SCRATCH_RGB;

  for (let row = 0; row < rows; row += 1) {
    const v = (row + 0.5) / rows;
    /**
     * 纵深微差：越靠下越暖一点，给平面一点空气感。
     *
     * 取值范围被压到 0.975~1.025。原因：这是一项**只跟行号有关**的明暗，
     * 跨度一大，平坦沙面上就会出现 24 条清晰的水平色带（像百叶窗），
     * 读起来像渲染 bug 而不是沙。真正的"沙感"交给下面的 grain。
     */
    const depthShade = 0.975 + v * 0.05;

    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const i0 = row * hw + col;

      // 四角平均值当作这一格的代表高度
      const h00 = heights[i0];
      const h10 = heights[i0 + 1];
      const h01 = heights[i0 + hw];
      const h11 = heights[i0 + hw + 1];
      const height = (h00 + h10 + h01 + h11) * 0.25;

      /* 坡度：光从左上来。
         gx / gy 是"往右下走变高多少"，变高 -> 这个面朝右下，背光 -> 变暗。 */
      const gx = h10 - h00;
      const gy = h01 - h00;
      const slope = (gx + gy) * 0.5;
      const sideShade = clamp(1 - slope * SLOPE_SHADE_K, 1 - SLOPE_SHADE_MAX, 1 + SLOPE_SHADE_MAX);

      const heightShade = heightShadeFor(height);

      // 深挖：低于基准面越多越冷
      const dug = clamp((BASE_LEVEL - height) / BASE_LEVEL, 0, 1) * 0.85;
      const invDug = 1 - dug;

      /* 湿度：**双线性**插值，不是最近邻。
         最近邻会让一块湿斑的边界变成阶梯状的方块（一格一格跳变），
         喷水的效果看起来像贴了一张马赛克贴纸；双线性之后边界是渐变的，
         才像"水渗进沙里"。这里和高度采样用的是同一套 u/v。 */
      let wetUnit = 0;
      if (source) {
        const fx = ((col + 0.5) / cols) * wetCols - 0.5;
        const fy = ((row + 0.5) / rows) * wetRows - 0.5;
        const x0 = Math.max(0, Math.min(wetCols - 1, Math.floor(fx)));
        const y0 = Math.max(0, Math.min(wetRows - 1, Math.floor(fy)));
        const x1 = Math.min(wetCols - 1, x0 + 1);
        const y1 = Math.min(wetRows - 1, y0 + 1);
        const tx = clamp(fx - x0, 0, 1);
        const ty = clamp(fy - y0, 0, 1);
        const w00 = source[y0 * wetCols + x0] ?? 0;
        const w10 = source[y0 * wetCols + x1] ?? 0;
        const w01 = source[y1 * wetCols + x0] ?? 0;
        const w11 = source[y1 * wetCols + x1] ?? 0;
        const topMix = w00 + (w10 - w00) * tx;
        const bottomMix = w01 + (w11 - w01) * tx;
        wetUnit = wetnessToUnit(topMix + (bottomMix - topMix) * ty);
      }
      const darken = wetDarken(wetUnit);

      const shade = totalShade(heightShade, sideShade, depthShade, darken);
      /* 沙粒质感：**确定性的**伪随机微扰（不是 Math.random，那样每帧会闪）。
         用 (col,row) 做一个整数散列，幅度见 GRAIN_AMPLITUDE。
         没有它的话，平坦沙面是一整块纯色，看起来像塑料板；
         有了它才有"沙"的颗粒感。因为是位置散列，同一格每帧颜色恒定。 */
      const grain = 1 + ((hash2(col, row) % 61) / 30 - 1) * GRAIN_AMPLITUDE;

      const r = (base[0] * invDug + cool[0] * dug) * shade * grain;
      const g = (base[1] * invDug + cool[1] * dug) * shade * grain;
      // 湿沙偏冷：蓝色通道随湿度略微上抬，看起来"水没干"
      const b = (base[2] * invDug + cool[2] * dug) * shade * grain * (1 + wetUnit * 0.05);

      /* 高光：分两层，别混在一起。
         1) **基础水光**（level 1）：只要是湿格就有一层极淡的整格提亮。
            作用不是"反光"而是"这面是湿的"——纯平坦的湿沙如果一点高光都没有，
            看起来和干沙只差个颜色，没有"水"的质感。
            整格铺满 + 只有 0.035 的透明度，所以相邻格连成一片，看不出格子。
         2) **镜面高光**（level 2~7）：由坡度门控。
            曾经的 bug 是所有湿格都盖一个亮色小矩形 → 整片湿沙变砖墙。
            真实的反光只在微面朝向反射方向时出现，所以先用 specular
            算"这个面有多正对反射"，超过阈值才给更亮的档位。 */
      let gloss = 0;
      if (wetUnit > WET_THRESHOLD) {
        const specular = clamp(
          (sideShade - (1 - SLOPE_SHADE_MAX)) / (2 * SLOPE_SHADE_MAX),
          0,
          1,
        );
        gloss =
          specular > SPECULAR_GATE
            ? Math.min(
                7,
                Math.max(
                  2,
                  1
                    + Math.round(
                      ((specular - SPECULAR_GATE) / (1 - SPECULAR_GATE))
                        * (1 + (wetUnit - WET_THRESHOLD) * 6),
                    ),
                ),
              )
            : 1;
      }

      const lift = liftFor(height, tray.h);

      let cell = cells[index];
      if (!cell) {
        cell = { x: 0, y: 0, w: 0, h: 0, fill: '', gloss: 0, wall: 0, wallFill: '' };
        cells[index] = cell;
      }
      cell.x = tray.x + col * cellW;
      cell.y = tray.y + row * cellH - lift;
      cell.w = cellW;
      cell.h = cellH;
      cell.fill = `rgb(${byte(r)},${byte(g)},${byte(b)})`;
      cell.gloss = gloss;
      cell.wall = 0;
      cell.wallFill = '';

      // 记下未调制的底色与位移，第二遍算立面时要用
      shadeBuf[index] = shade;
      liftBuf[index] = lift;
      rgbBuf[index * 3] = r;
      rgbBuf[index * 3 + 1] = g;
      rgbBuf[index * 3 + 2] = b;
    }
  }

  /* 第二遍：前立面（见坑 2）。
     一格能看到"自己的前脸"，当且仅当它比**下一行那一格**更高：
       wallHeight = lift(本格) - lift(下一行同列)
     两者都是"相对基准面的屏幕位移"，所以直接相减就是可见的落差像素。
     最后一行没有下一行，按基准面（lift = 0）算。

     ⚠️ 任何**正的**落差都必须画，哪怕只有 0.5px。
     曾经只在落差 > WALL_MIN_PX 时才画（为了省字符串拼接），
     结果 0~3px 的落差完全不填 —— 画布是透明的，那些缝隙就露出
     页面底色，在深色沙面上表现为一条条刺眼的**白线**（真实 bug，
     在挖沙痕迹的下缘特别明显）。
     现在：只要有落差就填，只是"薄缝"直接复用本格底色（不拼新字符串），
     厚缝才算背光色。既堵住了白线，也保住了性能。 */
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const liftCur = liftBuf[index];
      const liftNext = row + 1 < rows ? liftBuf[index + cols] : 0;
      const wallHeight = liftCur - liftNext;
      if (wallHeight <= 0) continue;

      const cell = cells[index];
      cell.wall = wallHeight;
      if (!needsWall(wallHeight)) {
        // 薄缝：复用本格底色，避免为看不清的 2px 拼一个字符串
        cell.wallFill = cell.fill;
        continue;
      }

      // 立面是背光侧：同一底色乘 WALL_SHADE，仍受 SHADE_MAX 保护
      const wallShade = clamp(shadeBuf[index] * WALL_SHADE, SHADE_MIN, SHADE_MAX);
      cell.wallFill = `rgb(${byte(rgbBuf[index * 3] * (wallShade / shadeBuf[index]))},${byte(
        rgbBuf[index * 3 + 1] * (wallShade / shadeBuf[index]),
      )},${byte(rgbBuf[index * 3 + 2] * (wallShade / shadeBuf[index]))})`;
    }
  }

  return cells;
}

/** 高光填充色（按 computeSandCells 给出的档位取） */
export function glossFill(level: number): string {
  const index = level < 0 ? 0 : level > 7 ? 7 : Math.round(level);
  return GLOSS_FILLS[index];
}

/** 高光块的相对几何（占格子的比例）：铺满整格，见下方说明 */
/**
 * 高光块的几何：**几乎铺满整格**。
 *
 * 曾经的 bug：0.36×0.26 的小矩形贴在大格里，即使透明度很低，
 * 也能一眼看出"每格一个小方块"，整片湿沙像砖墙。
 * 铺满格子之后，相邻格子的高光连成一片连续的水光，
 * 单独格子的边界就消失了 —— 这是用格子渲染时消掉"马赛克感"的关键。
 */
export const GLOSS_INSET_X = 0;
export const GLOSS_INSET_Y = 0;
export const GLOSS_W_RATIO = 1;
export const GLOSS_H_RATIO = 1;
