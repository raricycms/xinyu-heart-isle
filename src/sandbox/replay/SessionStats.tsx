import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, SectionHead } from '@/components/ui/Card';
import { Progress, Stat } from '@/components/ui/Primitives';
import { formatDuration } from '@/lib/date';
import type { SandSession } from '@/lib/types';
import {
  computeSessionStats,
  ZONE_LABELS,
  type SessionStatsData,
} from '@/sandbox/replay/stats';
import { downloadStatsMarkdown } from '@/sandbox/replay/statsExport';
import { useI18n } from '@/i18n';

/**
 * 客观统计面板。
 *
 * **伦理边界（VISION.md §5.6）**：这里只呈现可数的事实——
 * 数量、时长、次数、分布比例。不得出现任何形容词、评价、解释或"倾向"推断。
 * 因此本组件里没有「说明」「意味着」「反映」「健康」这类词，只有数字与单位。
 *
 * 结构（自上而下）：
 * 1. 免责说明（固定在最顶部，`replay.statsDisclaimer`）
 * 2. 关键计数
 * 3. 时间分布
 * 4. 沙面比例
 * 5. 九宫格分布
 * 6. 事件类型分布（CSS 横向条形图，无图表库）
 * 7. 沙具按大类 / 子类汇总
 * 8. 沙具清单
 * 9. 导出 `.md`
 */

export interface SessionStatsProps {
  session: SandSession;
  /** 外部已算好的统计（避免重复计算） */
  stats?: SessionStatsData;
  /** 是否显示导出按钮，默认 true */
  showExport?: boolean;
  /** 导出成功后的回调（用于 toast） */
  onExport?: (fileName: string) => void;
}

export function SessionStats({ session, stats: statsProp, showExport = true, onExport }: SessionStatsProps) {
  const { t } = useI18n();
  const stats = useMemo(
    () => statsProp ?? computeSessionStats(session),
    [session, statsProp],
  );
  const [exported, setExported] = useState(false);

  const maxEventTypeCount = stats.eventTypes.length > 0
    ? Math.max(...stats.eventTypes.map((entry) => entry.count))
    : 1;
  const maxSubcategoryCount = stats.subcategoryCounts.length > 0
    ? Math.max(...stats.subcategoryCounts.map((entry) => entry.count))
    : 1;

  const handleExport = () => {
    const ok = downloadStatsMarkdown(session, { stats });
    if (!ok) return;
    setExported(true);
    onExport?.(`${session.title}.md`);
    window.setTimeout(() => setExported(false), 2400);
  };

  return (
    <Card className="mt-5 stats-card">
      {/* 免责说明固定在面板顶部 —— 不可折叠、不可关闭 */}
      <p className="stats-disclaimer" role="note">
        {t('replay.statsDisclaimer')}
      </p>

      <SectionHead
        title={t('replay.stats')}
        action={
          showExport ? (
            <Button size="sm" variant="ghost" onClick={handleExport}>
              {exported ? '已导出' : '导出 .md'}
            </Button>
          ) : null
        }
      />

      <div className="stats-grid">
        <Stat value={stats.itemCount} label={t('stats.itemCount')} />
        <Stat value={formatDuration(stats.durationMs / 1000)} label={t('stats.duration')} />
        <Stat value={stats.eventCount} label={t('stats.eventCount')} />
        <Stat value={stats.addCount} label={t('stats.addCount')} />
        <Stat value={stats.removeCount} label={t('stats.removeCount')} />
        <Stat value={stats.moveCount} label={t('stats.moveCount')} />
        <Stat value={stats.noteCount} label={t('stats.noteCount')} />
        <Stat value={stats.strokeCount} label={t('stats.strokeCount')} />
        <Stat value={stats.sceneChanges} label={t('stats.sceneChanges')} />
      </div>

      {/* 时间分布 */}
      <div className="stats-block">
        <h4 className="stats-block__title">时间</h4>
        <dl className="stats-list">
          <div className="stats-list__row">
            <dt>{t('stats.firstItemAt')}</dt>
            <dd className="mono">{formatEventOffset(stats.firstItemAt)}</dd>
          </div>
          <div className="stats-list__row">
            <dt>{t('stats.lastActionAt')}</dt>
            <dd className="mono">{formatEventOffset(stats.lastActionAt)}</dd>
          </div>
          <div className="stats-list__row">
            <dt>{t('stats.longestPause')}</dt>
            <dd className="mono">{formatDuration(stats.longestPauseMs / 1000)}</dd>
          </div>
        </dl>
      </div>

      {/* 沙面 */}
      <div className="stats-block">
        <h4 className="stats-block__title">沙面</h4>
        <div className="stats-bars">
          <div className="stats-bar">
            <span className="stats-bar__label small">
              {t('stats.surfaceMoved')}{' '}
              <span className="mono">{Math.round(stats.surfaceMovedRatio * 100)}%</span>
            </span>
            <Progress value={Math.round(stats.surfaceMovedRatio * 100)} />
          </div>
          <div className="stats-bar">
            <span className="stats-bar__label small">
              {t('stats.wetRatio')} <span className="mono">{Math.round(stats.wetRatio * 100)}%</span>
            </span>
            <Progress value={Math.round(stats.wetRatio * 100)} />
          </div>
        </div>
      </div>

      {/* 九宫格分布 */}
      {stats.itemCount > 0 ? (
        <div className="stats-block">
          <h4 className="stats-block__title">{t('stats.zones')}</h4>
          <p className="small muted stats-block__hint">{t('stats.zonesHint')}</p>
          <div className="stats-zones">
            {stats.zones.map((cell) => (
              <div
                key={cell.zone}
                className="stats-zone"
                data-active={cell.count > 0}
                title={`${ZONE_LABELS[cell.zone]} · ${cell.count}`}
              >
                <span className="stats-zone__count mono">{cell.count || ''}</span>
                <span className="stats-zone__label small muted">{ZONE_LABELS[cell.zone]}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 事件类型分布（CSS 横向条形图） */}
      <div className="stats-block">
        <h4 className="stats-block__title">事件类型分布</h4>
        <p className="small muted stats-block__hint">
          共 {stats.eventCount} 次操作，下表按次数从多到少排列。
        </p>
        {stats.eventTypes.length === 0 ? (
          <p className="small muted">{t('common.none')}</p>
        ) : (
          <ul className="stats-dist" aria-label="事件类型分布">
            {stats.eventTypes.map((entry) => {
              const pct = Math.round(entry.ratio * 100);
              return (
                <li key={entry.type} className="stats-dist__row">
                  <span className="stats-dist__label small">{entry.label}</span>
                  <span className="stats-dist__track" aria-hidden="true">
                    <span
                      className="stats-dist__fill"
                      style={{ width: `${Math.max(2, (entry.count / maxEventTypeCount) * 100)}%` }}
                    />
                  </span>
                  <span className="stats-dist__value mono small">
                    {entry.count} <span className="stats-dist__pct">({pct}%)</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 沙具按大类 / 子类汇总 */}
      <div className="stats-block">
        <h4 className="stats-block__title">沙具按子类汇总</h4>
        <p className="small muted stats-block__hint">
          子类到大类为固定映射，只做计数，不表示含义。
        </p>
        {stats.subcategoryCounts.length === 0 ? (
          <p className="small muted">{t('common.none')}</p>
        ) : (
          <>
            <ul className="stats-dist" aria-label="沙具子类汇总">
              {stats.subcategoryCounts.map((entry) => (
                <li key={entry.subcategory} className="stats-dist__row">
                  <span className="stats-dist__label small">
                    {entry.label}
                    <span className="stats-dist__pct"> · {entry.categoryLabel}</span>
                  </span>
                  <span className="stats-dist__track" aria-hidden="true">
                    <span
                      className="stats-dist__fill stats-dist__fill--clay"
                      style={{ width: `${Math.max(2, (entry.count / maxSubcategoryCount) * 100)}%` }}
                    />
                  </span>
                  <span className="stats-dist__value mono small">{entry.count}</span>
                </li>
              ))}
            </ul>
            <p className="small muted stats-subcats-total">
              大类合计：
              {stats.categoryCounts.map((entry) => `${entry.label} ${entry.count}`).join(' · ')}
            </p>
          </>
        )}
      </div>

      {/* 摆件清单（只列名称与次数，不做归类判断） */}
      <div className="stats-block">
        <h4 className="stats-block__title">用到的沙具</h4>
        <div className="stats-symbols">
          {stats.symbolCounts.length === 0 ? (
            <span className="small muted">{t('common.none')}</span>
          ) : (
            stats.symbolCounts.map((entry) => (
              <span key={entry.symbolId} className="stats-symbol">
                <span className="stats-symbol__glyph" aria-hidden="true">
                  {entry.glyph}
                </span>
                <span className="stats-symbol__label">{entry.label}</span>
                <span className="stats-symbol__count mono small">×{entry.count}</span>
              </span>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}

function formatEventOffset(ms: number | null): string {
  if (ms === null) return '—';
  return formatDuration(ms / 1000);
}
