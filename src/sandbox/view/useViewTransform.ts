/**
 * 视图变换的手势钩子。
 *
 * 把三套输入归一成同一个 `ViewTransform` 状态：
 *   - 触摸：双指缩放/旋转/平移
 *   - 鼠标：Ctrl/⌘ + 滚轮缩放，Shift + 拖动平移
 *   - 键盘：`+` / `-` 缩放，`0` 复位，`[` / `]` 旋转
 *
 * ── 为什么键盘也要有 ────────────────────────────────────────────
 *
 * VISION §5.7 只写了「双指缩放/旋转」，但如果只做触摸，键盘用户就永远
 * 看不到放大的沙盘 —— 而「能放大看清」对低视力用户比对谁都重要。
 * 同一个 `setView`，多接一个键盘入口几乎零成本。
 *
 * ── 为什么不用 pointer events 的 pointerType 分流 ──────────────
 *
 * 试过，但 `pointerdown` 的 pointerType 只在第一根手指上是 touch，
 * 第二根手指进来时拿不到「这是双指手势」的直观信号，得自己维护
 * 一个 pointerId 集合。用 `touchstart` / `touchmove` 反而更直白：
 * `event.touches.length` 就是现成的。代价是桌面端要单独走 wheel/mouse 分支，
 * 而这两条本来也要写。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_TRANSFORM,
  MAX_SCALE,
  MIN_SCALE,
  ROTATION_STEPS,
  applyPinch,
  applyWheelZoom,
  clampScale,
  isDefaultView,
  pointerPair,
  resetTransform,
  snapRotation,
  toCssTransform,
  type PointerPair,
  type ViewTransform,
} from './transform';

export interface UseViewTransformOptions {
  /** 是否禁用（封盘只读、3D 渲染器自带视角时） */
  disabled?: boolean;
  /** 缩放变化时的回调（用于播报） */
  onScaleChange?: (scale: number) => void;
  /** 旋转变化时的回调（用于播报） */
  onRotateChange?: (rotate: number) => void;
}

export interface UseViewTransformResult {
  view: ViewTransform;
  /** 直接套在渲染器包裹层上的 style */
  style: { transform: string; transformOrigin: string; willChange: string };
  /** 当前样式字符串（测试与调试用） */
  cssTransform: string;
  isDefault: boolean;
  reset: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  rotateBy: (delta: 90 | -90) => void;
  setScale: (scale: number) => void;
  /** 绑定到渲染区域外层容器 */
  handlers: {
    onTouchStart: (event: React.TouchEvent) => void;
    onTouchMove: (event: React.TouchEvent) => void;
    onTouchEnd: (event: React.TouchEvent) => void;
    onWheel: (event: React.WheelEvent) => void;
  };
  /** 手势进行中（用于暂时关掉笔刷/拖拽，避免双指操作同时画出笔画） */
  isGesturing: boolean;
}

/** 缩放按钮每次的倍率 */
const ZOOM_STEP = 1.25;

export function useViewTransform(
  containerRef: React.RefObject<HTMLElement | null>,
  options: UseViewTransformOptions = {},
): UseViewTransformResult {
  const { disabled = false, onScaleChange, onRotateChange } = options;
  const [view, setView] = useState<ViewTransform>(DEFAULT_TRANSFORM);
  const [isGesturing, setIsGesturing] = useState(false);

  /** 手势开始时的视图快照 —— 增量都基于它算，避免连续乘法漂移 */
  const gestureStartRef = useRef<ViewTransform>(DEFAULT_TRANSFORM);
  const lastPairRef = useRef<PointerPair | null>(null);

  const rectOf = useCallback(() => {
    const el = containerRef.current;
    if (!el) return { width: 0, height: 0 };
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, [containerRef]);

  const handleTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (disabled) return;
      if (event.touches.length === 2) {
        /*
         * 双指按下：进入手势模式。
         *
         * `preventDefault` 在这里是必须的 —— 否则浏览器会把它当成
         * 页面滚动/缩放，我们的 transform 和浏览器的视口缩放会叠加，
         * 表现为「画面乱跳」。容器的 `touch-action: none` 是第一道防线，
         * 这个 preventDefault 是给旧内核的兜底。
         */
        event.preventDefault();
        const [a, b] = [event.touches[0], event.touches[1]];
        if (!a || !b) return;
        gestureStartRef.current = view;
        lastPairRef.current = pointerPair(a, b);
        setIsGesturing(true);
      }
    },
    [disabled, view],
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (disabled) return;
      if (event.touches.length !== 2) return;
      const [a, b] = [event.touches[0], event.touches[1]];
      if (!a || !b) return;
      event.preventDefault();

      const next = pointerPair(a, b);
      const prev = lastPairRef.current;
      if (!prev) {
        lastPairRef.current = next;
        return;
      }

      const rect = rectOf();
      const updated = applyPinch(prev, next, gestureStartRef.current, rect);
      lastPairRef.current = next;
      setView(updated);
    },
    [disabled, rectOf],
  );

  const handleTouchEnd = useCallback((event: React.TouchEvent) => {
    if (event.touches.length < 2) {
      lastPairRef.current = null;
      setIsGesturing(false);
    }
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      if (disabled) return;
      /*
       * 只有按住 Ctrl/⌘ 才缩放。
       *
       * 理由：不按修饰键的滚轮是「滚动页面」，抢走它会让人无法滚到页面
       * 下方（沙盘页比一屏高）。Ctrl+滚轮是浏览器/设计工具的通用缩放手势，
       * 用户有肌肉记忆。
       */
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setView((prev) => applyWheelZoom(prev, event.deltaY));
    },
    [disabled],
  );

  const reset = useCallback(() => setView(resetTransform()), []);

  const zoomIn = useCallback(() => {
    setView((prev) => ({ ...prev, scale: clampScale(prev.scale * ZOOM_STEP) }));
  }, []);

  const zoomOut = useCallback(() => {
    setView((prev) => ({ ...prev, scale: clampScale(prev.scale / ZOOM_STEP) }));
  }, []);

  const rotateBy = useCallback((delta: 90 | -90) => {
    setView((prev) => ({ ...prev, rotate: snapRotation(prev.rotate + delta) }));
  }, []);

  const setScale = useCallback((scale: number) => {
    setView((prev) => ({ ...prev, scale: clampScale(scale) }));
  }, []);

  /* 变化时回调（播报用） */
  const lastScaleRef = useRef(view.scale);
  const lastRotateRef = useRef(view.rotate);
  useEffect(() => {
    if (lastScaleRef.current !== view.scale) {
      lastScaleRef.current = view.scale;
      onScaleChange?.(view.scale);
    }
  }, [view.scale, onScaleChange]);
  useEffect(() => {
    if (lastRotateRef.current !== view.rotate) {
      lastRotateRef.current = view.rotate;
      onRotateChange?.(view.rotate);
    }
  }, [view.rotate, onRotateChange]);

  /* 键盘 */
  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // 输入框里不抢键
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      // 有修饰键的交给浏览器/系统
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      switch (event.key) {
        case '+':
        case '=':
          event.preventDefault();
          zoomIn();
          break;
        case '-':
        case '_':
          event.preventDefault();
          zoomOut();
          break;
        case '0':
          event.preventDefault();
          reset();
          break;
        case '[':
          event.preventDefault();
          rotateBy(-90);
          break;
        case ']':
          event.preventDefault();
          rotateBy(90);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled, reset, rotateBy, zoomIn, zoomOut]);

  const cssTransform = useMemo(() => toCssTransform(view), [view]);
  const style = useMemo(
    () => ({
      transform: cssTransform,
      transformOrigin: 'center center',
      // 手势期间避免浏览器对大图的每一帧做额外的合成优化判断
      willChange: isGesturing ? 'transform' : 'auto',
    }),
    [cssTransform, isGesturing],
  );

  return {
    view,
    style,
    cssTransform,
    isDefault: isDefaultView(view),
    reset,
    zoomIn,
    zoomOut,
    rotateBy,
    setScale,
    handlers: { onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd, onWheel: handleWheel },
    isGesturing,
  };
}

/** 缩放百分比文字（给 UI 显示） */
export function formatScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** 旋转的说法（给读屏播报用） */
export function describeRotation(rotate: number): string {
  const snapped = snapRotation(rotate);
  if (snapped === 0) return '正放';
  if (snapped === 90) return '顺时针 90 度';
  if (snapped === 180) return '翻转 180 度';
  return '逆时针 90 度';
}

/** 边界值导出，供 UI 决定按钮禁用态 */
export const VIEW_LIMITS = { MIN_SCALE, MAX_SCALE, STEPS: ROTATION_STEPS };
