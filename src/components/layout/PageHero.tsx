import type { ReactNode } from 'react';

/** 首页/关于页使用的宽幅标题区（模块自建，仅首页模块使用） */
export function PageHero({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="hero">
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <h1 className="hero__title">{title}</h1>
      {subtitle ? <p className="hero__subtitle">{subtitle}</p> : null}
      {children}
    </section>
  );
}
