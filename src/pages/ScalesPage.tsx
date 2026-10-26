import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ButtonLink } from '@/components/ui/Button';
import { Card, PageHeader, SectionHead } from '@/components/ui/Card';
import { Notice, Tag } from '@/components/ui/Primitives';
import { formatDateTime } from '@/lib/date';
import { STORAGE_KEYS, useCollection } from '@/lib/storage';
import type { Scale, ScaleCategory, ScaleResult } from '@/lib/types';
import { cx } from '@/lib/utils';
import { SCALE_CATEGORIES, SCALES } from '@/scales/data';
import { findLevel, totalRange } from '@/scales/scoring';
import '@/styles/scales.css';

/** 每个量表最近一次作答结果：scaleId -> ScaleResult */
function latestByScale(results: ScaleResult[]): Record<string, ScaleResult> {
  const map: Record<string, ScaleResult> = {};
  for (const result of results) {
    const current = map[result.scaleId];
    // useCollection 返回的是未排序快照，这里自行比较时间，取最新
    if (!current || result.at > current.at) map[result.scaleId] = result;
  }
  return map;
}

function ScaleCard({ scale, last }: { scale: Scale; last?: ScaleResult }) {
  const range = totalRange(scale);
  const level = last ? findLevel(scale, last.total) : undefined;

  return (
    <Card className="scale-card">
      <div className="scale-card__head">
        <div className="scale-card__title-wrap">
          <h3 className="card-title scale-card__title">{scale.name}</h3>
          <div className="scale-card__meta">
            <Tag tone="teal">{scale.shortName}</Tag>
            <Tag outline>{scale.category}</Tag>
          </div>
        </div>
        <span className="scale-card__arrow" aria-hidden>
          →
        </span>
      </div>

      <p className="card-desc scale-card__desc">{scale.description}</p>

      <dl className="scale-card__facts">
        <div className="scale-fact">
          <dt>题目</dt>
          <dd className="mono">{scale.questions.length} 题</dd>
        </div>
        <div className="scale-fact">
          <dt>用时</dt>
          <dd className="mono">约 {scale.estimatedMinutes} 分钟</dd>
        </div>
        <div className="scale-fact">
          <dt>时间范围</dt>
          <dd>{scale.timeframe}</dd>
        </div>
        <div className="scale-fact">
          <dt>量程</dt>
          <dd className="mono">
            {range.min}–{range.max} 分
          </dd>
        </div>
      </dl>

      {last && level ? (
        <div className={cx('scale-card__last', `scale-card__last--${level.tone}`)}>
          <div className="row-between">
            <span className="small scale-card__last-label">上次结果</span>
            <span className="small muted mono">{formatDateTime(last.at)}</span>
          </div>
          <div className="scale-card__last-main">
            <span className="scale-card__last-total mono">{last.total}</span>
            <span className="scale-card__last-unit mono">/ {range.max} 分</span>
            <Tag tone={level.tone}>{level.label}</Tag>
          </div>
        </div>
      ) : (
        <div className="scale-card__last scale-card__last--empty">
          <span className="small muted">还没有作答过 · 随时可以做，也可以随时停下</span>
        </div>
      )}

      <div className="scale-card__actions">
        <ButtonLink to={`/scales/${scale.id}`} size="sm" block>
          {last ? '再测一次' : '开始作答'}
        </ButtonLink>
      </div>
    </Card>
  );
}

export default function ScalesPage() {
  const results = useCollection<ScaleResult>(STORAGE_KEYS.scaleResults);
  const [category, setCategory] = useState<ScaleCategory | 'all'>('all');

  const latest = useMemo(() => latestByScale(results), [results]);
  const doneCount = SCALES.filter((scale) => latest[scale.id]).length;

  const visible = useMemo(
    () => (category === 'all' ? SCALES : SCALES.filter((scale) => scale.category === category)),
    [category],
  );

  return (
    <div className="page scales-page">
      <PageHeader
        eyebrow="Assessment"
        title="心理量表"
        subtitle="用几个问题，把「说不清的状态」变成可以看见的东西。所有结果只保存在你的浏览器里。"
        action={
          <ButtonLink to="/records" variant="ghost" size="sm">
            我的记录
          </ButtonLink>
        }
      />

      <Notice tone="teal" title="这不是诊断" icon="◍">
        这里的量表都只是自我了解的工具：结果代表「你最近的状态大概在什么范围」，不代表任何医学结论，
        也不能替代专业评估。如果分数让你不安，那不是「你有问题」的证据，而是「可以找人聊聊」的信号。
        <br />
        任何时候，如果你有伤害自己的念头，请直接前往{' '}
        <Link to="/safety" className="scale-notice-link">
          危机与求助
        </Link>{' '}
        页面，或拨打 12356。
      </Notice>

      <div className="scales-toolbar">
        <div className="scales-filter" role="group" aria-label="按类别筛选量表">
          <button
            type="button"
            className={cx('tag', 'tag--selectable', category === 'all' && 'tag--selected')}
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            全部 {SCALES.length}
          </button>
          {SCALE_CATEGORIES.map((item) => {
            const count = SCALES.filter((scale) => scale.category === item).length;
            return (
              <button
                key={item}
                type="button"
                className={cx('tag', 'tag--selectable', category === item && 'tag--selected')}
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {item} {count}
              </button>
            );
          })}
        </div>
        <p className="small muted scales-toolbar__count">
          已完成 {doneCount} / {SCALES.length} 个
        </p>
      </div>

      <section className="mt-4">
        <SectionHead
          title={category === 'all' ? '全部量表' : `${category}相关量表`}
          desc="一次只做一份，比一次做完全部更能看清自己。"
        />
        <div className="grid grid--2 scales-grid">
          {visible.map((scale) => (
            <ScaleCard key={scale.id} scale={scale} last={latest[scale.id]} />
          ))}
        </div>
      </section>

      <div className="scales-footnote">
        <Notice>
          作答时请按「最近这段时间真实的感受」选择，不必挑看起来更好的答案。中途觉得不舒服可以随时停下，
          已经答的内容不会保存，也不会有人看到。
        </Notice>
      </div>
    </div>
  );
}
