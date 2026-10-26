import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, SectionHead } from '@/components/ui/Card';
import { Notice, Tag } from '@/components/ui/Primitives';
import { STORAGE_KEYS, useCollection } from '@/lib/storage';
import { formatDateTime } from '@/lib/date';
import type { ToolSession } from '@/lib/types';
import { TOOLS, getToolById, toolsByCategory } from '@/toolbox/tools';
import '@/styles/toolbox.css';

const TOOL_GLYPH_FALLBACK = '◎';

export default function ToolboxPage() {
  const sessions = useCollection<ToolSession>(STORAGE_KEYS.toolSessions);
  const [filter, setFilter] = useState<string>('全部');

  const groups = useMemo(() => {
    const all = toolsByCategory();
    return filter === '全部' ? all : all.filter((group) => group.category === filter);
  }, [filter]);

  // 最近练过的（去重，取最近 5 个不同的练习）
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const list: ToolSession[] = [];
    for (const session of sessions) {
      if (seen.has(session.toolId)) continue;
      seen.add(session.toolId);
      list.push(session);
      if (list.length >= 5) break;
    }
    return list;
  }, [sessions]);

  const totalMinutes = useMemo(
    () =>
      Math.round(
        sessions.reduce((sum, session) => sum + (session.durationSec ?? 0), 0) / 60,
      ),
    [sessions],
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="Emotion Toolbox"
        title="情绪工具箱"
        subtitle="七个具体能做的练习。不用先想通什么，挑一个现在就能开始的。"
      />

      <Notice tone="teal" icon="◍">
        这些练习来自认知行为疗法（CBT）、辩证行为疗法（DBT）和正念减压（MBSR）中的常用技术，
        但它们不是治疗。如果情绪持续两周以上影响生活，请考虑找专业人士聊聊。
      </Notice>

      {/* 统计条 */}
      {sessions.length > 0 ? (
        <div className="toolbox-stats">
          <div className="toolbox-stat">
            <strong className="mono">{sessions.length}</strong>
            <small>累计练习次数</small>
          </div>
          <div className="toolbox-stat">
            <strong className="mono">{totalMinutes}</strong>
            <small>累计分钟</small>
          </div>
          <div className="toolbox-stat">
            <strong className="mono">{recent.length}</strong>
            <small>练过的练习</small>
          </div>
        </div>
      ) : null}

      {/* 最近练过 */}
      {recent.length > 0 ? (
        <div className="toolbox-recent">
          <SectionHead title="继续上次的" desc="不用重头选一遍。" />
          <div className="toolbox-recent__list">
            {recent.map((session) => {
              const tool = getToolById(session.toolId);
              if (!tool) return null;
              return (
                <Link key={session.id} to={`/toolbox/${tool.id}`} className="toolbox-recent__item">
                  <span className="toolbox-recent__glyph" aria-hidden>
                    {tool.glyph || TOOL_GLYPH_FALLBACK}
                  </span>
                  <span className="toolbox-recent__body">
                    <span className="toolbox-recent__label">{tool.label}</span>
                    <span className="small muted">{formatDateTime(session.at)}</span>
                  </span>
                  <span className="toolbox-recent__go" aria-hidden>
                    →
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 筛选 */}
      <div className="toolbox-filter">
        <span className="small muted">按需要选：</span>
        {['全部', '立即安抚', '认知梳理', '日常记录'].map((name) => (
          <button
            key={name}
            type="button"
            className={`tag tag--selectable ${filter === name ? 'tag--selected' : ''}`}
            onClick={() => setFilter(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {/* 分组列表 */}
      {groups.map((group) => (
        <section key={group.category} className="toolbox-group">
          <SectionHead title={group.category} desc={group.hint} />
          <div className="grid grid--3">
            {group.items.map((tool) => (
              <Link key={tool.id} to={`/toolbox/${tool.id}`} className="tool-card">
                <div className="tool-card__top">
                  <span className="tool-card__glyph" aria-hidden>
                    {tool.glyph || TOOL_GLYPH_FALLBACK}
                  </span>
                  <Tag tone="plain">{tool.durationMin} 分钟</Tag>
                </div>
                <h3 className="tool-card__label">{tool.label}</h3>
                <p className="tool-card__desc">{tool.description}</p>
                <p className="tool-card__when small muted">适合：{tool.whenToUse}</p>
                <span className="tool-card__go" aria-hidden>
                  开始 →
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <div className="toolbox-foot">
        <p className="small muted">
          七个练习共 {TOOLS.length} 项。没有顺序要求，也不需要全都做。
          在很难受的时候，先看「立即安抚」那一组。
        </p>
        <p className="small muted mt-2">
          如果你现在有伤害自己的念头，请先看
          <Link to="/safety"> 危机与求助 </Link>
          ，那里有可以直接拨打的电话。
        </p>
      </div>
    </div>
  );
}
