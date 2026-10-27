/**
 * 视图变换的单元测试。
 *
 * 这组测试的重点不是「函数能跑」，而是**屏幕坐标与沙盘坐标的双向一致性**。
 * 视图变换最危险的失效形态是「看起来能用、仔细用就错」：
 * 笔刷画偏几格、拖拽落点挪位、点击选中的是旁边那个摆件。
 * 这类错误自动化测试很难从界面上抓到，只能从数学上钉死。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSFORM,
  MAX_SCALE,
  MIN_SCALE,
  applyPinch,
  applyWheelZoom,
  clampScale,
  compassLabels,
  isDefaultView,
  pointerPair,
  resetTransform,
  screenToSandbox,
  snapRotation,
  toCssTransform,
  type ViewTransform,
} from './transform';

/** 一个 400×300 的渲染区域，左上角在 (100, 50) */
const RECT = { left: 100, top: 50, width: 400, height: 300 };
const CENTER = { clientX: RECT.left + RECT.width / 2, clientY: RECT.top + RECT.height / 2 };

const view = (patch: Partial<ViewTransform> = {}): ViewTransform => ({
  ...DEFAULT_TRANSFORM,
  ...patch,
});

describe('缩放边界', () => {
  it('clampScale 夹在 [MIN_SCALE, MAX_SCALE]', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(999)).toBe(MAX_SCALE);
    expect(clampScale(2)).toBe(2);
  });

  it('clampScale 对 NaN / Infinity 退回 1，不把 NaN 漏进 CSS', () => {
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MAX_SCALE);
  });
});

describe('旋转吸附', () => {
  it('吸附到最近的 90° 倍数', () => {
    expect(snapRotation(0)).toBe(0);
    expect(snapRotation(44)).toBe(0);
    expect(snapRotation(46)).toBe(90);
    expect(snapRotation(91)).toBe(90);
    expect(snapRotation(179)).toBe(180);
  });

  it('负角度和超过 360° 都归一到 [0, 270]', () => {
    expect(snapRotation(-90)).toBe(270);
    expect(snapRotation(-1)).toBe(0);
    expect(snapRotation(450)).toBe(90);
  });

  it('NaN 退回 0（否则 rotate(NaNdeg) 整条 transform 失效）', () => {
    expect(snapRotation(Number.NaN)).toBe(0);
  });
});

describe('toCssTransform', () => {
  it('默认视图返回 none，不产生空 transform', () => {
    expect(toCssTransform(DEFAULT_TRANSFORM)).toBe('none');
  });

  it('平移用百分比（跟随容器尺寸，不写死像素）', () => {
    expect(toCssTransform(view({ tx: 0.25, ty: -0.5 }))).toBe(
      'translate(25.000%, -50.000%)',
    );
  });

  it('平移在旋转之前、旋转在缩放之前', () => {
    const css = toCssTransform(view({ tx: 0.1, rotate: 90, scale: 2 }));
    expect(css).toBe('translate(10.000%, 0.000%) rotate(90deg) scale(2.0000)');
    expect(css.indexOf('translate')).toBeLessThan(css.indexOf('rotate'));
    expect(css.indexOf('rotate')).toBeLessThan(css.indexOf('scale'));
  });
});

describe('screenToSandbox：屏幕坐标 → 沙盘坐标', () => {
  it('无变换时，区域中心对应 (0.5, 0.5)', () => {
    const p = screenToSandbox(CENTER.clientX, CENTER.clientY, RECT, DEFAULT_TRANSFORM);
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
  });

  it('无变换时，区域左上角对应 (0, 0)、右下角对应 (1, 1)', () => {
    const tl = screenToSandbox(RECT.left, RECT.top, RECT, DEFAULT_TRANSFORM);
    expect(tl.x).toBeCloseTo(0, 6);
    expect(tl.y).toBeCloseTo(0, 6);

    const br = screenToSandbox(
      RECT.left + RECT.width,
      RECT.top + RECT.height,
      RECT,
      DEFAULT_TRANSFORM,
    );
    expect(br.x).toBeCloseTo(1, 6);
    expect(br.y).toBeCloseTo(1, 6);
  });

  it('放大 2 倍后，屏幕中心仍是 (0.5, 0.5) —— 缩放原点是中心', () => {
    const p = screenToSandbox(CENTER.clientX, CENTER.clientY, RECT, view({ scale: 2 }));
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
  });

  it('放大 2 倍后，屏幕同一位置对应的沙盘坐标向中心收缩一半', () => {
    // 屏幕上偏右 1/4 处（归一化 0.75），放大 2 倍后应变到 0.625
    const clientX = RECT.left + RECT.width * 0.75;
    const p = screenToSandbox(clientX, CENTER.clientY, RECT, view({ scale: 2 }));
    expect(p.x).toBeCloseTo(0.625, 6);
  });

  it('旋转 90° 后，屏幕正右方的点落到沙盘正上方', () => {
    /*
     * 这是逆变换最容易写错的地方。视图顺时针转 90°，意味着托盘的「上边」
     * 出现在屏幕的「右边」；反过来，屏幕右边的点对应托盘的上边。
     *
     * ⚠️ 非正方形的坑：渲染区是 400×300，所以屏幕右移 100px 旋转后变成
     * 上移 100px，归一化到 y 轴时要除以**高度** 300 —— 得到 0.5 - 1/3 ≈ 0.167，
     * 而不是想当然的 0.25（0.25 只有在正方形区域才成立）。
     * 我第一版就是按正方形写的期望值，测试红了；红得对，代码没错。
     */
    const clientX = CENTER.clientX + RECT.width / 4; // 右移 100px
    const p = screenToSandbox(clientX, CENTER.clientY, RECT, view({ rotate: 90 }));
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.5 - 100 / RECT.height, 6); // 100px 上移，按高度归一
  });

  it('平移 0.25 后，屏幕中心对应托盘的 (0.25, 0.5)', () => {
    const p = screenToSandbox(
      CENTER.clientX,
      CENTER.clientY,
      RECT,
      view({ tx: 0.25 }),
    );
    expect(p.x).toBeCloseTo(0.25, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
  });

  it('缩放 + 旋转 + 平移叠加时，中心点仍严格可逆', () => {
    const v = view({ scale: 1.7, rotate: 180, tx: 0.1, ty: -0.2 });
    const p = screenToSandbox(CENTER.clientX, CENTER.clientY, RECT, v);
    // 中心点不受旋转和缩放影响，只受平移影响
    expect(p.x).toBeCloseTo(0.5 - 0.1, 6);
    expect(p.y).toBeCloseTo(0.5 + 0.2, 6);
  });
});

describe('pointerPair：双指手势几何', () => {
  it('中点、距离、角度都正确', () => {
    const pair = pointerPair({ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 100 });
    expect(pair.midX).toBe(50);
    expect(pair.midY).toBe(50);
    expect(pair.distance).toBeCloseTo(Math.hypot(100, 100), 6);
    expect(pair.angle).toBeCloseTo(45, 6);
  });

  it('两指重合时距离为 0，不应产生除零', () => {
    const pair = pointerPair({ clientX: 10, clientY: 10 }, { clientX: 10, clientY: 10 });
    expect(pair.distance).toBe(0);
  });
});

describe('applyPinch：双指增量', () => {
  const rect = { width: 400, height: 300 };
  const base = pointerPair({ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 });

  it('两指拉开 → 放大', () => {
    const wider = pointerPair({ clientX: 50, clientY: 100 }, { clientX: 250, clientY: 100 });
    const next = applyPinch(base, wider, DEFAULT_TRANSFORM, rect);
    expect(next.scale).toBeGreaterThan(1);
    expect(next.scale).toBeCloseTo(2, 6);
  });

  it('两指靠拢 → 缩小', () => {
    const narrower = pointerPair({ clientX: 125, clientY: 100 }, { clientX: 175, clientY: 100 });
    const next = applyPinch(base, narrower, DEFAULT_TRANSFORM, rect);
    expect(next.scale).toBeLessThan(1);
  });

  it('缩放不会越过上下限', () => {
    const huge = pointerPair({ clientX: -10000, clientY: 100 }, { clientX: 10000, clientY: 100 });
    expect(applyPinch(base, huge, DEFAULT_TRANSFORM, rect).scale).toBe(MAX_SCALE);

    const tiny = pointerPair({ clientX: 149, clientY: 100 }, { clientX: 151, clientY: 100 });
    expect(applyPinch(base, tiny, DEFAULT_TRANSFORM, rect).scale).toBe(MIN_SCALE);
  });

  it('角度变化小于 25° 时不旋转（避免缩放时手抖误触）', () => {
    const slight = pointerPair({ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 115 });
    const next = applyPinch(base, slight, DEFAULT_TRANSFORM, rect);
    expect(next.rotate).toBe(0);
  });

  it('角度变化大于 90° 时旋转吸附到 90° 的倍数', () => {
    const rotated = pointerPair({ clientX: 100, clientY: 100 }, { clientX: 100, clientY: 200 });
    const next = applyPinch(base, rotated, DEFAULT_TRANSFORM, rect);
    expect([0, 90, 180, 270]).toContain(next.rotate);
    // 从 0° 转到 90°，应当吸附到 90°
    expect(next.rotate).toBe(90);
  });

  it('平移跟随两指中点位移', () => {
    const shifted = pointerPair({ clientX: 200, clientY: 100 }, { clientX: 300, clientY: 100 });
    const next = applyPinch(base, shifted, DEFAULT_TRANSFORM, rect);
    expect(next.tx).toBeCloseTo(100 / 400, 6);
    expect(next.ty).toBeCloseTo(0, 6);
  });
});

describe('applyWheelZoom：桌面端滚轮', () => {
  it('上滚放大、下滚缩小', () => {
    expect(applyWheelZoom(DEFAULT_TRANSFORM, -100).scale).toBeGreaterThan(1);
    expect(applyWheelZoom(DEFAULT_TRANSFORM, 100).scale).toBeLessThan(1);
  });

  it('滚轮缩放同样受上下限约束', () => {
    expect(applyWheelZoom(view({ scale: MAX_SCALE }), -10000).scale).toBe(MAX_SCALE);
    expect(applyWheelZoom(view({ scale: MIN_SCALE }), 10000).scale).toBe(MIN_SCALE);
  });
});

describe('复位与默认态判定', () => {
  it('resetTransform 回到默认视图', () => {
    expect(resetTransform()).toEqual(DEFAULT_TRANSFORM);
  });

  it('isDefaultView 只在完全默认时为真', () => {
    expect(isDefaultView(DEFAULT_TRANSFORM)).toBe(true);
    expect(isDefaultView(view({ scale: 1.01 }))).toBe(false);
    expect(isDefaultView(view({ rotate: 90 }))).toBe(false);
    expect(isDefaultView(view({ tx: 0.01 }))).toBe(false);
  });
});

describe('方位罗盘', () => {
  it('不旋转时上北下南', () => {
    const labels = compassLabels(0);
    expect(labels.top).toBe('北');
    expect(labels.bottom).toBe('南');
    expect(labels.left).toBe('西');
    expect(labels.right).toBe('东');
  });

  it('顺时针转 90° 后，屏幕上方显示「东」—— 如实反映托盘方位', () => {
    const labels = compassLabels(90);
    expect(labels.top).toBe('东');
    expect(labels.right).toBe('南');
  });

  it('转 180° 后上下颠倒', () => {
    const labels = compassLabels(180);
    expect(labels.top).toBe('南');
    expect(labels.bottom).toBe('北');
  });
});
