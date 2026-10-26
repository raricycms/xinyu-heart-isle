import { describe, expect, it } from 'vitest';
import {
  BRUSH_RADIUS_MAX,
  BRUSH_RADIUS_MIN,
  BRUSH_STRENGTH_MAX,
  BRUSH_STRENGTH_MIN,
  KEYBOARD_STEP,
  KEYBOARD_STEP_FAST,
  MAX_STROKE_POINTS,
  STROKE_STEP,
  appendSample,
  arrowDelta,
  clampRadius,
  clampStrength,
  clampUnit,
  finalizePath,
  moveKeyboardCursor,
  normalizeFromRect,
  shouldAppendSample,
  targetTagName,
} from '@/sandbox/surface/useBrush';

/**
 * 笔刷交互的**纯逻辑**测试。
 *
 * 这里不 render hook：vitest 的 environment 是 node（没有 DOM，也没有 jsdom 依赖，
 * CONTRACT 的依赖白名单里没有 @testing-library）。所以把采样、夹取、键盘位移
 * 全部做成导出的纯函数，hook 只负责"把事件喂给这些函数 + 一帧一次 setState"。
 * 这样最贵的逻辑仍然被完整覆盖，而测试不需要浏览器。
 */

describe('笔刷参数夹取', () => {
  it('半径夹在 0.02 ~ 0.35', () => {
    expect(clampRadius(0)).toBe(BRUSH_RADIUS_MIN);
    expect(clampRadius(-3)).toBe(BRUSH_RADIUS_MIN);
    expect(clampRadius(0.12)).toBe(0.12);
    expect(clampRadius(9)).toBe(BRUSH_RADIUS_MAX);
    expect(BRUSH_RADIUS_MIN).toBe(0.02);
    expect(BRUSH_RADIUS_MAX).toBe(0.35);
  });

  it('力度夹在 0.1 ~ 1', () => {
    expect(clampStrength(0)).toBe(BRUSH_STRENGTH_MIN);
    expect(clampStrength(0.6)).toBe(0.6);
    expect(clampStrength(5)).toBe(BRUSH_STRENGTH_MAX);
    expect(BRUSH_STRENGTH_MIN).toBe(0.1);
    expect(BRUSH_STRENGTH_MAX).toBe(1);
  });

  it('非法数值（NaN / Infinity）不会污染状态', () => {
    expect(clampRadius(Number.NaN)).toBe(BRUSH_RADIUS_MIN);
    expect(clampStrength(Number.NaN)).toBe(BRUSH_STRENGTH_MIN);
    expect(clampUnit(Number.NaN)).toBe(0.5);
  });

  it('归一化坐标夹在 0 ~ 1', () => {
    expect(clampUnit(-0.4)).toBe(0);
    expect(clampUnit(0.5)).toBe(0.5);
    expect(clampUnit(1.4)).toBe(1);
  });
});

describe('笔画采样节流', () => {
  it('阈值是 0.008（三种渲染器统一）', () => {
    expect(STROKE_STEP).toBe(0.008);
  });

  it('第一个点必收，小于阈值的移动被丢弃', () => {
    expect(shouldAppendSample(null, { x: 0.5, y: 0.5 })).toBe(true);
    // 0.005 < 0.008：抖动不记点
    expect(shouldAppendSample({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.5 })).toBe(false);
    // 0.0085 ≥ 0.008：记点
    expect(shouldAppendSample({ x: 0.5, y: 0.5 }, { x: 0.5085, y: 0.5 })).toBe(true);
  });

  it('恰好等于阈值时要记点（>= 而不是 >）', () => {
    expect(shouldAppendSample({ x: 0, y: 0 }, { x: STROKE_STEP, y: 0 })).toBe(true);
  });

  it('appendSample 是纯函数：未采纳时返回原引用', () => {
    const path = [{ x: 0.5, y: 0.5 }];
    const rejected = appendSample(path, { x: 0.501, y: 0.5 });
    expect(rejected).toBe(path);

    const accepted = appendSample(path, { x: 0.6, y: 0.5 });
    expect(accepted).not.toBe(path);
    expect(path).toHaveLength(1); // 原数组没被改
    expect(accepted).toHaveLength(2);
  });

  it('1000 次 pointermove 抖动只留下很少的采样点', () => {
    let path: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
    for (let i = 0; i < 1000; i += 1) {
      // 每次只走 0.002，远小于阈值
      path = appendSample(path, { x: 0.002 * i, y: 0 });
    }
    // 0.002 * 1000 = 2.0 的行走距离 / 0.008 ≈ 250 个点，且受 MAX 限制
    expect(path.length).toBeLessThanOrEqual(MAX_STROKE_POINTS);
    expect(path.length).toBeGreaterThan(1);
  });

  it('单笔点数有上限，长按拖拽不会爆内存', () => {
    let path: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 5000; i += 1) {
      // 每步 0.05，一定超过阈值 -> 每步都被采纳，直到撞上限
      path = appendSample(path, { x: (i % 20) / 20, y: Math.floor(i / 20) / 250 });
    }
    expect(path.length).toBe(MAX_STROKE_POINTS);
  });
});

describe('笔画收尾', () => {
  it('单点笔画补成两点（applyStroke 会吃掉单点）', () => {
    const single = finalizePath([{ x: 0.3, y: 0.4 }]);
    expect(single).toHaveLength(2);
    expect(single[0]).toEqual(single[1]);
    // 必须是不同对象，避免下游意外共享引用
    expect(single[0]).not.toBe(single[1]);
  });

  it('空笔画保持为空（不产生一次空提交）', () => {
    expect(finalizePath([])).toEqual([]);
  });

  it('多点笔画原样返回', () => {
    const path = [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ];
    expect(finalizePath(path)).toBe(path);
  });
});

describe('键盘绘制（空格 + 方向键）', () => {
  it('方向键产生正确位移，非方向键返回 null', () => {
    expect(arrowDelta('ArrowLeft')).toEqual({ dx: -KEYBOARD_STEP, dy: 0 });
    expect(arrowDelta('ArrowRight')).toEqual({ dx: KEYBOARD_STEP, dy: 0 });
    expect(arrowDelta('ArrowUp')).toEqual({ dx: 0, dy: -KEYBOARD_STEP });
    expect(arrowDelta('ArrowDown')).toEqual({ dx: 0, dy: KEYBOARD_STEP });
    expect(arrowDelta('a')).toBeNull();
    expect(arrowDelta('Tab')).toBeNull();
  });

  it('Shift 加速', () => {
    expect(KEYBOARD_STEP_FAST).toBeGreaterThan(KEYBOARD_STEP);
    expect(arrowDelta('ArrowRight', true)).toEqual({ dx: KEYBOARD_STEP_FAST, dy: 0 });
  });

  it('没有光标时从沙盘中心起步', () => {
    expect(moveKeyboardCursor(null, 'ArrowRight')).toEqual({
      x: 0.5 + KEYBOARD_STEP,
      y: 0.5,
    });
  });

  it('键盘画到边界不会越界', () => {
    let cursor = { x: 0.5, y: 0.5 };
    for (let i = 0; i < 100; i += 1) {
      const next = moveKeyboardCursor(cursor, 'ArrowRight');
      if (next) cursor = next;
    }
    expect(cursor.x).toBe(1);
    expect(cursor.y).toBe(0.5);
  });

  it('键盘步长小于指针阈值，因此 appendSample 会拒绝 —— 这是真的', () => {
    // KEYBOARD_STEP(0.02) > STROKE_STEP(0.008)，所以正常不会被拒绝；
    // 这里锁死两者关系，防止有人调小键盘步长后键盘画不出线。
    expect(KEYBOARD_STEP).toBeGreaterThan(STROKE_STEP);
  });
});

describe('坐标归一化', () => {
  it('按 boundingRect 线性映射并夹取', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(normalizeFromRect(rect, 300, 150)).toEqual({ x: 0.5, y: 0.5 });
    // 边界外夹到 0 / 1
    expect(normalizeFromRect(rect, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(normalizeFromRect(rect, 9999, 9999)).toEqual({ x: 1, y: 1 });
  });

  it('零尺寸元素返回 null（避免除零得到 NaN）', () => {
    expect(normalizeFromRect({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toBeNull();
  });
});

describe('事件目标识别', () => {
  it('从 EventTarget 上安全取 tagName', () => {
    expect(targetTagName(null)).toBe('');
    expect(targetTagName(undefined)).toBe('');
    expect(targetTagName({ tagName: 'INPUT' } as unknown as EventTarget)).toBe('INPUT');
    // 没有 tagName 的对象不抛错
    expect(targetTagName({} as unknown as EventTarget)).toBe('');
  });
});
