import { useEffect, useRef } from 'react';
import { useSurfaceCopy } from './SurfaceToolbar';

/**
 * 静默（专注）模式开关。
 *
 * 产品意图（VISION.md §6「不打扰」）：沙盘做到一半，用户常常需要
 * "眼里只有沙"。此时工具条、提示、右栏全部消失，只剩托盘本身；
 * 按 Esc 或再次点这个极小的按钮退出。
 *
 * 无障碍：
 * - 按钮本身始终可聚焦，`aria-pressed` 表达当前状态；
 * - 进入/退出通过 `aria-live="polite"` 播报，避免读屏用户"进了黑屋子"；
 * - 专注态下 Esc 是**唯一**退出方式，因此 Esc 处理必须绑在 window 上，
 *   且不能抢输入框里的 Esc（页面已有全局键盘处理，这里做了 target 判断）。
 */
export interface SilenceToggleProps {
  /** 是否处于静默模式（受控） */
  silent: boolean;
  onSilentChange: (silent: boolean) => void;
  /** 封盘 / 回放时不允许进入静默（否则没有出口） */
  disabled?: boolean;
  /**
   * 是否由本组件接管 Esc。
   * 页面若已有全局 Esc 处理，置 false 避免重复触发。
   */
  handleEscape?: boolean;
  className?: string;
}

export function SilenceToggle({
  silent,
  onSilentChange,
  disabled = false,
  handleEscape = true,
  className = '',
}: SilenceToggleProps) {
  const t = useSurfaceCopy();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // 退出静默后把焦点交还按钮：否则焦点留在已卸载的 DOM 上，键盘用户会"走丢"。
  const wasSilentRef = useRef(silent);
  useEffect(() => {
    if (wasSilentRef.current && !silent) buttonRef.current?.focus();
    wasSilentRef.current = silent;
  }, [silent]);

  useEffect(() => {
    if (!handleEscape || !silent) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      onSilentChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleEscape, onSilentChange, silent]);

  return (
    <div className={`ss-silence${className ? ` ${className}` : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className={`ss-silence__btn${silent ? ' is-active' : ''}`}
        aria-pressed={silent}
        disabled={disabled}
        title={t('sandbox.tool.focusHint')}
        data-testid="surface-silence-toggle"
        onClick={() => onSilentChange(!silent)}
      >
        <span className="ss-silence__glyph" aria-hidden="true">
          {silent ? '◉' : '◎'}
        </span>
        <span className="ss-silence__label">{t('sandbox.tool.focus')}</span>
      </button>
      {/* 状态播报：不占视觉位置，但读屏能听到 */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="surface-silence-status">
        {silent ? t('sandbox.tool.focusHint') : ''}
      </p>
    </div>
  );
}

export default SilenceToggle;
