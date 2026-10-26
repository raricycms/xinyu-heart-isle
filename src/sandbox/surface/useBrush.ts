import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SurfaceTool } from '@/lib/types';
import type { BrushCursor } from '@/sandbox/render/types';

/**
 * 沙面笔刷交互（surface 层唯一入口）。
 *
 * 为什么单独抽一个 hook：
 * 1. **渲染器不该各自实现采样**。改造前 iso2d 里写死了 1% 距离阈值，
 *    dom2d / three 各有一套，同一次拖动在不同渲染器下笔迹长度都不一样。
 * 2. **指针移动绝不能每帧 setState**。移动端 pointermove 可达 120Hz，
 *    每次都 setState 会拖着 React 重渲染工具条；这里统一走 rAF，
 *    一帧最多提交一次视觉更新。
 * 3. **触摸要能画**。`touch-action: none` 由使用方加在宿主元素上（见
 *    `src/styles/sandbox-surface.css` 的 `.ss-drawable`），本 hook 只保证
 *    `pointerType === 'touch'` 不被忽略，并且不会因为 preventDefault
 *    把页面滚动一起杀掉（只在确实进入绘制时才 preventDefault）。
 *
 * 契约（与 docs/CONTRACT.md §3.4 §3.5 对齐）：
 * - 一笔只在 **pointerup / pointercancel** 时提交一次 `onStrokeCommit`，
 *   不污染 `useSandboxSession` 的事件流；
 * - 笔画采样阈值 **0.008** 归一化单位（约沙盘宽度的 0.8%）；
 * - 半径 ∈ [0.02, 0.35]，力度 ∈ [0.1, 1]；
 * - 键盘可达：按住空格 + 方向键可在沙盘中心附近画，松空格提交。
 *
 * 用法（页面侧，非受控）：
 * ```tsx
 * const brush = useBrush({ onStrokeCommit: (tool, points) => api.strokeSurface(tool, points, radii, str) });
 * <div onPointerDown={brush.onPointerDown} onPointerMove={brush.onPointerMove} onPointerUp={brush.onPointerUp}>
 * ```
 *
 * 用法（渲染器侧，受控：tool/radius 由 props 提供）：
 * ```tsx
 * const stroke = useBrush({ tool: brushProp?.tool ?? null, radius: brushProp?.radius ?? 0.12, ... });
 * ```
 */

/** 笔画采样阈值：归一化单位。0.008 ≈ 32 格网格上 0.26 格，肉眼连续。 */
export const STROKE_STEP = 0.008;

/** 笔刷半径上下限（归一化） */
export const BRUSH_RADIUS_MIN = 0.02;
export const BRUSH_RADIUS_MAX = 0.35;
/** 力度上下限 */
export const BRUSH_STRENGTH_MIN = 0.1;
export const BRUSH_STRENGTH_MAX = 1;

/** 键盘绘制：方向键每次移动的归一化距离 */
export const KEYBOARD_STEP = 0.02;
/** 键盘绘制：按住 Shift 的步长（快速移动） */
export const KEYBOARD_STEP_FAST = 0.06;

/** 单笔最大采样点，避免长按拖拽产生上千点（applyStroke 会再插值） */
export const MAX_STROKE_POINTS = 640;

export interface BrushPoint {
  x: number;
  y: number;
}

/** 与 React.PointerEvent 结构兼容的最小指针事件形状（便于在无 DOM 环境下测试） */
export interface PointerLike {
  clientX: number;
  clientY: number;
  pointerId?: number;
  pointerType?: string;
  preventDefault?: () => void;
  currentTarget?: {
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
  } | null;
}

export interface UseBrushOptions {
  /** 一笔结束时调用一次（坐标系：归一化 0~1，已 clamp） */
  onStrokeCommit: (tool: SurfaceTool, points: BrushPoint[]) => void;
  /**
   * 受控模式：传了就用外部值，不传 hook 自持。
   * 渲染器把 `brush` prop 解出来传进来即可。
   */
  tool?: SurfaceTool | null;
  radius?: number;
  strength?: number;
  /** 是否允许绘制（只读 / 封盘 / 选择模式下为 false） */
  enabled?: boolean;
  /** 屏幕坐标 -> 归一化坐标；默认按宿主元素的 boundingRect 线性映射 */
  toNormalized?: (clientX: number, clientY: number) => BrushPoint | null;
  /** 采样阈值，默认 STROKE_STEP */
  step?: number;
  /** 受控模式下的变更回调（可选，纯展示型渲染器不需要） */
  onToolChange?: (tool: SurfaceTool | null) => void;
  onRadiusChange?: (radius: number) => void;
  onStrengthChange?: (strength: number) => void;
}

export interface BrushApi {
  /** 渲染器要的单一光标（tool 为 null 时整盘不显示） */
  brush: BrushCursor | null;
  tool: SurfaceTool | null;
  radius: number;
  strength: number;
  /** 是否正在按压（渲染器据此加粗光圈） */
  isDrawing: boolean;
  setTool: (tool: SurfaceTool | null) => void;
  setRadius: (radius: number) => void;
  setStrength: (strength: number) => void;
  onPointerDown: (event: PointerLike) => void;
  onPointerMove: (event: PointerLike) => void;
  onPointerUp: (event: PointerLike) => void;
  /** pointercancel / 失焦时丢弃当前笔画，不提交 */
  cancel: () => void;
  onKeyDown: (event: KeyboardKeyLike) => void;
  onKeyUp: (event: KeyboardKeyLike) => void;
}

/** 与 React.KeyboardEvent 兼容的最小形状 */
export interface KeyboardKeyLike {
  key: string;
  code?: string;
  shiftKey?: boolean;
  preventDefault?: () => void;
  /** 焦点在输入框里时不接管（事件目标可能是任意 EventTarget，内部做窄化） */
  target?: EventTarget | null;
}

/** 从事件目标里取标签名（EventTarget 上没有 tagName） */
export function targetTagName(target: EventTarget | null | undefined): string {
  if (!target) return '';
  const element = target as { tagName?: unknown };
  return typeof element.tagName === 'string' ? element.tagName : '';
}

/* -------------------------------------------------------------------------- */
/*                                 纯函数工具                                  */
/* -------------------------------------------------------------------------- */

export function clampRadius(value: number): number {
  if (!Number.isFinite(value)) return BRUSH_RADIUS_MIN;
  return Math.min(BRUSH_RADIUS_MAX, Math.max(BRUSH_RADIUS_MIN, value));
}

export function clampStrength(value: number): number {
  if (!Number.isFinite(value)) return BRUSH_STRENGTH_MIN;
  return Math.min(BRUSH_STRENGTH_MAX, Math.max(BRUSH_STRENGTH_MIN, value));
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/** 是否值得采样：与上一个点的距离 ≥ step。空笔画直接收下第一个点。 */
export function shouldAppendSample(
  last: BrushPoint | null | undefined,
  next: BrushPoint,
  step: number = STROKE_STEP,
): boolean {
  if (!last) return true;
  return Math.hypot(next.x - last.x, next.y - last.y) >= step;
}

/**
 * 推进采样（纯函数，不改原数组）。
 * 返回原数组引用表示"没有采纳"，调用方可以直接比较引用。
 */
export function appendSample(
  path: BrushPoint[],
  point: BrushPoint,
  step: number = STROKE_STEP,
): BrushPoint[] {
  const next = { x: clampUnit(point.x), y: clampUnit(point.y) };
  const last = path.length > 0 ? path[path.length - 1] : null;
  if (!shouldAppendSample(last, next, step)) return path;
  if (path.length >= MAX_STROKE_POINTS) return path;
  return [...path, next];
}

/**
 * 收尾：保证至少两个点。
 * `applyStroke` 只处理 points[1..] 之间的插值，单点笔画会被整条丢掉，
 * 所以"点一下"必须补一个同位置的点。
 */
export function finalizePath(path: BrushPoint[]): BrushPoint[] {
  if (path.length === 0) return [];
  if (path.length === 1) return [path[0], { ...path[0] }];
  return path;
}

/** 方向键 -> 位移。不是方向键返回 null。 */
export function arrowDelta(
  key: string,
  fast = false,
): { dx: number; dy: number } | null {
  const step = fast ? KEYBOARD_STEP_FAST : KEYBOARD_STEP;
  switch (key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

/** 键盘绘制：在中心附近按方向键移动光标 */
export function moveKeyboardCursor(
  from: BrushPoint | null,
  key: string,
  fast = false,
): BrushPoint | null {
  const delta = arrowDelta(key, fast);
  if (!delta) return null;
  const base = from ?? { x: 0.5, y: 0.5 };
  return { x: clampUnit(base.x + delta.dx), y: clampUnit(base.y + delta.dy) };
}

/** 宿主元素 boundings -> 归一化（默认坐标系） */
export function normalizeFromRect(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): BrushPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: clampUnit((clientX - rect.left) / rect.width),
    y: clampUnit((clientY - rect.top) / rect.height),
  };
}

/* -------------------------------------------------------------------------- */
/*                                    hook                                    */
/* -------------------------------------------------------------------------- */

const raf: (callback: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (callback) => requestAnimationFrame(callback)
    : (callback) => setTimeout(callback, 16) as unknown as number;

const caf: (handle: number) => void =
  typeof cancelAnimationFrame === 'function' ? (handle) => cancelAnimationFrame(handle) : (handle) => clearTimeout(handle);

/**
 * 尽量把指针捕获到元素上，但**绝不因为它失败而中断绘制**。
 *
 * `setPointerCapture` 在三种真实场景下会抛 `NotFoundError`：
 * 1. 指针已经在上一帧抬起（用户点得很快，pointerdown/up 落在同一帧）；
 * 2. 合成事件（自动化测试、部分辅助技术、某些安卓 WebView 的手势转发）
 *    带着一个浏览器并不认识的 pointerId 过来；
 * 3. iOS Safari 在 pointerdown 的 handler 里同步调用时偶发失败。
 *
 * 这些情况都不该让用户"画不出来"，所以统一吞掉异常 ——
 * 捕获只是让 pointermove 在指针移出元素后仍然送到我们手上（体验优化），
 * 不是绘制的前置条件。
 */
function tryPointerCapture(element: unknown, pointerId: unknown, release: boolean): void {
  if (typeof pointerId !== 'number') return;
  const target = element as
    | { setPointerCapture?: (id: number) => void; releasePointerCapture?: (id: number) => void }
    | null
    | undefined;
  try {
    if (release) target?.releasePointerCapture?.(pointerId);
    else target?.setPointerCapture?.(pointerId);
  } catch {
    /* 见上方注释：捕获失败不影响绘制 */
  }
}

export function useBrush(options: UseBrushOptions): BrushApi {
  const {
    onStrokeCommit,
    tool: controlledTool,
    radius: controlledRadius,
    strength: controlledStrength,
    enabled = true,
    toNormalized,
    step = STROKE_STEP,
    onToolChange,
    onRadiusChange,
    onStrengthChange,
  } = options;

  const [ownTool, setOwnTool] = useState<SurfaceTool | null>(null);
  const [ownRadius, setOwnRadius] = useState(clampRadius(0.12));
  const [ownStrength, setOwnStrength] = useState(clampStrength(0.6));

  const tool = controlledTool !== undefined ? controlledTool : ownTool;
  const radius = clampRadius(controlledRadius !== undefined ? controlledRadius : ownRadius);
  const strength = clampStrength(controlledStrength !== undefined ? controlledStrength : ownStrength);

  /** 光标位置（已过 rAF 节流，每帧最多更新一次） */
  const [cursor, setCursor] = useState<BrushPoint | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const pathRef = useRef<BrushPoint[]>([]);
  const pointerIdRef = useRef<number | null>(null);
  const cursorRef = useRef<BrushPoint | null>(null);
  const pendingRef = useRef<BrushPoint | null>(null);
  const frameRef = useRef<number | null>(null);
  const spaceRef = useRef(false);
  const commitRef = useRef(onStrokeCommit);
  commitRef.current = onStrokeCommit;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  /** 最新工具（提交时读 ref，避免闭包拿到过期值） */
  const toolRef = useRef<SurfaceTool | null>(tool);
  toolRef.current = tool;
  const isDrawingRef = useRef(false);
  isDrawingRef.current = isDrawing;

  useEffect(
    () => () => {
      if (frameRef.current !== null) caf(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  /** 一帧一次的光标提交 */
  const scheduleCursor = useCallback((point: BrushPoint) => {
    cursorRef.current = point;
    pendingRef.current = point;
    if (frameRef.current !== null) return;
    frameRef.current = raf(() => {
      frameRef.current = null;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next) setCursor(next);
    });
  }, []);

  /** 立即提交（键盘绘制要即时反馈，不必等帧） */
  const commitCursorNow = useCallback((point: BrushPoint) => {
    cursorRef.current = point;
    pendingRef.current = null;
    if (frameRef.current !== null) {
      caf(frameRef.current);
      frameRef.current = null;
    }
    setCursor(point);
  }, []);

  const resolvePoint = useCallback(
    (event: PointerLike): BrushPoint | null => {
      if (toNormalized) return toNormalized(event.clientX, event.clientY);
      const target = event.currentTarget as unknown as
        | { getBoundingClientRect?: () => DOMRect }
        | null
        | undefined;
      const rect = target?.getBoundingClientRect?.();
      if (!rect) return null;
      return normalizeFromRect(rect, event.clientX, event.clientY);
    },
    [toNormalized],
  );

  const setTool = useCallback(
    (next: SurfaceTool | null) => {
      if (controlledTool === undefined) setOwnTool(next);
      onToolChange?.(next);
    },
    [controlledTool, onToolChange],
  );

  const setRadius = useCallback(
    (next: number) => {
      const value = clampRadius(next);
      if (controlledRadius === undefined) setOwnRadius(value);
      onRadiusChange?.(value);
    },
    [controlledRadius, onRadiusChange],
  );

  const setStrength = useCallback(
    (next: number) => {
      const value = clampStrength(next);
      if (controlledStrength === undefined) setOwnStrength(value);
      onStrengthChange?.(value);
    },
    [controlledStrength, onStrengthChange],
  );

  const commitStroke = useCallback(() => {
    const points = finalizePath(pathRef.current);
    pathRef.current = [];
    pointerIdRef.current = null;
    setIsDrawing(false);
    if (points.length === 0) return;
    const currentTool = toolRef.current;
    if (!currentTool) return;
    commitRef.current(currentTool, points);
  }, []);

  const onPointerDown = useCallback(
    (event: PointerLike) => {
      if (!enabledRef.current || !toolRef.current) return;
      const point = resolvePoint(event);
      if (!point) return;
      event.preventDefault?.();
      // 先记录笔画状态，再去尝试指针捕获：捕获失败不能影响绘制（见 tryPointerCapture）
      pathRef.current = [point];
      pointerIdRef.current = event.pointerId ?? 0;
      setIsDrawing(true);
      commitCursorNow(point);
      tryPointerCapture(event.currentTarget, event.pointerId, false);
    },
    [commitCursorNow, resolvePoint],
  );

  const onPointerMove = useCallback(
    (event: PointerLike) => {
      if (!enabledRef.current) return;
      const point = resolvePoint(event);
      if (!point) return;
      scheduleCursor(point);

      if (!isDrawingRef.current || !toolRef.current) return;
      const next = appendSample(pathRef.current, point, step);
      if (next !== pathRef.current) pathRef.current = next;
    },
    [resolvePoint, scheduleCursor, step],
  );

  const onPointerUp = useCallback(
    (event: PointerLike) => {
      // 同理：释放捕获失败不能影响"松手即提交"
      tryPointerCapture(event.currentTarget, event.pointerId, true);
      if (!enabledRef.current) {
        pathRef.current = [];
        pointerIdRef.current = null;
        setIsDrawing(false);
        return;
      }
      // 松手点也补一次采样，保证笔画末端不丢
      const point = resolvePoint(event);
      if (point && isDrawingRef.current) {
        const next = appendSample(pathRef.current, point, step);
        if (next !== pathRef.current) pathRef.current = next;
        commitCursorNow(point);
      }
      commitStroke();
    },
    [commitCursorNow, commitStroke, resolvePoint, step],
  );

  const cancel = useCallback(() => {
    pathRef.current = [];
    pointerIdRef.current = null;
    setIsDrawing(false);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardKeyLike) => {
      if (!enabledRef.current || !toolRef.current) return;
      const tag = targetTagName(event.target);
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;

      const isSpace = event.code === 'Space' || event.key === ' ';
      if (isSpace) {
        spaceRef.current = true;
        event.preventDefault?.();
        return;
      }
      if (!spaceRef.current) return;
      const moved = moveKeyboardCursor(cursorRef.current, event.key, event.shiftKey ?? false);
      if (!moved) return;
      event.preventDefault?.();
      commitCursorNow(moved);
      if (!isDrawingRef.current) {
        pathRef.current = [moved];
        setIsDrawing(true);
      } else {
        const next = appendSample(pathRef.current, moved, step);
        if (next !== pathRef.current) pathRef.current = next;
        else {
          // 步长小于阈值时也要连上，否则键盘画不出东西
          pathRef.current = appendSample(pathRef.current, moved, KEYBOARD_STEP / 4);
        }
      }
    },
    [commitCursorNow, step],
  );

  const onKeyUp = useCallback(
    (event: KeyboardKeyLike) => {
      const isSpace = event.code === 'Space' || event.key === ' ';
      if (!isSpace) return;
      if (!spaceRef.current) return;
      spaceRef.current = false;
      if (!isDrawingRef.current) return;
      event.preventDefault?.();
      commitStroke();
    },
    [commitStroke],
  );

  const brush = useMemo<BrushCursor | null>(() => {
    if (!tool) return null;
    return {
      x: cursor?.x ?? 0.5,
      y: cursor?.y ?? 0.5,
      radius,
      tool,
      active: isDrawing,
    };
  }, [tool, cursor, radius, isDrawing]);

  return {
    brush,
    tool,
    radius,
    strength,
    isDrawing,
    setTool,
    setRadius,
    setStrength,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancel,
    onKeyDown,
    onKeyUp,
  };
}
