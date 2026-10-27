/**
 * 不受祖先 transform 影响的元素测量与指针映射。
 *
 * ── 为什么需要这个 ──────────────────────────────────────────────
 *
 * 沙盘的视图变换（缩放/旋转）用 CSS `transform` 作用在渲染器的包裹层上。
 * 三种渲染器（dom2d / iso2d / three）原本都把 `el.getBoundingClientRect()`
 * 当作「绘制区有多大」来算命中测试和 canvas 尺寸。
 *
 * 问题：**`getBoundingClientRect()` 返回的是变换后的包围盒。**
 * 缩放和平移恰好无害（分子分母同比例变化，归一化抵消了），
 * 但旋转 90° 会让宽高互换 —— 实测 802×601 的绘制区变成 601×802。
 *
 * 后果全是「看起来能用、用起来错」：
 *   - 点击/拖拽落点整体偏到别处（拖 A 摆件，落点跑到 B）
 *   - 沙面笔画画在偏移位置
 *   - canvas 被重设成错误尺寸，画面被拉伸或裁掉
 * 这类错误 tsc、单测、截图对比都很难抓到。
 *
 * ── 我第一版写错了，值得记下来 ──────────────────────────────────
 *
 * 第一版把**矩形**做了逆变换，然后拿屏幕上的点击坐标去和这个（已还原的）
 * 矩形做归一化。这在无变换和纯旋转时看着对，但纯缩放时是错的：
 * 放大 1.95 倍后，屏幕 75% 处的点，正确沙盘坐标是 0.628，
 * 而那个算法给出 0.75 —— 等于「缩放完全没影响命中测试」。
 *
 * 中心点是变换的不动点，所以只要测中心附近的落点就永远是 0.5，
 * 什么都发现不了。是「放大后屏幕 75% 处」这个用才把错误暴露出来。
 *
 * **正确做法：矩形和点必须映射到同一个坐标系。**
 * 逆变换把两者都还原到「未变换坐标系」，再在那里做归一化。
 *
 * ── 解法 ────────────────────────────────────────────────────────
 *
 * 1. 矩形：把变换后包围盒的四角用逆矩阵映射回去取 AABB（还原布局矩形）；
 * 2. 点：同样用逆矩阵映射回去（`untransformPoint`）；
 * 3. 归一化在还原后的坐标系里做。
 *
 * 原点处理：CSS `transform-origin: center` 意味着宿主中心是不动点，
 * 因此逆映射以宿主中心为基准。这也是为什么必须用**宿主**的中心，
 * 而不是被测量元素自己的中心 —— 两者在缩放时不是同一个点。
 */

export interface MeasuredRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 2D 仿射矩阵（与 CSS `matrix(a, b, c, d, e, f)` 同序） */
export interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** 单位矩阵 */
export const IDENTITY: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * 求 2D 仿射矩阵的逆。
 *
 * 矩阵退化（行列式为 0，比如 scale(0)）时返回单位矩阵 ——
 * 宁可退回「未变换」，也不要让 NaN/Infinity 污染整个坐标链。
 */
export function invertMatrix(m: Matrix2D): Matrix2D {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return { ...IDENTITY };
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** 以 `center` 为不动点，用 `matrix` 变换一个点 */
export function transformPoint(
  point: { x: number; y: number },
  center: { x: number; y: number },
  matrix: Matrix2D,
): { x: number; y: number } {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + matrix.a * dx + matrix.c * dy + matrix.e,
    y: center.y + matrix.b * dx + matrix.d * dy + matrix.f,
  };
}

/**
 * 把「变换后的矩形」还原成「未变换的矩形」。
 *
 * 四角各自逆映射后取 AABB —— 对旋转 + 缩放 + 平移的任意组合都成立，
 * 因为矩形的角点正好是自己的逆像。
 */
export function untransformRect(
  transformed: MeasuredRect,
  center: { x: number; y: number },
  inverse: Matrix2D,
): MeasuredRect {
  const { left, top, width, height } = transformed;
  const corners = [
    { x: left, y: top },
    { x: left + width, y: top },
    { x: left + width, y: top + height },
    { x: left, y: top + height },
  ];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    const p = transformPoint(corner, center, inverse);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/** 视图变换包裹层的标记属性名 */
export const VIEW_HOST_ATTR = 'data-sandbox-view-host';

/**
 * 元素的几何信息：既能拿到未变换矩形，也能把屏幕点映射过去。
 *
 * 两者必须来自同一次测量 —— 分别测会在拖拽过程中因布局抖动而不一致。
 */
export interface SandboxGeometry {
  /** 未变换坐标系下的矩形（client 坐标） */
  readonly rect: MeasuredRect;
  /** 把屏幕坐标映射到**未变换坐标系**（仍是 client 坐标，只是回到布局空间） */
  pointer(clientX: number, clientY: number): { x: number; y: number };
  /** 归一化坐标，越界会被夹到 [0,1] */
  normalized(clientX: number, clientY: number): { x: number; y: number } | null;
}

/**
 * 找最近的视图变换宿主（只认一层，见下方说明）。
 *
 * 用鸭子类型而不是 `instanceof HTMLElement`：后者在非浏览器环境
 * （vitest 的 node 环境、SSR、构建期预渲染）里会抛
 * `ReferenceError: HTMLElement is not defined`。
 * 我们只需要它有 `getBoundingClientRect`，判断到这一步就够了。
 */
function findViewHost(el: Element): HTMLElement | null {
  const host = el.closest(`[${VIEW_HOST_ATTR}]`);
  if (!host) return null;
  const candidate = host as Partial<HTMLElement>;
  return typeof candidate.getBoundingClientRect === 'function' ? (host as HTMLElement) : null;
}

/**
 * 测量元素，并提供一个能把屏幕坐标映射回未变换坐标系的指针转换器。
 *
 * 没有祖先视图变换时，行为等价于直接 `getBoundingClientRect()`。
 *
 * 只识别**一层**视图变换宿主（我们的结构就是一层）。若将来出现嵌套变换，
 * 需要改成累乘祖先矩阵 —— 这里写死一层是刻意的：多一层就多一个
 * 必须同步维护的隐式约定，而现在没有这个需求。
 */
export function measureSandboxGeometry(el: Element): SandboxGeometry {
  const raw = el.getBoundingClientRect();
  const transformed: MeasuredRect = {
    left: raw.left,
    top: raw.top,
    width: raw.width,
    height: raw.height,
  };

  const host = findViewHost(el);
  const transform =
    host && typeof window !== 'undefined'
      ? window.getComputedStyle(host).transform
      : 'none';
  const matrix = transform && transform !== 'none' ? parseCssMatrix(transform) : null;

  /* 无变换：矩形即布局矩形，点原样返回 */
  if (!host || !matrix) {
    return {
      rect: transformed,
      pointer: (clientX, clientY) => ({ x: clientX, y: clientY }),
      normalized: (clientX, clientY) => {
        if (transformed.width === 0 || transformed.height === 0) return null;
        return {
          x: Math.min(1, Math.max(0, (clientX - transformed.left) / transformed.width)),
          y: Math.min(1, Math.max(0, (clientY - transformed.top) / transformed.height)),
        };
      },
    };
  }

  /*
   * 变换中心必须是**宿主**的中心，不是被测量元素的中心。
   * 缩放时两者不同：宿主的中心是不动点，元素自己的中心会跟着移动。
   * 用错中心会让逆映射整体偏移 —— 又是一个「中心点测不出来」的坑。
   */
  const hostRect = host.getBoundingClientRect();
  const center = {
    x: hostRect.left + hostRect.width / 2,
    y: hostRect.top + hostRect.height / 2,
  };
  const inverse = invertMatrix(matrix);

  const rect = untransformRect(transformed, center, inverse);
  const pointer = (clientX: number, clientY: number) =>
    transformPoint({ x: clientX, y: clientY }, center, inverse);

  return {
    rect,
    pointer,
    /*
     * 归一化：先把点逆变换回布局空间，再用**还原后的矩形**做除法。
     * 两者在同一坐标系，这一步是整套换算的关键 ——
     * 只还原矩形不还原点，纯缩放时结果会完全错误。
     */
    normalized: (clientX, clientY) => {
      if (rect.width === 0 || rect.height === 0) return null;
      const p = pointer(clientX, clientY);
      return {
        x: Math.min(1, Math.max(0, (p.x - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (p.y - rect.top) / rect.height)),
      };
    },
  };
}

/**
 * 只要未变换矩形时的便捷入口。
 *
 * 注意：**不要**用它的 `rect` 去和屏幕坐标做归一化 ——
 * 屏幕坐标还没逆变换。要算归一化请用 `measureSandboxGeometry(...).normalized`。
 */
export function measureSandboxElement(el: Element): MeasuredRect {
  return measureSandboxGeometry(el).rect;
}

/**
 * 解析 `getComputedStyle().transform` 的字符串。
 *
 * 浏览器一律把它归一成 `matrix(a, b, c, d, e, f)` 或 `matrix3d(...)`。
 * 解析不出来就返回 null，让调用方退回未变换值（宁可有偏差也不要 NaN）。
 */
export function parseCssMatrix(transform: string): Matrix2D | null {
  if (!transform || transform === 'none') return null;

  const matrix3d = /^matrix3d\(([^)]+)\)$/.exec(transform);
  if (matrix3d?.[1]) {
    const parts = matrix3d[1].split(',').map((s) => Number.parseFloat(s.trim()));
    if (parts.length === 16 && parts.every((n) => Number.isFinite(n))) {
      // 取 3D 矩阵里影响 x/y 的六个分量
      return {
        a: parts[0] as number,
        b: parts[1] as number,
        c: parts[4] as number,
        d: parts[5] as number,
        e: parts[12] as number,
        f: parts[13] as number,
      };
    }
    return null;
  }

  const matrix2d = /^matrix\(([^)]+)\)$/.exec(transform);
  if (matrix2d?.[1]) {
    const parts = matrix2d[1].split(',').map((s) => Number.parseFloat(s.trim()));
    if (parts.length === 6 && parts.every((n) => Number.isFinite(n))) {
      return {
        a: parts[0] as number,
        b: parts[1] as number,
        c: parts[2] as number,
        d: parts[3] as number,
        e: parts[4] as number,
        f: parts[5] as number,
      };
    }
  }

  return null;
}
