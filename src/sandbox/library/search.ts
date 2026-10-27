/**
 * 心屿 · 沙具库检索（可测试的纯函数层）
 *
 * 为什么不直接用 `symbols.ts` 的 `searchSymbols`：
 * 内置库只有 327 条，而沙具包导入后条目来自多个来源，检索必须作用在
 * **合并后的条目集合**上。这里的打分规则与 `searchSymbols` 保持一致
 * （命中 label 100 分 / 前缀 60 分 / 任意字段 20 分），所以内置库的
 * 检索结果与 `searchSymbols` 等价，同时支持沙具包条目。
 *
 * 伦理约束：tags 只用于检索（VISION.md §5.2），本文件不做任何语义归类。
 */

import type { SandboxSymbolEntry, SymbolSubcategory } from '@/lib/types';
import { categoryOrder, subcategoryLabels, type SymbolCategory } from '@/sandbox/symbols';

/** 把一条沙具拼成可检索的字符串（全部小写） */
function haystackOf(symbol: SandboxSymbolEntry): string {
  return [
    symbol.label,
    symbol.labelEn ?? '',
    symbol.id,
    symbol.subcategory,
    subcategoryLabels[symbol.subcategory] ?? '',
    ...(symbol.tags ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * 「伞词 -> 追加检索词」表。
 *
 * 用户常常用一个大词找一类东西（搜「树」时其实想看各种植物），而内置库的
 * label/tags 是逐条写的，不会条条都带「树」。因此这里把少量常见伞词映射到
 * **更多检索词**（子类 id、或同义的英文 id，二者本来就在检索字段里），
 * 让「树」能带出棕榈（子类 nature-plant）与森林（id `forest`）。
 *
 * 边界：这张表**只影响能不能搜到**，不参与任何分类、统计或解读；
 * 扩展词命中的条目只拿基础分（+20），不会挤掉精确命中。
 */
const UMBRELLA_TOKENS: Record<string, string[]> = {
  树: ['nature-plant', 'forest'],
  植物: ['nature-plant'],
  花: ['nature-plant'],
  水: ['nature-water'],
  山: ['nature-land'],
  天气: ['nature-sky'],
  动物: ['animal-wild', 'animal-farm', 'animal-water', 'animal-insect'],
  生灵: ['animal-wild', 'animal-farm', 'animal-water', 'animal-insect'],
  虫: ['animal-insect'],
  鸟: ['animal-wild'],
  鱼: ['animal-water'],
  人: ['person-adult', 'person-child', 'person-family', 'person-role', 'person-myth'],
  人物: ['person-adult', 'person-child', 'person-family', 'person-role', 'person-myth'],
  家人: ['person-family'],
  房子: ['building-home', 'building-public'],
  建筑: ['building-home', 'building-public', 'building-religious', 'building-ruin'],
  车: ['object-vehicle'],
  交通: ['object-vehicle'],
  工具: ['object-tool'],
  食物: ['object-food'],
  吃: ['object-food'],
  符号: ['abstract-symbol'],
  元素: ['abstract-element'],
};

/** 把查询词展开成「原词 + 伞词扩展词」 */
export function expandTokens(query: string): string[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const expanded: string[] = [];
  for (const token of tokens) {
    if (!expanded.includes(token)) expanded.push(token);
    for (const extra of UMBRELLA_TOKENS[token] ?? []) {
      if (!expanded.includes(extra)) expanded.push(extra);
    }
  }
  return expanded;
}

/** 单条打分；0 表示不匹配 */
export function scoreEntry(symbol: SandboxSymbolEntry, tokens: string[]): number {
  const haystack = haystackOf(symbol);
  let score = 0;
  for (const token of tokens) {
    if (symbol.label === token || symbol.id === token) score += 100;
    else if (symbol.label.startsWith(token)) score += 60;
    else if (haystack.includes(token)) score += 20;
  }
  return score;
}

/**
 * 检索沙具。空查询返回前 `limit` 条（保持原顺序），匹配为空返回空数组。
 * 中文查询按字面匹配，不做分词（327+ 条的量级不需要）。
 */
export function searchEntries(
  entries: readonly SandboxSymbolEntry[],
  query: string,
  limit = 60,
): SandboxSymbolEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice(0, limit);
  const tokens = expandTokens(q);
  const scored: Array<{ symbol: SandboxSymbolEntry; score: number; index: number }> = [];

  entries.forEach((symbol, index) => {
    const score = scoreEntry(symbol, tokens);
    if (score > 0) scored.push({ symbol, score, index });
  });

  // 同分时保持原始顺序（内置库按子类分组排列，顺序本身有含义：常用在前）
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((entry) => entry.symbol);
}

/** 按大类过滤；`all` 返回全部 */
export function filterByCategory(
  entries: readonly SandboxSymbolEntry[],
  category: SymbolCategory | 'all',
): SandboxSymbolEntry[] {
  if (category === 'all') return [...entries];
  return entries.filter((entry) => entry.category === category);
}

/** 子类分节：只保留有内容的分节，顺序按 `subcategoryLabels` 的声明顺序 */
export function groupBySubcategory(
  entries: readonly SandboxSymbolEntry[],
): Array<{ subcategory: SymbolSubcategory; label: string; items: SandboxSymbolEntry[] }> {
  const buckets = new Map<SymbolSubcategory, SandboxSymbolEntry[]>();
  for (const entry of entries) {
    const list = buckets.get(entry.subcategory);
    if (list) list.push(entry);
    else buckets.set(entry.subcategory, [entry]);
  }
  return (Object.keys(subcategoryLabels) as SymbolSubcategory[])
    .filter((key) => (buckets.get(key)?.length ?? 0) > 0)
    .map((key) => ({
      subcategory: key,
      label: subcategoryLabels[key],
      items: buckets.get(key) ?? [],
    }));
}

/** 大类 -> 该类下的子类（展示顺序固定） */
export function subcategoriesOf(
  entries: readonly SandboxSymbolEntry[],
  category: SymbolCategory,
): SymbolSubcategory[] {
  return groupBySubcategory(entries.filter((entry) => entry.category === category)).map(
    (group) => group.subcategory,
  );
}

/** 合并多个来源的条目；同 id 时后者被丢弃（内置库优先），避免重复渲染 */
export function mergeEntries(...groups: ReadonlyArray<readonly SandboxSymbolEntry[]>): SandboxSymbolEntry[] {
  const seen = new Set<string>();
  const merged: SandboxSymbolEntry[] = [];
  for (const group of groups) {
    for (const entry of group) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      merged.push(entry);
    }
  }
  return merged;
}

/** 常用位（无搜索、未选大类时展示）：按大类轮流取，保证 6 类都露脸 */
export function starterEntries(
  entries: readonly SandboxSymbolEntry[],
  limit = 24,
): SandboxSymbolEntry[] {
  const buckets = categoryOrder.map((category) =>
    entries.filter((entry) => entry.category === category),
  );
  const picked: SandboxSymbolEntry[] = [];
  let cursor = 0;
  while (picked.length < limit) {
    let added = false;
    for (const bucket of buckets) {
      const next = bucket[cursor];
      if (next) {
        picked.push(next);
        added = true;
        if (picked.length >= limit) break;
      }
    }
    if (!added) break;
    cursor += 1;
  }
  return picked;
}

/* -------------------------------------------------------------------------- */
/*                                   收藏                                     */
/* -------------------------------------------------------------------------- */

/**
 * 收藏上限。
 *
 * 为什么要有上限：`favoriteSymbols` 落在 localStorage，而收藏动作是
 * 一星一次、没有撤销成本，很容易被手滑刷到几千条。localStorage 的
 * 配额是 5MB 量级，写失败会**静默丢整份偏好**（见 `storage.ts` 的
 * 配额注释）。所以这里先兜住：满了就丢弃最早的一条。
 *
 * 200 这个数字来自实际使用：327 件沙具里，一个人真正反复用的大多
 * 在几十件以内；200 留了足够余量，又远小于会危害配额的量级。
 */
export const MAX_FAVORITES = 200;

/**
 * 切换收藏。返回**新数组**，不改入参 —— `useSyncExternalStore` 依赖
 * 引用变化来判定更新，原地 push 会导致 UI 不重渲染。
 *
 * 满额时丢弃最早收藏的那条（数组头部），保证新收藏一定进得去 ——
 * 用户点星标时期待的是「加进去」，不是「加不进去」。
 */
export function toggleFavorite(favorites: readonly string[], id: string): string[] {
  if (favorites.includes(id)) return favorites.filter((entry) => entry !== id);
  const next = [...favorites, id];
  return next.length > MAX_FAVORITES ? next.slice(next.length - MAX_FAVORITES) : next;
}

/**
 * 把收藏 id 映射回条目，并**丢弃已经不存在的 id**（沙具包被卸载、
 * 内置库改名都会造成悬空 id）。顺序保持收藏顺序。
 */
export function resolveFavorites(
  entries: readonly SandboxSymbolEntry[],
  favorites: readonly string[],
): SandboxSymbolEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return favorites
    .map((id) => byId.get(id))
    .filter((entry): entry is SandboxSymbolEntry => entry !== undefined);
}
