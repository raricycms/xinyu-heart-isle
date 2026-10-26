import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { clamp } from '@/lib/utils';
import type { SandboxItem } from '@/lib/types';
import { AFFECT_LABELS, symbolGlyph, symbolLabel } from '@/sandbox/symbols';
import { useI18n } from '@/i18n';

/**
 * 选中摆件的属性面板。
 *
 * 设计原则：**只给客观参数**（大小、角度、层级、埋入深度），
 * 不给「这个位置意味着什么」这类解释。注释与感受标签都是可选的。
 */

export interface InspectorProps {
  item: SandboxItem;
  readOnly: boolean;
  onChange: (patch: Partial<SandboxItem>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onBringFront: () => void;
  onSendBack: () => void;
  onDone: () => void;
}

export function Inspector({
  item,
  readOnly,
  onChange,
  onRemove,
  onDuplicate,
  onBringFront,
  onSendBack,
  onDone,
}: InspectorProps) {
  const { t } = useI18n();
  const [noteDraft, setNoteDraft] = useState(item.note ?? '');

  useEffect(() => {
    setNoteDraft(item.note ?? '');
  }, [item.id, item.note]);

  const affects = item.affectLabels ?? [];

  const toggleAffect = (label: string) => {
    if (readOnly) return;
    const next = affects.includes(label)
      ? affects.filter((entry) => entry !== label)
      : [...affects, label];
    onChange({ affectLabels: next });
  };

  return (
    <aside className="wb-inspector" aria-label="摆件属性">
      <header className="wb-inspector__head">
        <span className="wb-inspector__glyph" aria-hidden="true">
          {symbolGlyph(item.symbolId)}
        </span>
        <div className="wb-inspector__meta">
          <strong>{symbolLabel(item.symbolId)}</strong>
          <span className="small muted mono">
            x {item.x.toFixed(2)} · y {item.y.toFixed(2)} · z {item.z}
          </span>
        </div>
        <button type="button" className="wb-close" onClick={onDone} aria-label={t('common.close')}>
          ✕
        </button>
      </header>

      <div className="wb-inspector__body">
        <label className="wb-slider">
          <span className="wb-slider__label">
            {t('sandbox.item.scale')} <span className="mono">{item.scale.toFixed(2)}</span>
          </span>
          <input
            className="range"
            type="range"
            min={0.2}
            max={4}
            step={0.05}
            value={item.scale}
            disabled={readOnly}
            onChange={(event) => onChange({ scale: clamp(Number(event.target.value), 0.2, 4) })}
          />
        </label>

        <label className="wb-slider">
          <span className="wb-slider__label">
            {t('sandbox.item.rotate')} <span className="mono">{Math.round(item.rotation)}°</span>
          </span>
          <input
            className="range"
            type="range"
            min={-180}
            max={180}
            step={5}
            value={item.rotation}
            disabled={readOnly}
            onChange={(event) => onChange({ rotation: Number(event.target.value) })}
          />
        </label>

        <label className="wb-slider">
          <span className="wb-slider__label">
            {t('sandbox.item.bury')} <span className="mono">{Math.round((item.burial ?? 0) * 100)}%</span>
          </span>
          <input
            className="range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={item.burial ?? 0}
            disabled={readOnly}
            onChange={(event) => onChange({ burial: Number(event.target.value) })}
          />
        </label>

        <div className="wb-inspector__group">
          <span className="wb-inspector__group-title">{t('sandbox.item.note')}</span>
          <textarea
            className="textarea wb-inspector__note"
            value={noteDraft}
            disabled={readOnly}
            maxLength={60}
            rows={2}
            placeholder={t('sandbox.item.notePlaceholder')}
            onChange={(event) => setNoteDraft(event.target.value)}
            onBlur={() => {
              if (noteDraft.trim() !== (item.note ?? '')) onChange({ note: noteDraft.trim() || undefined });
            }}
          />
        </div>

        <div className="wb-inspector__group">
          <span className="wb-inspector__group-title">{t('sandbox.item.affect')}</span>
          <p className="small muted wb-inspector__hint">{t('sandbox.item.affectHint')}</p>
          <div className="wb-affects">
            {AFFECT_LABELS.map((label) => (
              <button
                key={label}
                type="button"
                className={`wb-affect${affects.includes(label) ? ' is-active' : ''}`}
                onClick={() => toggleAffect(label)}
                disabled={readOnly}
                aria-pressed={affects.includes(label)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="wb-inspector__group">
          <span className="wb-inspector__group-title">层级</span>
          <div className="btn-group">
            <Button size="sm" variant="quiet" disabled={readOnly} onClick={onBringFront}>
              {t('sandbox.item.bringFront')}
            </Button>
            <Button size="sm" variant="quiet" disabled={readOnly} onClick={onSendBack}>
              {t('sandbox.item.sendBack')}
            </Button>
          </div>
        </div>
      </div>

      <footer className="wb-inspector__foot">
        <Button size="sm" variant="quiet" disabled={readOnly} onClick={onDuplicate}>
          {t('sandbox.item.duplicate')}
        </Button>
        <Button size="sm" variant="danger" disabled={readOnly} onClick={onRemove}>
          {t('sandbox.item.remove')}
        </Button>
      </footer>
    </aside>
  );
}
