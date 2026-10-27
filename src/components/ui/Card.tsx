import type { ReactNode } from 'react';
import { cx } from '@/lib/utils';

export function Card({
  children,
  className,
  flat,
  sunken,
  padSm,
}: {
  children: ReactNode;
  className?: string;
  flat?: boolean;
  sunken?: boolean;
  padSm?: boolean;
}) {
  return (
    <div
      className={cx('card', flat && 'card--flat', sunken && 'card--sunken', padSm && 'card--pad-sm', className)}
    >
      {children}
    </div>
  );
}

export function SectionHead({
  title,
  action,
  desc,
}: {
  title: ReactNode;
  action?: ReactNode;
  desc?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        <h2 className="section-title" style={{ marginBottom: desc ? 4 : 0 }}>
          {title}
        </h2>
        {desc ? <p className="small muted">{desc}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="row-between">
        <div>
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <h1 className="page-title">{title}</h1>
          {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
        </div>
        {action}
      </div>
    </header>
  );
}
