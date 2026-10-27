/**
 * 视图变换控件：缩放 / 旋转 / 复位。
 *
 * 触摸用户可以用双指手势，但**手势不能是唯一入口** —— 键盘用户、读屏用户、
 * 以及手掌稳定性受限的用户都需要可点的按钮。这些按钮同时充当
 * 「这个画面可以缩放」的可见提示：只有双指手势的话，大多数人永远不会
 * 发现它存在。
 */

import { useCallback } from 'react';
import { useI18n } from '@/i18n';
import { cx } from '@/lib/utils';
import {
  DEFAULT_TRANSFORM,
  compassLabels,
  snapRotation,
  type ViewTransform,
} from './transform';
import { VIEW_LIMITS, describeRotation, formatScale } from './useViewTransform';

export interface ViewControlsProps {
  view: ViewTransform;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotate: (delta: 90 | -90) => void;
  onReset: () => void;
  /** 是否禁用（封盘 / 3D 渲染器） */
  disabled?: boolean;
  className?: string;
}

export function ViewControls({
  view,
  onZoomIn,
  onZoomOut,
  onRotate,
  onReset,
  disabled = false,
  className,
}: ViewControlsProps) {
  const { t } = useI18n();

  const atMin = view.scale <= VIEW_LIMITS.MIN_SCALE + 1e-6;
  const atMax = view.scale >= VIEW_LIMITS.MAX_SCALE - 1e-6;
  const isDefault =
    view.scale === DEFAULT_TRANSFORM.scale &&
    view.rotate === DEFAULT_TRANSFORM.rotate &&
    view.tx === DEFAULT_TRANSFORM.tx &&
    view.ty === DEFAULT_TRANSFORM.ty;

  const stop = useCallback((event: React.PointerEvent | React.MouseEvent) => {
    // 控件在渲染层之上，点击不应穿透到画布（否则会取消选中摆件）
    event.stopPropagation();
  }, []);

  return (
    <div
      className={cx('view-controls', className)}
      data-testid="view-controls"
      onPointerDown={stop}
      onMouseDown={stop}
      role="group"
      aria-label={t('sandbox.viewControls')}
    >
      <button
        type="button"
        className="view-controls__btn"
        onClick={onZoomOut}
        disabled={disabled || atMin}
        aria-label={t('sandbox.zoomOut')}
        data-testid="view-zoom-out"
        title={t('sandbox.zoomOut')}
      >
        <span aria-hidden>−</span>
      </button>

      {/*
       * 缩放比例既是状态显示也是复位入口 —— 点一下回到 100%。
       * 比单独放一个「100%」文本 + 一个「复位」按钮省一个触摸目标。
       */}
      <button
        type="button"
        className={cx('view-controls__value', !isDefault && 'is-active')}
        onClick={onReset}
        disabled={disabled || isDefault}
        aria-label={t('sandbox.resetView')}
        data-testid="view-reset"
        title={t('sandbox.resetView')}
      >
        {formatScale(view.scale)}
        {view.rotate !== 0 ? (
          <span className="view-controls__rot" aria-hidden>
            {' '}
            · {snapRotation(view.rotate)}°
          </span>
        ) : null}
      </button>

      <button
        type="button"
        className="view-controls__btn"
        onClick={onZoomIn}
        disabled={disabled || atMax}
        aria-label={t('sandbox.zoomIn')}
        data-testid="view-zoom-in"
        title={t('sandbox.zoomIn')}
      >
        <span aria-hidden>+</span>
      </button>

      <span className="view-controls__divider" aria-hidden />

      <button
        type="button"
        className="view-controls__btn"
        onClick={() => onRotate(-90)}
        disabled={disabled}
        aria-label={t('sandbox.rotateLeft')}
        data-testid="view-rotate-left"
        title={t('sandbox.rotateLeft')}
      >
        <span aria-hidden>⟲</span>
      </button>
      <button
        type="button"
        className="view-controls__btn"
        onClick={() => onRotate(90)}
        disabled={disabled}
        aria-label={t('sandbox.rotateRight')}
        data-testid="view-rotate-right"
        title={t('sandbox.rotateRight')}
      >
        <span aria-hidden>⟳</span>
      </button>

      {/*
       * 读屏播报：视图变化不能只靠视觉传达。
       * 用 role="status" 而不是 aria-live 放在整个控件上，避免把每个
       * 按钮的 disabled 变化也一起播报出来。
       */}
      <span className="sr-only" role="status" aria-live="polite" data-testid="view-announce">
        {formatScale(view.scale)}
        {view.rotate !== 0 ? `，${describeRotation(view.rotate)}` : ''}
      </span>
    </div>
  );
}

/**
 * 方位罗盘。
 *
 * 只在视图旋转后出现。理由：旋转是纯视觉的（数据坐标不变），如果不告诉
 * 用户「现在上方是托盘哪一边」，他会以为摆在左上、而数据记在右上 ——
 * 九宫格方位在沙盘里是有临床意义的，这种错位比不能旋转坏得多。
 */
export function ViewCompass({ rotate }: { rotate: number }) {
  const labels = compassLabels(rotate);
  if (snapRotation(rotate) === 0) return null;

  return (
    <div className="view-compass" data-testid="view-compass" aria-hidden>
      <span className="view-compass__n">{labels.top}</span>
      <span className="view-compass__e">{labels.right}</span>
      <span className="view-compass__s">{labels.bottom}</span>
      <span className="view-compass__w">{labels.left}</span>
    </div>
  );
}

/**
 * 手势提示。
 *
 * 只在检测到触摸能力时显示，且一次性（不常驻）。
 * 「有这个功能」和「用户知道有这个功能」是两件事，后者更容易被忽略 ——
 * 双指缩放是移动端通用手势，但沙盘是画布，用户会默认「拖就是画」，
 * 未必想到可以缩放。
 */
export function GestureHint({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <div className="view-hint" role="note" data-testid="view-hint">
      <span>{t('sandbox.gestureHint')}</span>
      <button type="button" className="view-hint__close" onClick={onDismiss} aria-label={t('common.close')}>
        <span aria-hidden>×</span>
      </button>
    </div>
  );
}
