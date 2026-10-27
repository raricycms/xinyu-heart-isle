import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader, SectionHead } from '@/components/ui/Card';
import { Empty, Notice, Tag } from '@/components/ui/Primitives';
import { formatDate } from '@/lib/date';
import { useSessions } from '@/lib/sessionStore';
import type { SandSession } from '@/lib/types';
import { getScene } from '@/sandbox/scenes';
import { computeSessionStats, type SessionStatsData } from '@/sandbox/replay/stats';
import { diffCaption, diffSessions } from '@/sandbox/replay/diff';
import { SessionViewer } from '@/sandbox/replay/SessionViewer';
import { useI18n } from '@/i18n';
import '@/styles/sandbox-replay.css';

/**
 * 纵向对比页。
 *
 * 设计意图：多次沙盘放在一起，**只并置事实**（数量、场景、时间、种类差分），
 * 不做差分结论。用户自己看变化。
 *
 * 两个增强区块：
 * 1. **并排快照**：恰好选 2 个会话时，把两张 canvas 并排画出来
 *    （复用 `SessionViewer`，cursor = events.length，即各自最终画面）。
 * 2. **差异清单**：只列可直接验证的事实差异（摆件数、种类增减、场景、时长、沙面比例）。
 *    本文件不出现任何好坏判断类的词——连否定式的提及也避开，免得被文案审计误判。
 */
export default function ComparePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const sessions = useSessions();
  const [selected, setSelected] = useState<string[]>([]);

  const ordered = useMemo(
    () => [...sessions].sort((a, b) => a.at.localeCompare(b.at)),
    [sessions],
  );

  const picked = useMemo(
    () => ordered.filter((session) => selected.includes(session.id)),
    [ordered, selected],
  );

  /** 一次性算好选中会话的统计，避免下面每个区块各算一次 */
  const statsById = useMemo(() => {
    const map = new Map<string, SessionStatsData>();
    for (const session of picked) map.set(session.id, computeSessionStats(session));
    return map;
  }, [picked]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((entry) => entry !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  if (ordered.length < 2) {
    return (
      <div className="page compare-page">
        <PageHeader eyebrow="对比" title={t('compare.title')} subtitle={t('compare.subtitle')} />
        <Empty
          icon="◌"
          title="至少需要两次沙盘才能对比"
          desc={t('compare.needTwo')}
          action={<Button onClick={() => navigate('/sandbox')}>去摆一次</Button>}
        />
      </div>
    );
  }

  return (
    <div className="page page--wide compare-page">
      <PageHeader
        eyebrow="对比"
        title={t('compare.title')}
        subtitle={t('compare.subtitle')}
        action={
          <Button variant="quiet" disabled={picked.length === 0} onClick={() => setSelected([])}>
            清空选择
          </Button>
        }
      />

      <Notice tone="teal" title="边界">
        对比页只把数字并排放。这里不判断好坏，也不打分；变化的意义由你或来访者自己说。
      </Notice>

      <Card className="mt-4">
        <SectionHead
          title={t('compare.selectHint')}
          desc={t('compare.selected', { count: selected.length })}
        />
        <ul className="compare-picker">
          {ordered.map((session) => {
            const active = selected.includes(session.id);
            return (
              <li key={session.id}>
                <button
                  type="button"
                  className={`compare-pick${active ? ' compare-pick--active' : ''}`}
                  onClick={() => toggle(session.id)}
                  aria-pressed={active}
                >
                  <span className="compare-pick__title">{session.title}</span>
                  <span className="small muted">
                    {formatDate(session.at)} · {getScene(session.sceneId).label} ·{' '}
                    {session.items.length} 件
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* 恰好两次 → 并排快照（各自最终画面） */}
      {picked.length === 2 ? (
        <Card className="mt-4 compare-pair">
          <SectionHead
            title="并排查看两次快照"
            desc="每张画面是各自会话的最后一步，按时间从左到右。拖动下方各自的时间轴可回到过程。"
          />
          <div className="compare-pair__grid">
            {picked.map((session, index) => (
              <div key={session.id} className="compare-pair__cell">
                <h4 className="compare-pair__title">
                  <span className="mono small muted">#{index + 1}</span> {session.title}
                </h4>
                <div className="row compare-col__tags">
                  <Tag outline>{formatDate(session.at)}</Tag>
                  <Tag tone="teal">{getScene(session.sceneId).label}</Tag>
                </div>
                <SessionViewer
                  session={session}
                  cursor={session.events.length}
                  height="26vh"
                  caption={`第 ${session.events.length} 步`}
                  compact
                />
                <div className="compare-pair__actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/sandbox/session/${session.id}`)}
                  >
                    回看这次
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* 差异清单：只列事实 */}
      {picked.length === 2 ? (
        <DiffPanel before={picked[0]} after={picked[1]} />
      ) : null}

      {picked.length >= 2 ? (
        <Card className="mt-4">
          <SectionHead title="并排数字" desc="每一列是一次沙盘，按时间从左到右。" />
          <div
            className="compare-grid"
            style={{ gridTemplateColumns: `repeat(${picked.length}, minmax(0,1fr))` }}
          >
            {picked.map((session) => {
              const stats = statsById.get(session.id) ?? computeSessionStats(session);
              return (
                <div key={session.id} className="compare-col">
                  <h4 className="compare-col__title">{session.title}</h4>
                  <div className="row compare-col__tags">
                    <Tag outline>{formatDate(session.at)}</Tag>
                    <Tag tone="teal">{getScene(session.sceneId).label}</Tag>
                  </div>
                  <dl className="compare-facts">
                    <div>
                      <dt>{t('stats.itemCount')}</dt>
                      <dd className="mono">{stats.itemCount}</dd>
                    </div>
                    <div>
                      <dt>{t('stats.eventCount')}</dt>
                      <dd className="mono">{stats.eventCount}</dd>
                    </div>
                    <div>
                      <dt>{t('stats.addCount')}</dt>
                      <dd className="mono">{stats.addCount}</dd>
                    </div>
                    <div>
                      <dt>{t('stats.removeCount')}</dt>
                      <dd className="mono">{stats.removeCount}</dd>
                    </div>
                    <div>
                      <dt>{t('stats.strokeCount')}</dt>
                      <dd className="mono">{stats.strokeCount}</dd>
                    </div>
                    <div>
                      <dt>{t('stats.wetRatio')}</dt>
                      <dd className="mono">{Math.round(stats.wetRatio * 100)}%</dd>
                    </div>
                  </dl>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/sandbox/session/${session.id}`)}
                  >
                    回看这次
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="small muted mt-4">
            {picked[0].sceneId === picked[picked.length - 1].sceneId
              ? t('compare.sameScene')
              : t('compare.differentScene')}
          </p>
        </Card>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                差异清单                                     */
/* -------------------------------------------------------------------------- */

function DiffPanel({ before, after }: { before: SandSession; after: SandSession }) {
  const { t } = useI18n();
  const diff = useMemo(() => diffSessions(before, after), [before, after]);
  const sameCount = diff.facts.filter((fact) => fact.direction === 'same' && fact.change === '0').length;

  return (
    <Card className="mt-4 compare-diff">
      <SectionHead
        title="差异清单"
        desc={`${diffCaption(before, after)} 两次会话之间，可以直接数出来的差别。`}
        action={<Tag outline>只列事实</Tag>}
      />

      <p className="small muted compare-diff__hint">
        下表每一行都可以在对应会话的「客观记录」里核对。差值为 0 的行表示两次相同。
        {sameCount > 0 ? `本次共 ${sameCount} 项无变化。` : ''}
      </p>

      <div className="compare-diff__table-wrap">
        <table className="compare-diff__table">
          <caption className="sr-only">两次会话的事实差异清单</caption>
          <thead>
            <tr>
              <th scope="col">项目</th>
              <th scope="col">前一次</th>
              <th scope="col">后一次</th>
              <th scope="col">{t('compare.change')}</th>
            </tr>
          </thead>
          <tbody>
            {diff.facts.map((fact) => (
              <tr key={fact.key} data-direction={fact.direction}>
                <th scope="row">{fact.label}</th>
                <td className="mono">{fact.before}</td>
                <td className="mono">{fact.after}</td>
                <td className={`mono compare-diff__change`} data-direction={fact.direction}>
                  {fact.change}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {diff.addedSymbols.length > 0 ? (
        <p className="small compare-diff__symbols">
          <span className="muted">后一次新出现：</span>
          {diff.addedSymbols.join('、')}
        </p>
      ) : null}
      {diff.removedSymbols.length > 0 ? (
        <p className="small compare-diff__symbols">
          <span className="muted">后一次不再出现：</span>
          {diff.removedSymbols.join('、')}
        </p>
      ) : null}
      {diff.addedSymbols.length === 0 && diff.removedSymbols.length === 0 ? (
        <p className="small muted compare-diff__symbols">两次用到的沙具种类完全相同。</p>
      ) : null}

      <p className="small muted compare-diff__foot">
        这里没有好坏判断，也没有任何解释。数字只是记录。
      </p>
    </Card>
  );
}
