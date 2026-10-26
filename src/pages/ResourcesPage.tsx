import { useMemo, useState } from 'react';
import { PageHeader, SectionHead } from '@/components/ui/Card';
import { Empty, Notice, Tag } from '@/components/ui/Primitives';
import { ButtonLink } from '@/components/ui/Button';
import { cx } from '@/lib/utils';
import { HelplineCard } from '@/resources/HelplineCard';
import { getPrimaryHelplines, HELPLINE_DATA_COLLECTED_AT } from '@/resources/helplines';
import {
  RESOURCES,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_INTROS,
  RESOURCE_DATA_COLLECTED_AT,
} from '@/resources/catalog';
import type { ResourceItem } from '@/resources/catalog';
import '@/styles/resources.css';

/** 关键词匹配：标题 / 机构 / 描述 / 标签 */
function matchesQuery(item: ResourceItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [item.title, item.org, item.description, item.category, ...item.tags]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export default function ResourcesPage() {
  const [query, setQuery] = useState('');
  const [activeCategories, setActiveCategories] = useState<string[]>([]);

  const toggleCategory = (category: string) => {
    setActiveCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  };

  const filtered = useMemo(() => {
    return RESOURCES.filter((item) => {
      const categoryOk =
        activeCategories.length === 0 || activeCategories.includes(item.category);
      return categoryOk && matchesQuery(item, query);
    });
  }, [activeCategories, query]);

  /** 按固定分类顺序分组；只保留有命中的分组 */
  const groups = useMemo(() => {
    return RESOURCE_CATEGORIES.map((category) => ({
      category,
      intro: RESOURCE_CATEGORY_INTROS[category] ?? '',
      items: filtered.filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0);
  }, [filtered]);

  const hasFilter = activeCategories.length > 0 || query.trim().length > 0;

  const resetFilters = () => {
    setQuery('');
    setActiveCategories([]);
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Resource Map"
        title="资源地图"
        subtitle="把「可以去找谁」整理成一张地图。看不懂没关系，先收藏，需要的时候再回来。"
        action={
          <ButtonLink to="/safety" variant="danger" size="lg">
            我现在需要帮助
          </ButtonLink>
        }
      />

      {/* ------------------------------ 热线置顶 ------------------------------ */}
      <section className="res-section" aria-labelledby="resources-helplines-title">
        <SectionHead
          title={<span id="resources-helplines-title">最重要的一栏：能立刻打通的电话</span>}
          desc="下面是三条 24 小时或接近 24 小时的心理危机热线。不需要想清楚要说什么，接通就够。"
        />
        <div className="helplines">
          {getPrimaryHelplines().map((h) => (
            <HelplineCard key={h.id} helpline={h} variant="primary" />
          ))}
        </div>
        <div className="btn-group mt-3">
          <ButtonLink to="/safety" variant="ghost" size="sm">
            查看全部热线与分场景指引 →
          </ButtonLink>
        </div>
      </section>

      <div className="divider" />

      {/* ------------------------------- 筛选 ------------------------------- */}
      <section aria-labelledby="resources-filter-title">
        <SectionHead
          title={<span id="resources-filter-title">按类别或关键词找资源</span>}
          desc="类别可以多选；搜索会在标题、机构、描述与标签里查找。"
        />
        <div className="res-toolbar">
          <div className="res-search">
            <span className="res-search__icon" aria-hidden>
              ⌕
            </span>
            <label className="sr-only" htmlFor="resource-search">
              搜索心理资源
            </label>
            <input
              id="resource-search"
              className="input"
              type="search"
              value={query}
              placeholder="试试「焦虑」「CBT」「睡眠」「创伤」…"
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="res-filters">
            <span className="res-filters__label">类别</span>
            {RESOURCE_CATEGORIES.map((category) => {
              const active = activeCategories.includes(category);
              return (
                <button
                  type="button"
                  key={category}
                  className={cx('tag', 'tag--selectable', active && 'tag--selected')}
                  onClick={() => toggleCategory(category)}
                  aria-pressed={active}
                >
                  {category}
                </button>
              );
            })}
            {hasFilter ? (
              <button type="button" className="btn btn--quiet btn--sm" onClick={resetFilters}>
                清除筛选
              </button>
            ) : null}
          </div>
        </div>
        <div className="res-results-line">
          <span>
            共 {RESOURCES.length} 条资源，当前显示 <b>{filtered.length}</b> 条
          </span>
          {hasFilter ? (
            <span className="small muted">
              已选类别：
              {activeCategories.length > 0 ? activeCategories.join('、') : '全部'}
              {query.trim() ? ` · 关键词「${query.trim()}」` : ''}
            </span>
          ) : null}
        </div>
      </section>

      {/* ------------------------------- 结果 ------------------------------- */}
      {groups.length === 0 ? (
        <Empty
          icon="◌"
          title="没有匹配的资源"
          desc="换个关键词试试，或者清除筛选看看全部条目。如果你在找的是紧急帮助，请直接看页面顶部的热线。"
          action={
            <div className="btn-group">
              <button type="button" className="btn btn--ghost" onClick={resetFilters}>
                清除筛选
              </button>
              <ButtonLink to="/safety" variant="danger">
                危机与求助
              </ButtonLink>
            </div>
          }
        />
      ) : (
        groups.map((group) => (
          <section className="res-group" key={group.category} aria-labelledby={`cat-${group.category}`}>
            <div className="res-group__head">
              <h2 className="res-group__title" id={`cat-${group.category}`}>
                {group.category}
              </h2>
              <span className="res-group__count">{group.items.length} 条</span>
            </div>
            <p className="res-section__intro">{group.intro}</p>
            <div className="res-cards">
              {group.items.map((item) => (
                <article className="res-card" key={item.id}>
                  <div className="res-card__head">
                    <div>
                      <h3 className="res-card__title">{item.title}</h3>
                      <p className="res-card__org">{item.org}</p>
                    </div>
                  </div>
                  <p className="res-card__desc">{item.description}</p>
                  <div className="res-card__tags">
                    {item.free ? (
                      <Tag tone="teal">免费</Tag>
                    ) : (
                      <Tag tone="clay">需付费 / 购买</Tag>
                    )}
                    <Tag outline>{item.lang === 'zh' ? '中文' : 'English'}</Tag>
                    {item.tags.slice(0, 3).map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </div>
                  <div className="res-card__foot">
                    {item.url ? (
                      <a
                        className="res-link"
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        访问官方网站
                        <span className="res-link__arrow" aria-hidden>
                          ↗
                        </span>
                      </a>
                    ) : (
                      <span className="res-card__nolink">
                        {item.category === '书籍与播客'
                          ? '书籍信息，请自行在书店或图书馆检索'
                          : '暂无可靠官方链接，故不提供外链'}
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}

      {/* ------------------------------- 说明 ------------------------------- */}
      <div className="divider" />
      <Notice tone="plain" title="关于这份清单">
        <p>
          清单里的资源整理于 {RESOURCE_DATA_COLLECTED_AT}，收录的都是机构官网或官方专题页。
          本站不代理、不推荐任何具体服务方，也不对其服务质量作评价——请把它当作检索的起点。
        </p>
        <p className="mt-2">
          部分条目（例如只在公众号内运营的服务、需要购买的书籍）无法给出可靠的官方链接，
          我们选择留空而不是编一个链接。这类条目会明确标注。
        </p>
        <p className="mt-2">
          页面顶部热线的资料整理于 {HELPLINE_DATA_COLLECTED_AT}，号码与接听时间可能变更，
          如已停用请改拨 12356 或 120。
        </p>
      </Notice>
    </div>
  );
}
