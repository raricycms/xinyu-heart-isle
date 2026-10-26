import type { ReactNode } from 'react';
import { cx } from '@/lib/utils';
import type { LevelTone } from '@/lib/types';

export function Tag({
  children,
  tone,
  outline,
  className,
}: {
  children: ReactNode;
  tone?: LevelTone | 'teal' | 'clay' | 'plain';
  outline?: boolean;
  className?: string;
}) {
  const toneClass =
    tone && tone !== 'plain'
      ? tone === 'teal' || tone === 'clay'
        ? `tag--${tone}`
        : `tag--${tone}`
      : undefined;
  return <span className={cx('tag', toneClass, outline && 'tag--outline', className)}>{children}</span>;
}

export function Progress({ value, max = 1 }: { value: number; max?: number }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__bar" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function Notice({
  children,
  tone = 'plain',
  title,
  icon,
}: {
  children: ReactNode;
  tone?: 'plain' | 'teal' | 'good' | 'watch' | 'warn' | 'alert';
  title?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={cx('notice', tone !== 'plain' && `notice--${tone}`)}>
      {icon ? <span aria-hidden>{icon}</span> : null}
      <div className="notice__body">
        {title ? <div className="notice__title">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

export function Empty({
  icon = '·',
  title,
  desc,
  action,
}: {
  icon?: ReactNode;
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden>
        {icon}
      </div>
      <div className="empty__title">{title}</div>
      {desc ? <p className="empty__desc">{desc}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <span className="stat__value mono">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export const TONE_LABEL: Record<LevelTone, string> = {
  good: '状态平稳',
  watch: '值得留意',
  warn: '需要关注',
  alert: '建议尽快求助',
};
