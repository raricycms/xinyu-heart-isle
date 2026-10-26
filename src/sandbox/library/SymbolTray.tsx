import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { SandboxSymbolEntry } from '@/lib/types';
import { cx } from '@/lib/utils';
import { useI18n } from '@/i18n';
import {
  SYMBOLS,
  categoryLabels,
  categoryOrder,
  getSymbolById,
  subcategoryLabels,
  type SymbolCategory,
} from '@/sandbox/symbols';
import { filterByCategory, groupBySubcategory, mergeEntries, searchEntries, starterEntries } from './search';
import { imageForSymbol } from './packs';
import { usePackImageMap, usePackSymbols, usePacks } from './usePacks';
import '@/styles/sandbox-library.css';

/**
 * 沙具选择面板。
 *
 * 交互模型：
 * - 点击/Enter = 放入沙盘（回调 `onPick`，位置由沙盘决定，本组件不持状态）
 * - 长按 500ms / 右键 = 预览大图 + 提示「可以放到指定位置」
 * - 搜索：输入即防抖 120ms 后过滤（`searchEntries`），不做远程查询
 * - 键盘：网格是 roving tabindex，方向键移动，Home/End 首尾，Enter 放入
 *
 * 组件是**受控的**：选中态由 `value` 传入，所有动作通过回调交给上层，
 * 自己只持有纯 UI 状态（查询词、当前大类、焦点索引、预览项）。
 *
 * 伦理边界：这里只提供素材与检索，不输出任何象征解读。
 */

export interface SymbolTrayProps {
  /** 放入沙盘（上层负责落位与事件流） */
  onPick: (symbolId: string) => void;
  /** 当前选中的沙具 id（可选，用于高亮与初始焦点） */
  value?: string | null;
  /** 只读（封盘后） */
  disabled?: boolean;
  className?: string;
  /** 是否把已安装沙具包的条目一起列出，默认 true */
  includePacks?: boolean;
  /** 长按/右键预览回调；不传则用组件内的小预览条 */
  onPreview?: (symbolId: string) => void;
}

const LONG_PRESS_MS = 500;
const SEARCH_DEBOUNCE_MS = 120;
const STARTER_LIMIT = 24;

type CategoryTab = SymbolCategory | 'all';

export function SymbolTray({
  onPick,
  value = null,
  disabled = false,
  className,
  includePacks = true,
  onPreview,
}: SymbolTrayProps) {
  const { t, symbolLabel } = useI18n();
  const packSymbols = usePackSymbols();
  const packImages = usePackImageMap();
  const packs = usePacks();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [tab, setTab] = useState<CategoryTab>('all');
  const [focusIndex, setFocusIndex] = useState(0);
  const [preview, setPreview] = useState<SandboxSymbolEntry | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const searchId = useId();

  /* 防抖：输入 120ms 后才过滤，避免每个按键都重建整棵分组树 */
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  /* 内置库 + 第三方包（同 id 时内置优先） */
  const allEntries = useMemo(
    () => (includePacks ? mergeEntries(SYMBOLS, packSymbols) : SYMBOLS),
    [includePacks, packSymbols],
  );

  const searching = debouncedQuery.trim().length > 0;

  /* 搜索结果（若已选某个大类，则只在该大类内检索，符合「先筛后搜」的直觉） */
  const searchResult = useMemo(
    () =>
      searching
        ? searchEntries(filterByCategory(allEntries, tab), debouncedQuery, 120)
        : [],
    [allEntries, debouncedQuery, searching, tab],
  );

  /* 非搜索态：按大类 / 子类分组（顺带记下每组在扁平列表里的起始下标） */
  const grouped = useMemo(() => {
    if (searching || tab === 'all') return [];
    const groups = groupBySubcategory(filterByCategory(allEntries, tab));
    let offset = 0;
    return groups.map((group) => {
      const start = offset;
      offset += group.items.length;
      return { ...group, start };
    });
  }, [allEntries, searching, tab]);

  const starter = useMemo(() => {
    if (searching || tab !== 'all') return [];
    return starterEntries(allEntries, STARTER_LIMIT);
  }, [allEntries, searching, tab]);

  /** 当前网格的扁平顺序（键盘导航用，与渲染顺序一致） */
  const flat = useMemo(() => {
    if (searching) return searchResult;
    if (tab === 'all') return starter;
    return grouped.flatMap((group) => group.items);
  }, [grouped, searchResult, searching, starter, tab]);

  /* 列表变化时把焦点索引夹住，避免越界后按方向键没反应 */
  useEffect(() => {
    setFocusIndex((prev) => (flat.length === 0 ? 0 : Math.min(prev, flat.length - 1)));
  }, [flat.length]);

  /* 选中项变化时把焦点对上去 */
  useEffect(() => {
    if (!value) return;
    const index = flat.findIndex((entry) => entry.id === value);
    if (index >= 0) setFocusIndex(index);
  }, [flat, value]);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  useEffect(() => clearLongPress, [clearLongPress]);

  const openPreview = useCallback(
    (entry: SandboxSymbolEntry) => {
      setPreview(entry);
      onPreview?.(entry.id);
    },
    [onPreview],
  );

  const handlePointerDown = useCallback(
    (entry: SandboxSymbolEntry) => {
      if (disabled) return;
      clearLongPress();
      longPressTimer.current = window.setTimeout(() => openPreview(entry), LONG_PRESS_MS);
    },
    [clearLongPress, disabled, openPreview],
  );

  const handlePick = useCallback(
    (entry: SandboxSymbolEntry) => {
      if (disabled) return;
      onPick(entry.id);
    },
    [disabled, onPick],
  );

  /** 读出网格当前列数（方向键上下移动时用），拿不到时退回 6 列 */
  const columnsOf = useCallback((): number => {
    const body = gridRef.current;
    if (!body) return 6;
    // 真正的 CSS Grid 是 .lib__grid，body 只是滚动容器
    const grid = body.querySelector<HTMLElement>('.lib__grid') ?? body;
    const template = window.getComputedStyle(grid).gridTemplateColumns;
    if (!template || template === 'none') return 6;
    const count = template.split(' ').filter(Boolean).length;
    return count > 0 ? count : 6;
  }, []);

  const focusItemAt = useCallback((index: number) => {
    const grid = gridRef.current;
    if (!grid) return;
    const buttons = grid.querySelectorAll<HTMLButtonElement>('[data-lib-item]');
    const target = buttons[index];
    if (target) {
      setFocusIndex(index);
      target.focus();
    }
  }, []);

  const handleGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (flat.length === 0) return;
      const columns = columnsOf();
      let next = focusIndex;
      switch (event.key) {
        case 'ArrowRight':
          next = Math.min(focusIndex + 1, flat.length - 1);
          break;
        case 'ArrowLeft':
          next = Math.max(focusIndex - 1, 0);
          break;
        case 'ArrowDown':
          next = Math.min(focusIndex + columns, flat.length - 1);
          break;
        case 'ArrowUp':
          next = Math.max(focusIndex - columns, 0);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = flat.length - 1;
          break;
        case 'Enter':
        case ' ': {
          const entry = flat[focusIndex];
          if (entry) {
            event.preventDefault();
            handlePick(entry);
          }
          return;
        }
        default:
          return;
      }
      event.preventDefault();
      focusItemAt(next);
    },
    [columnsOf, flat, focusIndex, focusItemAt, handlePick],
  );

  const renderItem = useCallback(
    (entry: SandboxSymbolEntry, index: number) => {
      const image = packImages[entry.id] ?? imageForSymbol(entry.id, packs);
      const label = symbolLabel(entry.label, entry.labelEn);
      const selected = value === entry.id;
      return (
        <button
          key={entry.id}
          type="button"
          data-lib-item
          data-testid="lib-item"
          data-selected={selected || undefined}
          className={cx('lib-item', selected && 'is-selected')}
          tabIndex={index === focusIndex ? 0 : -1}
          disabled={disabled}
          title={`${label}${entry.packId && entry.packId !== 'core' ? `（${entry.packId}）` : ''}`}
          aria-label={`放入沙具：${label}`}
          aria-pressed={selected}
          onFocus={() => setFocusIndex(index)}
          onClick={() => handlePick(entry)}
          onContextMenu={(event) => {
            event.preventDefault();
            openPreview(entry);
          }}
          onPointerDown={() => handlePointerDown(entry)}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          onPointerCancel={clearLongPress}
        >
          <span className="lib-item__glyph" aria-hidden>
            {image ? <img className="lib-item__img" src={image} alt="" /> : entry.glyph || '◌'}
          </span>
          <span className="lib-item__label">{label.slice(0, 4)}</span>
        </button>
      );
    },
    [
      clearLongPress,
      disabled,
      focusIndex,
      handlePick,
      handlePointerDown,
      openPreview,
      packImages,
      packs,
      symbolLabel,
      value,
    ],
  );

  const totalCount = allEntries.length;
  const previewLabel = preview ? symbolLabel(preview.label, preview.labelEn) : '';

  return (
    <section className={cx('lib', className)} aria-label={t('sandbox.library')}>
      {/* -------------------------------- 搜索 -------------------------------- */}
      <div className="lib__search">
        <label className="sr-only" htmlFor={searchId}>
          {t('sandbox.librarySearch')}
        </label>
        <input
          id={searchId}
          type="search"
          className="input lib__search-input"
          value={query}
          placeholder={t('sandbox.librarySearch')}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="lib__count small muted mono" aria-live="polite">
          {t('sandbox.libraryCount', { count: searching ? searchResult.length : totalCount })}
        </span>
      </div>

      {/* ------------------------------- 大类 tabs ------------------------------ */}
      <div className="lib__tabs" role="tablist" aria-label={t('sandbox.library')}>
        {(() => {
          const tabs: CategoryTab[] = ['all', ...categoryOrder];
          return tabs.map((key) => {
            const active = tab === key;
            const label = key === 'all' ? t('sandbox.libraryAll') : categoryLabels[key];
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                className={cx('lib__tab', active && 'is-active')}
                disabled={disabled}
                onClick={() => {
                  setTab(key);
                  setFocusIndex(0);
                }}
              >
                {label}
              </button>
            );
          });
        })()}
      </div>

      {/* -------------------------------- 网格 -------------------------------- */}
      <div
        className="lib__body"
        ref={gridRef}
        role="group"
        aria-label={tab === 'all' ? t('sandbox.libraryAll') : categoryLabels[tab]}
        onKeyDown={handleGridKeyDown}
      >
        {flat.length === 0 ? (
          <p className="lib__empty small muted">{t('sandbox.libraryEmpty')}</p>
        ) : searching ? (
          <div className="lib__grid">{searchResult.map((entry, index) => renderItem(entry, index))}</div>
        ) : tab === 'all' ? (
          <>
            <p className="lib__section-label small muted">常用</p>
            <div className="lib__grid">{starter.map((entry, index) => renderItem(entry, index))}</div>
          </>
        ) : (
          grouped.map((group) => (
            <div key={group.subcategory} className="lib__section">
              <p className="lib__section-label small muted">
                {group.label}
                <span className="lib__section-count mono"> · {group.items.length}</span>
              </p>
              <div className="lib__grid">
                {group.items.map((entry, index) => renderItem(entry, group.start + index))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* -------------------------------- 预览 -------------------------------- */}
      {preview ? (
        <div className="lib__preview" role="status" aria-live="polite">
          <span className="lib__preview-glyph" aria-hidden>
            {packImages[preview.id] ? (
              <img className="lib__preview-img" src={packImages[preview.id]} alt="" />
            ) : (
              preview.glyph || '◌'
            )}
          </span>
          <span className="lib__preview-body">
            <strong className="lib__preview-name">{previewLabel}</strong>
            <span className="lib__preview-hint small muted">
              长按/右键只是预览。想放到指定位置，可以先点「放入」，再在沙盘里拖。
            </span>
          </span>
          <span className="lib__preview-actions">
            <button
              type="button"
              className="btn btn--sm"
              disabled={disabled}
              onClick={() => {
                handlePick(preview);
                setPreview(null);
              }}
            >
              放入
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPreview(null)}>
              {t('common.close')}
            </button>
          </span>
        </div>
      ) : null}

      <p className="lib__foot small muted">
        内置 {SYMBOLS.length} 件 · 子类 {Object.keys(subcategoryLabels).length} 个
        {includePacks && packs.length > 0 ? ` · 第三方包 ${packs.length} 个` : ''}
      </p>
    </section>
  );
}

/** 供上层把沙具 id 转成展示用 glyph（找不到时给中性占位） */
export function glyphOf(symbolId: string): string {
  return getSymbolById(symbolId)?.glyph ?? '◌';
}
