import { useCallback, useId, useMemo } from 'react';
import { cx } from '@/lib/utils';
import { useI18n } from '@/i18n';
import { AFFECT_LABELS } from '@/sandbox/symbols';

/**
 * 感受标签选择器（多选）。
 *
 * 伦理边界（契约 §5.5 / VISION.md §5.3）：标签**只用于整理与回看**，
 * 不做任何统计推断、不做情绪分析、不生成结论。因此这里：
 * - 不排序、不计数、不给「最常见」之类的提示；
 * - 词表原样取自 `AFFECT_LABELS`（13 个，中性，覆盖正负与身体感受）；
 * - 文案只有「只用来整理，不做任何分析」。
 *
 * 完全受控：`value` 与 `onChange`，组件不持有选择状态。
 */

export interface AffectPickerProps {
  /** 已选标签 */
  value: string[];
  /** 选择变化（返回新数组，保持词表顺序） */
  onChange: (next: string[]) => void;
  /** 已选标签展示的对象名，例如「树」 */
  subject?: string;
  /** 只读（回放 / 封盘） */
  readOnly?: boolean;
  className?: string;
  /** 是否显示顶部提示，默认 true */
  showHint?: boolean;
  /** 最大可选数量，默认不限 */
  max?: number;
}

export function AffectPicker({
  value,
  onChange,
  subject,
  readOnly = false,
  className,
  showHint = true,
  max,
}: AffectPickerProps) {
  const { t } = useI18n();
  const hintId = useId();

  const selected = useMemo(() => new Set(value), [value]);
  /* 展示顺序一律按词表：`value` 由上层控制，可能来自任意顺序的存档 */
  const orderedValue = useMemo(
    () => AFFECT_LABELS.filter((label) => selected.has(label)),
    [selected],
  );
  const atMax = max !== undefined && value.length >= max;

  const toggle = useCallback(
    (label: string) => {
      if (readOnly) return;
      const isOn = selected.has(label);
      if (!isOn && atMax) return;
      const next = isOn ? value.filter((item) => item !== label) : [...value, label];
      // 保持词表顺序：读写两侧都稳定，不因点击顺序变化而跳动
      onChange(AFFECT_LABELS.filter((item) => next.includes(item)));
    },
    [atMax, onChange, readOnly, selected, value],
  );

  return (
    <div className={cx('affect-picker', className)}>
      {showHint ? (
        <p className="affect-picker__hint" id={hintId}>
          {subject ? `给「${subject}」贴感受：` : `${t('sandbox.item.affect')}：`}
          {t('sandbox.item.affectHint')}
        </p>
      ) : null}

      <div
        className="affect-picker__list"
        role="group"
        aria-label={t('sandbox.item.affect')}
        aria-describedby={showHint ? hintId : undefined}
      >
        {AFFECT_LABELS.map((label) => {
          const isOn = selected.has(label);
          return (
            <button
              key={label}
              type="button"
              className="affect-picker__chip"
              aria-pressed={isOn}
              disabled={readOnly || (!isOn && atMax)}
              title={readOnly ? '已封盘，不能修改' : undefined}
              onClick={() => toggle(label)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="affect-picker__foot">
        <span className="affect-picker__selected">
          {orderedValue.length === 0
            ? '还没有贴标签（可留空）'
            : `已选 ${orderedValue.length} 个：${orderedValue.join('、')}`}
        </span>
        {!readOnly && value.length > 0 ? (
          <button type="button" className="btn btn--quiet btn--sm affect-picker__clear" onClick={() => onChange([])}>
            清空
          </button>
        ) : null}
      </div>
    </div>
  );
}
