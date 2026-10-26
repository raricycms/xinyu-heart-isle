import { useCallback, useEffect, useRef, useState } from 'react';
import type { SurfaceTool } from '@/lib/types';
import { useI18n } from '@/i18n';
import { BRUSH_RADIUS_MAX, BRUSH_RADIUS_MIN, BRUSH_STRENGTH_MAX, BRUSH_STRENGTH_MIN } from './useBrush';
// 样式随组件走：调用方只要 import 组件就自动带上样式，
// 不会出现"忘了在页面里 import css 导致工具栏裸奔"的经典事故。
import '@/styles/sandbox-surface.css';

/**
 * 沙面工具条（7 种笔刷 + 半径 / 力度 + 重新铺沙）。
 *
 * 设计要点：
 * 1. **不持有业务状态**：tool / radius / strength 全部受控，页面（或
 *    `useBrush`）是唯一真相。这里只有"重新铺沙要不要二次确认"这种纯 UI 状态。
 * 2. **触摸优先**：每个工具按钮 ≥ 48×48（CONTRACT §7 只要求 44×44，
 *    48 是 iOS HIG 的拇指安全区），滑杆轨道加高到 44px 命中区。
 * 3. **键盘完备**：工具按钮是原生 `<button>`，`aria-pressed` 表达选中；
 *    Tab 顺序 = 视觉顺序；滑杆是原生 `<input type="range">`，
 *    方向键天然可用（不需要额外实现）。
 * 4. **「重新铺沙」是破坏性操作**：两段式确认，且第二段有 4 秒超时回退，
 *    避免误触把整盘沙抹掉。真正落库由页面调用 `api.resetSurface()`。
 * 5. **文案**：优先走 i18n 表（`sandbox.tool.*` 已存在）。本模块新引入的
 *    少量键（如 `sandbox.surface.resetConfirm`）在表里还没有，
 *    用 `useSurfaceCopy` 的本地兜底：**一旦表里补上，兜底自动失效**。
 *
 * 用法：
 * ```tsx
 * <SurfaceToolbar
 *   tool={tool} onToolChange={setTool}
 *   radius={radius} onRadiusChange={setRadius}
 *   strength={strength} onStrengthChange={setStrength}
 *   onReset={() => { api.resetSurface(); setTool(null); }}
 *   disabled={api.locked}
 * />
 * ```
 */

/** 工具元数据：id / emoji / i18n 键。导出给页面复用（避免两套工具表）。 */
export interface SurfaceToolDescriptor {
  id: SurfaceTool;
  glyph: string;
  labelKey: string;
  /** 读屏补充说明（可选） */
  hintKey?: string;
}

export const SURFACE_TOOL_LIST: SurfaceToolDescriptor[] = [
  { id: 'raise', glyph: '⛰', labelKey: 'sandbox.tool.raise' },
  { id: 'dig', glyph: '⛏', labelKey: 'sandbox.tool.dig' },
  { id: 'smooth', glyph: '〰', labelKey: 'sandbox.tool.smooth' },
  { id: 'rake', glyph: '🪮', labelKey: 'sandbox.tool.rake' },
  { id: 'water', glyph: '💧', labelKey: 'sandbox.tool.water' },
  { id: 'tunnel', glyph: '🕳', labelKey: 'sandbox.tool.tunnel' },
  { id: 'flatten', glyph: '⬜', labelKey: 'sandbox.tool.flatten' },
];

/** 本地兜底文案：i18n 表补上同名键后自动失效（见 useSurfaceCopy 注释） */
const FALLBACK: Record<string, string> = {
  'sandbox.surface.selectMode': '摆件',
  /*
   * 注意与 `sandbox.tool.flatten`（也叫「重新铺沙」）区分：
   * flatten 是**笔刷**，只在笔刷半径内抹平，且保留湿度；
   * reset 是**整盘重置**，把 128×96 高度场和湿度一起清零。
   * 两者文案必须不同，否则用户不知道点哪个会把整盘沙推倒重来。
   */
  'sandbox.surface.reset': '重铺整盘沙',
  'sandbox.surface.resetConfirm': '确认重铺？',
  'sandbox.surface.resetCancel': '取消',
  'sandbox.surface.resetDone': '沙面已重新铺平。',
  'sandbox.surface.toolbar': '沙面工具',
  'sandbox.surface.radiusValue': '当前 {value}',
  'sandbox.surface.strengthValue': '当前 {value}',
  'sandbox.surface.noDragIn3d': '3D 视角不支持拖动绘制，请切回「立体沙盘」。',
};

/**
 * 取文案：`t(key)` 命中不了（返回值等于键名）时用本地兜底。
 * 这样 i18n 表一旦补齐，这里一行都不用改。
 */
export function useSurfaceCopy() {
  const { t } = useI18n();
  return useCallback((key: string, vars?: Record<string, string | number>) => resolveSurfaceCopy(t, key, vars), [t]);
}

/**
 * 兜底逻辑的纯函数版本（不依赖 React，可单测）。
 *
 * @param t    i18n 的 translate；缺键时会原样返回 key
 * @param key  文案键
 */
export function resolveSurfaceCopy(
  t: (key: string, vars?: Record<string, string | number>) => string,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const value = t(key, vars);
  if (value !== key) return value;
  const raw = FALLBACK[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_match, name: string) =>
    vars[name] === undefined ? `{${name}}` : String(vars[name]),
  );
}

/** 兜底表的键（导出给测试用，确保与 i18n 表不重复定义） */
export const SURFACE_FALLBACK_KEYS: string[] = Object.keys(FALLBACK);


export interface SurfaceToolbarProps {
  /** 当前工具；null = 摆件（选择）模式 */
  tool: SurfaceTool | null;
  onToolChange: (tool: SurfaceTool | null) => void;
  radius: number;
  onRadiusChange: (radius: number) => void;
  strength: number;
  onStrengthChange: (strength: number) => void;
  /** 「重新铺沙」回调；不传则不渲染该按钮 */
  onReset?: () => void;
  /** 封盘 / 回放：整条工具栏禁用（仍可被读屏看到，解释"为什么不能用"） */
  disabled?: boolean;
  /** 是否渲染「摆件」选择按钮（画笔模式下可关掉） */
  showSelectMode?: boolean;
  /**
   * 静默（专注）模式。
   * true 时整个工具条返回 null —— 不占布局、不进 Tab 序列、读屏也读不到。
   * **不依赖任何祖先元素的 class**，这是刻意的：靠 `.ss-silent` 祖先选择器
   * 隐藏工具的写法，一旦页面忘了加那个 class 就会静默失效（用户点了专注模式
   * 却发现工具还在），属于最难查的一类 bug。
   */
  silent?: boolean;
  /** 二次确认的超时（毫秒），默认 4000 */
  confirmTimeoutMs?: number;
  className?: string;
  /**
   * data-testid 前缀，默认 `sandbox-tool`。
   *
   * 拼出来的名字：
   *   根节点 `${prefix}bar` -> `sandbox-toolbar`
   *   选择模式 `${prefix}-select` -> `sandbox-tool-select`
   *   各笔刷  `${prefix}-${id}` -> `sandbox-tool-raise` …
   *   滑杆    `${prefix}-radius` / `-strength`
   *   重铺    `${prefix}-reset` / `-reset-confirm` / `-reset-cancel`
   *
   * 这套名字与改造前页面里的内联工具条**逐字一致**，所以
   * `scripts/e2e/smoke.ts`（108 条断言）和十余个 `scripts/dev/*.mjs`
   * 探针都不需要改。换组件不该逼着所有调用方改选择器 ——
   * `data-testid` 是跨模块契约，改名的代价由整个仓库承担。
   */
  testIdPrefix?: string;
  /**
   * 工具条根节点的 `data-testid`；不传时默认 `${testIdPrefix}-toolbar`。
   *
   * 为什么要单独一个 prop：站点里既有的 testid 命名并不统一 ——
   * 根节点是 `sandbox-toolbar`，而按钮是 `sandbox-tool-raise`
   * （前缀 `sandbox-tool` + 按钮后缀，不是 `sandbox` + `-tool-`）。
   * 用一个 `testIdPrefix` 无法同时拼出这两种，所以根节点给个覆盖位。
   *
   * 保持旧 testid 不变很重要：`scripts/e2e/smoke.ts`（108 条断言）
   * 和十余个 `scripts/dev/*.mjs` 探针都按老名字找元素，
   * 换组件不该逼着它们全部改一遍。
   */
  testId?: string;
}

const CONFIRM_TIMEOUT = 4000;

export function SurfaceToolbar({
  tool,
  onToolChange,
  radius,
  onRadiusChange,
  strength,
  onStrengthChange,
  onReset,
  disabled = false,
  showSelectMode = true,
  silent = false,
  confirmTimeoutMs = CONFIRM_TIMEOUT,
  className = '',
  testIdPrefix = 'sandbox-tool',
  testId,
}: SurfaceToolbarProps) {
  const t = useSurfaceCopy();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  // 进入静默模式时若正处于"确认重铺"状态，必须撤销 —— 否则退出静默后
  // 会看到一个已经悬了很久的确认按钮，下一次点击就直接把沙盘抹了。
  useEffect(() => {
    if (silent) {
      clearTimer();
      setConfirmingReset(false);
    }
  }, [clearTimer, silent]);

  /** 取消确认（点别处 / 超时 / 再按一次） */
  const cancelConfirm = useCallback(() => {
    clearTimer();
    setConfirmingReset(false);
  }, [clearTimer]);

  const handleResetClick = useCallback(() => {
    if (disabled || !onReset) return;
    if (!confirmingReset) {
      setConfirmingReset(true);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setConfirmingReset(false);
      }, confirmTimeoutMs);
      return;
    }
    cancelConfirm();
    onReset();
  }, [cancelConfirm, clearTimer, confirmTimeoutMs, confirmingReset, disabled, onReset]);

  const radiusPercent = Math.round(radius * 100);
  const strengthPercent = Math.round(strength * 100);

  // 静默模式：整条工具栏不渲染（见 props.silent 注释）
  if (silent) return null;

  return (
    <div
      className={`ss-toolbar${disabled ? ' ss-toolbar--disabled' : ''}${className ? ` ${className}` : ''}`}
      role="toolbar"
      aria-label={t('sandbox.surface.toolbar')}
      aria-orientation="horizontal"
      data-testid={testId ?? `${testIdPrefix}bar`}
    >
      {/* ------------------------------ 模式 ------------------------------ */}
      {showSelectMode ? (
        <div className="ss-toolbar__group" role="group" aria-label={t('sandbox.tool.select')}>
          <button
            type="button"
            className={`ss-tool${tool === null ? ' is-active' : ''}`}
            aria-pressed={tool === null}
            disabled={disabled}
            data-testid={`${testIdPrefix}-select`}
            onClick={() => onToolChange(null)}
          >
            <span className="ss-tool__glyph" aria-hidden="true">
              ✥
            </span>
            <span className="ss-tool__label">{t('sandbox.surface.selectMode')}</span>
          </button>
          <span className="ss-toolbar__sep" aria-hidden="true" />
        </div>
      ) : null}

      {/* ------------------------------ 7 种笔刷 ------------------------------ */}
      <div className="ss-toolbar__group ss-toolbar__group--tools" role="group" aria-label="笔刷">
        {SURFACE_TOOL_LIST.map((entry) => {
          const active = tool === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              className={`ss-tool${active ? ' is-active' : ''}`}
              aria-pressed={active}
              disabled={disabled}
              data-testid={`${testIdPrefix}-${entry.id}`}
              onClick={() => onToolChange(entry.id)}
            >
              <span className="ss-tool__glyph" aria-hidden="true">
                {entry.glyph}
              </span>
              <span className="ss-tool__label">{t(entry.labelKey)}</span>
            </button>
          );
        })}
      </div>

      <span className="ss-toolbar__sep" aria-hidden="true" />

      {/* ------------------------------ 笔刷参数 ------------------------------ */}
      <div className="ss-toolbar__group ss-toolbar__group--ranges">
        <label className="ss-range">
          <span className="ss-range__label">
            {t('sandbox.tool.brushRadius')}
            <span className="ss-range__value mono" aria-hidden="true">
              {radiusPercent}
            </span>
          </span>
          <input
            className="ss-range__input"
            type="range"
            min={Math.round(BRUSH_RADIUS_MIN * 100)}
            max={Math.round(BRUSH_RADIUS_MAX * 100)}
            step={1}
            value={radiusPercent}
            disabled={disabled}
            aria-label={t('sandbox.tool.brushRadius')}
            aria-valuetext={t('sandbox.surface.radiusValue', { value: radiusPercent })}
            data-testid={`${testIdPrefix}-radius`}
            onChange={(event) => onRadiusChange(Number(event.currentTarget.value) / 100)}
          />
        </label>

        <label className="ss-range">
          <span className="ss-range__label">
            {t('sandbox.tool.strength')}
            <span className="ss-range__value mono" aria-hidden="true">
              {strengthPercent}
            </span>
          </span>
          <input
            className="ss-range__input"
            type="range"
            min={Math.round(BRUSH_STRENGTH_MIN * 100)}
            max={Math.round(BRUSH_STRENGTH_MAX * 100)}
            step={5}
            value={strengthPercent}
            disabled={disabled}
            aria-label={t('sandbox.tool.strength')}
            aria-valuetext={t('sandbox.surface.strengthValue', { value: strengthPercent })}
            data-testid={`${testIdPrefix}-strength`}
            onChange={(event) => onStrengthChange(Number(event.currentTarget.value) / 100)}
          />
        </label>
      </div>

      {/* ------------------------------ 重新铺沙 ------------------------------ */}
      {onReset ? (
        <>
          <span className="ss-toolbar__grow" aria-hidden="true" />
          <div className="ss-toolbar__group ss-toolbar__group--reset">
            {confirmingReset ? (
              <>
                <button
                  type="button"
                  className="ss-reset ss-reset--confirm"
                  disabled={disabled}
                  data-testid={`${testIdPrefix}-reset-confirm`}
                  onClick={handleResetClick}
                >
                  {t('sandbox.surface.resetConfirm')}
                </button>
                <button
                  type="button"
                  className="ss-reset ss-reset--cancel"
                  data-testid={`${testIdPrefix}-reset-cancel`}
                  onClick={cancelConfirm}
                >
                  {t('sandbox.surface.resetCancel')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ss-reset"
                disabled={disabled}
                data-testid={`${testIdPrefix}-reset`}
                onClick={handleResetClick}
              >
                {t('sandbox.surface.reset')}
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default SurfaceToolbar;
