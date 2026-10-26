/**
 * 心屿 · 轻量 i18n
 *
 * 设计取舍（VISION.md §5.7）：v2.0 只要求沙盘模块文案在表内，
 * 其他模块逐步迁移。因此这里不引入 i18n 库，只做：
 * - 扁平键表（`sandbox.tool.dig`）；
 * - 缺键时回退到 zh-CN，再回退到键名本身；
 * - 订阅式切换语言（写 Preferences.locale）。
 */

import { useCallback } from 'react';
import { usePreferences, setPreferences } from '@/lib/storage';
import { zhCN } from './zh-CN';
import { en } from './en';

export type Locale = 'zh-CN' | 'en';

export type Dict = Record<string, string>;

const DICTS: Record<Locale, Dict> = {
  'zh-CN': zhCN,
  en,
};

/** 取文案；缺失时回退 zh-CN，再回退键名 */
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const raw = DICTS[locale]?.[key] ?? DICTS['zh-CN'][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_match, name: string) =>
    vars[name] === undefined ? `{${name}}` : String(vars[name]),
  );
}

export interface I18nApi {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
  /** 沙具名：优先英文标签，缺失回退中文 */
  symbolLabel: (label: string, labelEn?: string) => string;
}

export function useI18n(): I18nApi {
  const { locale } = usePreferences();
  const active: Locale = locale === 'en' ? 'en' : 'zh-CN';

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(active, key, vars),
    [active],
  );

  const setLocale = useCallback((next: Locale) => {
    setPreferences({ locale: next });
  }, []);

  const symbolLabel = useCallback(
    (label: string, labelEn?: string) => (active === 'en' && labelEn ? labelEn : label),
    [active],
  );

  return { locale: active, t, setLocale, symbolLabel };
}

export { zhCN, en };
