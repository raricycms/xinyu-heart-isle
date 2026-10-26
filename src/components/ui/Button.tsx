import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
}

const variantClass: Record<Variant, string> = {
  primary: '',
  ghost: 'btn--ghost',
  quiet: 'btn--quiet',
  danger: 'btn--danger',
};

const sizeClass: Record<Size, string> = {
  sm: 'btn--sm',
  md: '',
  lg: 'btn--lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cx('btn', variantClass[variant], sizeClass[size], block && 'btn--block', className)}
      {...rest}
    />
  );
}

interface ButtonLinkProps {
  to: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  block?: boolean;
  className?: string;
}

export function ButtonLink({ to, children, variant = 'primary', size = 'md', block, className }: ButtonLinkProps) {
  return (
    <Link
      to={to}
      className={cx('btn', variantClass[variant], sizeClass[size], block && 'btn--block', className)}
    >
      {children}
    </Link>
  );
}
