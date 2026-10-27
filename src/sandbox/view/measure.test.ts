/**
 * `measureSandboxGeometry` 的行为测试。
 *
 * ── 为什么这组测试要自己搭假 DOM ────────────────────────────────
 *
 * 第一版测试里我复刻了一遍逆算法来算期望值 —— 结果测的是
 * **我复刻的那段数学**，不是产品代码。变异验证立刻暴露了这一点：
 * 我把 `measureSandboxGeometry` 里的 `.normalized()` 改成忘记逆变换点，
 * 54 个测试**全绿**。这就是一条恒真断言，一个幽灵门禁。
 *
 * 所以现在改成：注入最小的假 `Element` / `window.getComputedStyle`，
 * 直接调用产品函数，断言它返回的 `normalized()` 结果。
 * 这样数学和接线都在覆盖范围内。
 *
 * ── 假 DOM 的契约 ──────────────────────────────────────────────
 *
 * `measureSandboxGeometry` 只用到三样东西：
 *   1. `el.getBoundingClientRect()`          —— 返回变换后的包围盒
 *   2. `el.closest('[data-sandbox-view-host]')` —— 找变换宿主
 *   3. `window.getComputedStyle(host).transform` —— 读矩阵
 * 把这三样伪造出来，就足够覆盖除「真实浏览器布局」以外的全部逻辑。
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  IDENTITY,
  VIEW_HOST_ATTR,
  invertMatrix,
  measureSandboxGeometry,
  parseCssMatrix,
  transformPoint,
  untransformRect,
  type Matrix2D,
} from './measure';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 复刻浏览器：把布局矩形按矩阵（以 center 为不动点）正变换成屏幕包围盒 */
function forwardRect(rect: Rect, center: { x: number; y: number }, m: Matrix2D): Rect {
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.left + rect.width, y: rect.top },
    { x: rect.left + rect.width, y: rect.top + rect.height },
    { x: rect.left, y: rect.top + rect.height },
  ].map((p) => transformPoint(p, center, m));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/**
 * 安装一套假 DOM。
 *
 * @param layout 元素的**布局**矩形（未变换）
 * @param hostRect 变换宿主的**布局**矩形
 * @param matrix 变换矩阵；null 表示无变换
 */
function installFakeDom(layout: Rect, hostRect: Rect, matrix: Matrix2D | null) {
  const hostCenter = {
    x: hostRect.left + hostRect.width / 2,
    y: hostRect.top + hostRect.height / 2,
  };
  const hostScreenRect = matrix ? forwardRect(hostRect, hostCenter, matrix) : hostRect;
  const elScreenRect = matrix ? forwardRect(layout, hostCenter, matrix) : layout;

  const host = {
    getBoundingClientRect: () => hostScreenRect,
    __isHost: true,
  };

  const el = {
    getBoundingClientRect: () => elScreenRect,
    closest: (selector: string) => (selector.includes(VIEW_HOST_ATTR) ? host : null),
  };

  const g = globalThis as unknown as {
    window?: { getComputedStyle: (node: unknown) => { transform: string } };
  };
  const previous = g.window;
  g.window = {
    getComputedStyle: () => ({ transform: matrix ? toMatrixString(matrix) : 'none' }),
  };

  return {
    element: el as unknown as Element,
    restore: () => {
      g.window = previous;
    },
  };
}

function toMatrixString(m: Matrix2D): string {
  return `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`;
}

const LAYOUT: Rect = { left: 100, top: 50, width: 400, height: 300 };
const CENTER = { x: LAYOUT.left + LAYOUT.width / 2, y: LAYOUT.top + LAYOUT.height / 2 };

/* 每个用例结束都还原 window，避免污染别的测试文件 */
let restoreCurrent: (() => void) | null = null;
afterEach(() => {
  restoreCurrent?.();
  restoreCurrent = null;
});

describe('parseCssMatrix', () => {
  it('解析 matrix()', () => {
    expect(parseCssMatrix('matrix(1, 0, 0, 1, 10, 20)')).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
  });

  it('none / 空串返回 null', () => {
    expect(parseCssMatrix('none')).toBeNull();
    expect(parseCssMatrix('')).toBeNull();
  });

  it('解析 rotate(90deg)', () => {
    expect(parseCssMatrix('matrix(0, 1, -1, 0, 0, 0)')).toEqual({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 });
  });

  it('解析 matrix3d()，取 x/y 分量', () => {
    expect(parseCssMatrix('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 0, 1)')).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 5,
      f: 6,
    });
  });

  it('NaN 成分返回 null，不把 NaN 漏下去', () => {
    expect(parseCssMatrix('matrix(NaN, 0, 0, 1, 0, 0)')).toBeNull();
  });

  it('不认识的形式返回 null', () => {
    expect(parseCssMatrix('rotate(90deg)')).toBeNull();
    expect(parseCssMatrix('matrix(1, 2, 3)')).toBeNull();
  });
});

describe('invertMatrix', () => {
  it('单位矩阵的逆还是单位矩阵', () => {
    // 数值比较：求逆会算出 -0，而 toEqual 用 Object.is 把 -0 和 0 判为不等
    const inv = invertMatrix(IDENTITY);
    expect(inv.a).toBeCloseTo(1, 12);
    expect(inv.b).toBeCloseTo(0, 12);
    expect(inv.c).toBeCloseTo(0, 12);
    expect(inv.d).toBeCloseTo(1, 12);
    expect(inv.e).toBeCloseTo(0, 12);
    expect(inv.f).toBeCloseTo(0, 12);
  });

  it('scale(2) 的逆是 scale(0.5)', () => {
    const inv = invertMatrix({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    expect(inv.a).toBe(0.5);
    expect(inv.d).toBe(0.5);
  });

  it('rotate(90deg) 的逆是 rotate(-90deg)', () => {
    const inv = invertMatrix({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 });
    expect(inv.a).toBeCloseTo(0, 12);
    expect(inv.b).toBeCloseTo(-1, 12);
    expect(inv.c).toBeCloseTo(1, 12);
  });

  it('平移的逆是反向平移', () => {
    const inv = invertMatrix({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
    expect(inv.e).toBe(-10);
    expect(inv.f).toBe(-20);
  });

  it('奇异矩阵退回单位矩阵，不产生 Infinity', () => {
    const inv = invertMatrix({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 });
    expect(inv.a).toBe(1);
    expect(Number.isFinite(inv.e)).toBe(true);
  });
});

describe('transformPoint：以 center 为不动点', () => {
  it('不动点映射到自身', () => {
    const p = transformPoint(CENTER, CENTER, { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 });
    expect(p.x).toBeCloseTo(CENTER.x, 9);
    expect(p.y).toBeCloseTo(CENTER.y, 9);
  });

  it('rotate(90deg) 把中心正右方的点转到正下方', () => {
    const p = transformPoint({ x: CENTER.x + 100, y: CENTER.y }, CENTER, {
      a: 0,
      b: 1,
      c: -1,
      d: 0,
      e: 0,
      f: 0,
    });
    expect(p.x).toBeCloseTo(CENTER.x, 9);
    expect(p.y).toBeCloseTo(CENTER.y + 100, 9);
  });
});

describe('untransformRect：还原布局矩形', () => {
  it('无变换时原样返回', () => {
    const out = untransformRect(LAYOUT, CENTER, IDENTITY);
    expect(out.left).toBeCloseTo(LAYOUT.left, 6);
    expect(out.top).toBeCloseTo(LAYOUT.top, 6);
    expect(out.width).toBeCloseTo(LAYOUT.width, 6);
    expect(out.height).toBeCloseTo(LAYOUT.height, 6);
  });

  it('旋转 90° 后宽高互换，逆映射能还原（实测现象）', () => {
    const m = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
    const rotated = forwardRect(LAYOUT, CENTER, m);
    expect(rotated.width).toBeCloseTo(LAYOUT.height, 6);
    expect(rotated.height).toBeCloseTo(LAYOUT.width, 6);
    const out = untransformRect(rotated, CENTER, invertMatrix(m));
    expect(out.width).toBeCloseTo(LAYOUT.width, 6);
    expect(out.height).toBeCloseTo(LAYOUT.height, 6);
  });
});

describe('measureSandboxGeometry：产品函数的真实行为', () => {
  it('无变换宿主时等价于裸 rect', () => {
    const { element, restore } = installFakeDom(LAYOUT, LAYOUT, null);
    restoreCurrent = restore;

    const g = measureSandboxGeometry(element);
    expect(g.rect.width).toBeCloseTo(LAYOUT.width, 6);
    const p = g.normalized(LAYOUT.left + LAYOUT.width * 0.75, LAYOUT.top + LAYOUT.height * 0.5);
    expect(p?.x).toBeCloseTo(0.75, 6);
    expect(p?.y).toBeCloseTo(0.5, 6);
  });

  it('【核心】放大 2 倍后，屏幕 75% 处 → 0.625（不是 0.75）', () => {
    /*
     * 这是变异验证抓出来的关键用例。
     * `.normalized()` 如果只还原矩形、忘了把点也逆变换，
     * 这里会读到 0.75 —— 但那正是「缩放对命中测试完全无效」的错误行为。
     * 中心点是不动点，只测中心永远发现不了。
     */
    const m: Matrix2D = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const { element, restore } = installFakeDom(LAYOUT, LAYOUT, m);
    restoreCurrent = restore;

    const g = measureSandboxGeometry(element);
    // 还原后的矩形必须还是布局尺寸
    expect(g.rect.width).toBeCloseTo(LAYOUT.width, 6);
    expect(g.rect.height).toBeCloseTo(LAYOUT.height, 6);

    const p = g.normalized(CENTER.x + LAYOUT.width * 0.25, CENTER.y);
    expect(p?.x).toBeCloseTo(0.625, 6);
    expect(p?.y).toBeCloseTo(0.5, 6);
  });

  it('【核心】放大 1.95 倍（真实踩到的数值）', () => {
    const s = 1.95;
    const m: Matrix2D = { a: s, b: 0, c: 0, d: s, e: 0, f: 0 };
    const { element, restore } = installFakeDom(LAYOUT, LAYOUT, m);
    restoreCurrent = restore;

    const g = measureSandboxGeometry(element);
    const p = g.normalized(CENTER.x + LAYOUT.width * 0.25, CENTER.y);
    expect(p?.x).toBeCloseTo(0.5 + 0.25 / s, 6);
    expect(p?.x).toBeLessThan(0.7);
  });

  it('旋转 90° 后屏幕正右方对应托盘正上方', () => {
    /*
     * 渲染区是 400×300 非正方形：屏幕右移 100px，旋转后是上移 100px，
     * 归一化 y 要除以**高度** 300。
     */
    const m: Matrix2D = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
    const { element, restore } = installFakeDom(LAYOUT, LAYOUT, m);
    restoreCurrent = restore;

    const g = measureSandboxGeometry(element);
    // 旋转后 rect 宽高互换，还原后必须是原尺寸
    expect(g.rect.width).toBeCloseTo(LAYOUT.width, 6);

    const p = g.normalized(CENTER.x + 100, CENTER.y);
    expect(p?.x).toBeCloseTo(0.5, 6);
    expect(p?.y).toBeCloseTo(0.5 - 100 / LAYOUT.height, 6);
  });

  it('中心点在任何变换下都是 (0.5, 0.5)', () => {
    for (const m of [
      { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 },
      { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 },
      { a: -1, b: 0, c: 0, d: -1, e: 0, f: 0 },
      { a: 1.7, b: 1.7, c: -1.7, d: 1.7, e: 0, f: 0 },
    ]) {
      const { element, restore } = installFakeDom(LAYOUT, LAYOUT, m);
      const g = measureSandboxGeometry(element);
      const p = g.normalized(CENTER.x, CENTER.y);
      expect(p?.x).toBeCloseTo(0.5, 6);
      expect(p?.y).toBeCloseTo(0.5, 6);
      restore();
    }
  });

  it('越界坐标被夹到 [0,1]', () => {
    const { element, restore } = installFakeDom(LAYOUT, LAYOUT, null);
    restoreCurrent = restore;

    const g = measureSandboxGeometry(element);
    const far = g.normalized(LAYOUT.left - 500, LAYOUT.top - 500);
    expect(far?.x).toBe(0);
    expect(far?.y).toBe(0);
    const far2 = g.normalized(LAYOUT.left + 5000, LAYOUT.top + 5000);
    expect(far2?.x).toBe(1);
    expect(far2?.y).toBe(1);
  });

  it('退化矩形（宽或高为 0）返回 null，不产生 NaN', () => {
    const zero: Rect = { left: 10, top: 10, width: 0, height: 0 };
    const { element, restore } = installFakeDom(zero, zero, null);
    restoreCurrent = restore;
    expect(measureSandboxGeometry(element).normalized(10, 10)).toBeNull();
  });

  it('变换中心用**宿主**中心，不是元素自己中心', () => {
    /*
     * 元素比宿主小且偏心时，用错中心会让逆映射整体偏移。
     * 这里让元素是宿主的左半部分、宿主整体放大 2 倍。
     *
     * 关键：`normalized()` 收的是**屏幕坐标**，不是布局坐标。
     * 放大 2 倍后元素左边缘在屏幕上的位置变了，要用正变换算出来再传进去
     * （我第一版直接把布局坐标传进去，得到 0.5 而误判成产品 bug）。
     */
    const host: Rect = { left: 100, top: 50, width: 400, height: 300 };
    const elLayout: Rect = { left: 100, top: 50, width: 200, height: 300 };
    const m: Matrix2D = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const { element, restore } = installFakeDom(elLayout, host, m);
    restoreCurrent = restore;

    const g = measureSandboxGeometry(element);
    // 还原后应精确等于元素自己的布局矩形（不是宿主的）
    expect(g.rect.left).toBeCloseTo(elLayout.left, 6);
    expect(g.rect.top).toBeCloseTo(elLayout.top, 6);
    expect(g.rect.width).toBeCloseTo(elLayout.width, 6);
    expect(g.rect.height).toBeCloseTo(elLayout.height, 6);

    // 元素左边缘的**屏幕**坐标：以宿主中心为不动点正变换
    const hostCenter = { x: host.left + host.width / 2, y: host.top + host.height / 2 };
    const leftEdgeScreen = transformPoint(
      { x: elLayout.left, y: elLayout.top + elLayout.height / 2 },
      hostCenter,
      m,
    );
    const p = g.normalized(leftEdgeScreen.x, leftEdgeScreen.y);
    expect(p?.x).toBeCloseTo(0, 6);

    // 元素右边缘（布局 x=300）在屏幕上归一化应为 1
    const rightEdgeScreen = transformPoint(
      { x: elLayout.left + elLayout.width, y: elLayout.top + elLayout.height / 2 },
      hostCenter,
      m,
    );
    const q = g.normalized(rightEdgeScreen.x, rightEdgeScreen.y);
    expect(q?.x).toBeCloseTo(1, 6);
  });
});
