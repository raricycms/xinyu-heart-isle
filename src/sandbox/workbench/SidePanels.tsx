import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n';
import { AFFECT_LABELS, promptsForStage, type PromptStage } from '@/sandbox/symbols';

/**
 * 侧栏：引导语 / 保存面板 / 封盘确认。
 *
 * 引导语的三阶段对应临床时序（VISION.md §5.3）：
 * 开始前降低门槛 -> 摆放中提供反思锚点 -> 结束后承接到语言表达。
 * 所有提示语都是**开放式提问**，不含解释与建议。
 */

/* -------------------------------------------------------------------------- */
/*                                 引导语卡片                                  */
/* -------------------------------------------------------------------------- */

export interface PromptCardProps {
  seed: number;
  onRefresh: () => void;
}

export function PromptCard({ seed, onRefresh }: PromptCardProps) {
  const { t } = useI18n();
  const [stage, setStage] = useState<PromptStage>('during');

  const prompts = promptsForStage(stage, seed, 3);

  return (
    <Card className="wb-card">
      <div className="wb-card__head">
        <strong>{t('sandbox.prompts')}</strong>
        <button type="button" className="wb-link" onClick={onRefresh}>
          {t('sandbox.promptsRefresh')}
        </button>
      </div>

      <div className="wb-tabs wb-tabs--sm" role="tablist" aria-label="引导语阶段">
        {(['before', 'during', 'after'] as PromptStage[]).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={stage === entry}
            className={`wb-tab${stage === entry ? ' is-active' : ''}`}
            onClick={() => setStage(entry)}
          >
            {t(`sandbox.promptStage.${entry}`)}
          </button>
        ))}
      </div>

      <ul className="wb-prompts">
        {prompts.map((prompt) => (
          <li key={prompt} className="wb-prompts__item">
            {prompt}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 保存面板                                    */
/* -------------------------------------------------------------------------- */

export interface SavePanelProps {
  reflection: string;
  onReflectionChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

export function SavePanel({ reflection, onReflectionChange, onSave, onCancel, saving }: SavePanelProps) {
  const { t } = useI18n();

  return (
    <Card className="wb-card">
      <div className="wb-card__head">
        <strong>{t('sandbox.save')}</strong>
      </div>
      <label className="field">
        <span className="field-label">{t('sandbox.reflectionLabel')}</span>
        <textarea
          className="textarea"
          value={reflection}
          rows={4}
          maxLength={400}
          placeholder={t('sandbox.reflectionPlaceholder')}
          onChange={(event) => onReflectionChange(event.target.value)}
        />
        <span className="field-hint">{reflection.length} / 400</span>
      </label>
      <div className="btn-group mt-3">
        <Button onClick={onSave} disabled={saving} data-testid="sandbox-save-confirm">
          {saving ? t('common.loading') : t('sandbox.save')}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 封盘确认                                    */
/* -------------------------------------------------------------------------- */

export interface LockDialogProps {
  open: boolean;
  itemCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LockDialog({ open, itemCount, onConfirm, onCancel }: LockDialogProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="wb-modal" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <div className="wb-modal__panel">
        <h2 className="card-title" id="lock-title">
          {t('lock.title')}
        </h2>
        <p className="card-desc mt-2">{t('lock.desc')}</p>
        <p className="small muted mt-2">当前有 {itemCount} 件摆件。</p>
        <div className="btn-group mt-4" style={{ justifyContent: 'flex-end' }}>
          <Button variant="quiet" onClick={onCancel}>
            {t('lock.cancel')}
          </Button>
          <Button variant="ghost" onClick={onConfirm}>
            {t('lock.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              感受标签（沙盘级）                              */
/* -------------------------------------------------------------------------- */

export interface SandboxAffectProps {
  labels: string[];
  onChange: (labels: string[]) => void;
}

export function SandboxAffect({ labels, onChange }: SandboxAffectProps) {
  const toggle = useCallback(
    (label: string) => {
      onChange(
        labels.includes(label) ? labels.filter((entry) => entry !== label) : [...labels, label],
      );
    },
    [labels, onChange],
  );

  return (
    <div className="wb-affects">
      {AFFECT_LABELS.map((label) => (
        <button
          key={label}
          type="button"
          className={`wb-affect${labels.includes(label) ? ' is-active' : ''}`}
          onClick={() => toggle(label)}
          aria-pressed={labels.includes(label)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
