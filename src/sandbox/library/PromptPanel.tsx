import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { cx } from '@/lib/utils';
import { useI18n } from '@/i18n';
import { PROMPT_STAGES, promptsForView } from './prompts';
import type { PromptStage } from '@/sandbox/symbols';
import '@/styles/sandbox-library.css';

/**
 * 引导语面板。
 *
 * 伦理边界（契约 §5.6 / VISION.md §5.3）：
 * 这里出现的每一句话都必须是**开放式提问**——不解释、不评判、不给建议、
 * 不暗示「你的沙盘代表什么」。文案全部来自 `symbols.ts` 的 `PROMPT_GROUPS`，
 * 本组件不新增任何提示语句。
 *
 * 受控性：`stage` / `seed` 由上层传入，`onStageChange` / `onRefresh` 让上层决定状态，
 * 组件自己只记录「哪条被折叠」这类纯 UI 状态。
 */

export interface PromptPanelProps {
  /** 当前阶段；不传时用内部 state（向后兼容的「非受控」用法） */
  stage?: PromptStage;
  /** 当前 seed（决定取哪几条） */
  seed?: number;
  /** 每次展示几条，默认 3 */
  count?: number;
  /** 阶段切换 */
  onStageChange?: (stage: PromptStage) => void;
  /** 换一组 */
  onRefresh?: (nextSeed: number) => void;
  className?: string;
  /** 是否显示「只是提问，不是解读」的伦理说明，默认 true */
  showEthics?: boolean;
  /** 是否显示阶段 tabs，默认 true */
  showStages?: boolean;
}

export function PromptPanel({
  stage,
  seed,
  count = 3,
  onStageChange,
  onRefresh,
  className,
  showEthics = true,
  showStages = true,
}: PromptPanelProps) {
  const { t } = useI18n();
  const baseId = useId();

  const [innerStage, setInnerStage] = useState<PromptStage>(stage ?? 'during');
  const [innerSeed, setInnerSeed] = useState<number>(seed ?? 0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const activeStage = stage ?? innerStage;
  const activeSeed = seed ?? innerSeed;

  useEffect(() => {
    if (stage) setInnerStage(stage);
  }, [stage]);

  useEffect(() => {
    if (seed !== undefined) setInnerSeed(seed);
  }, [seed]);

  const prompts = useMemo(
    () => promptsForView(activeStage, activeSeed, count),
    [activeSeed, activeStage, count],
  );

  /* 换一组：seed 变化后重置折叠状态，避免上一组的折叠位置串到这一组 */
  useEffect(() => {
    setCollapsed({});
  }, [activeSeed, activeStage]);

  const handleStage = useCallback(
    (next: PromptStage) => {
      setInnerStage(next);
      onStageChange?.(next);
    },
    [onStageChange],
  );

  const handleRefresh = useCallback(() => {
    const next = activeSeed + 1;
    setInnerSeed(next);
    onRefresh?.(next);
  }, [activeSeed, onRefresh]);

  return (
    <section className={cx('prompt-panel', className)} aria-label={t('sandbox.prompts')}>
      <div className="prompt-panel__head">
        {showStages ? (
          <div className="prompt-panel__stages" role="tablist" aria-label={t('sandbox.phase')}>
            {PROMPT_STAGES.map((key) => {
              const active = activeStage === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={cx('prompt-panel__stage', active && 'is-active')}
                  onClick={() => handleStage(key)}
                >
                  {t(`sandbox.promptStage.${key}`)}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="small muted">{t('sandbox.prompts')}</span>
        )}

        <button
          type="button"
          className="btn btn--ghost btn--sm prompt-panel__refresh"
          onClick={handleRefresh}
          aria-label={t('sandbox.promptsRefresh')}
        >
          {t('sandbox.promptsRefresh')}
        </button>
      </div>

      <ul className="prompt-list" id={`${baseId}-list`}>
        {prompts.map((prompt, index) => {
          const key = `${activeStage}-${activeSeed}-${index}`;
          const isCollapsed = collapsed[key] ?? true;
          return (
            <li
              key={key}
              className={cx('prompt-list__item', isCollapsed && 'is-collapsed')}
            >
              <button
                type="button"
                className="prompt-list__toggle"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }))
                }
              >
                <span className="prompt-list__marker mono" aria-hidden>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="prompt-list__text">{prompt}</span>
              </button>
              {!isCollapsed ? (
                <p className="prompt-list__note">
                  可以先不用回答。哪一句让你停了一下，哪一句就是此刻的入口。
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {showEthics ? (
        <p className="prompt-panel__ethics">
          这些只是提问。系统不会解释你的沙盘，也不会告诉你它「代表什么」。
        </p>
      ) : null}
    </section>
  );
}
