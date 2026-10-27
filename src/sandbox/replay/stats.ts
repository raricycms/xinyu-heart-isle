/**
 * 心屿 · 会话统计（纯函数，可单测）
 *
 * **只数事实，不做推断。** 每个字段都能从事件流直接数出来，
 * 没有加权、没有评分、没有「健康度」。这是 VISION.md §5.6 的硬要求。
 */

import type {
  SandSession,
  SandSurface,
  SandboxEvent,
  SandboxEventType,
  SymbolSubcategory,
} from '@/lib/types';
import { eventLabel } from '@/sandbox/events';
import { deserializeSurface } from '@/sandbox/surfaceState';
import { surfaceStats } from '@/sandbox/surfaceOps';
import {
  categoryLabels,
  getSymbolById,
  subcategoryCategory,
  subcategoryLabels,
  symbolGlyph,
  symbolLabel,
  type SymbolCategory,
} from '@/sandbox/symbols';

/** 九宫格区域 key（按阅读顺序：左上 -> 右下） */
export type ZoneKey =
  | 'tl' | 'tc' | 'tr'
  | 'ml' | 'mc' | 'mr'
  | 'bl' | 'bc' | 'br';

export const ZONE_LABELS: Record<ZoneKey, string> = {
  tl: '左上',
  tc: '上中',
  tr: '右上',
  ml: '左中',
  mc: '中间',
  mr: '右中',
  bl: '左下',
  bc: '下中',
  br: '右下',
};

export const ZONE_ORDER: ZoneKey[] = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];

export interface ZoneCell {
  zone: ZoneKey;
  count: number;
}

export interface SymbolCount {
  symbolId: string;
  glyph: string;
  label: string;
  count: number;
}

/** 事件类型分布的一项（纯计数，不含任何推断） */
export interface EventTypeCount {
  type: SandboxEventType;
  label: string;
  count: number;
  /** count / 事件总数，0..1；事件数为 0 时为 0 */
  ratio: number;
}

/** 沙具子类汇总的一项。`subcategory === 'unknown'` 表示历史数据里出现过的未知 sandbox 沙具 id。 */
export interface SubcategoryCount {
  subcategory: SymbolSubcategory | 'unknown';
  label: string;
  category: SymbolCategory;
  categoryLabel: string;
  count: number;
}

/** 沙具大类汇总的一项（由子类反查得到） */
export interface CategoryCount {
  category: SymbolCategory;
  label: string;
  count: number;
}

/** 事件类型的稳定展示顺序（未在此表里的类型排在最后） */
export const EVENT_TYPE_ORDER: SandboxEventType[] = [
  'item.add',
  'item.move',
  'item.remove',
  'item.scale',
  'item.rotate',
  'item.layer',
  'item.bury',
  'item.note',
  'item.affect',
  'surface.stroke',
  'surface.reset',
  'scene.change',
  'session.start',
  'session.phase',
  'session.lock',
  'session.save',
  'session.import',
  'annotation.add',
  'reflection.edit',
];

export interface SessionStatsData {
  /** 最终摆件数 */
  itemCount: number;
  /** 事件总数 */
  eventCount: number;
  /** 从第一条到最后一条事件的毫秒数 */
  durationMs: number;
  addCount: number;
  removeCount: number;
  moveCount: number;
  scaleCount: number;
  rotateCount: number;
  noteCount: number;
  strokeCount: number;
  sceneChanges: number;
  /** 第一件摆件出现的时刻（相对会话开始） */
  firstItemAt: number | null;
  /** 最后一次动作的时刻 */
  lastActionAt: number | null;
  /** 相邻事件之间的最长间隔 */
  longestPauseMs: number;
  /** 沙面被改动过的格子比例 0..1 */
  surfaceMovedRatio: number;
  /** 沙面湿润比例 0..1 */
  wetRatio: number;
  /** 九宫格分布（含 0） */
  zones: ZoneCell[];
  /** 用到的沙具及次数（按次数倒序） */
  symbolCounts: SymbolCount[];
  /*
   * 这里原本还有一个 `annotatedItemCount`（有注释的摆件数）。
   * 它被算了整整一年，却**没有任何一处 UI 显示它** —— 幽灵字段。
   * 与 `noteCount` 也不同义：后者是「写备注这个动作发生了多少次」，
   * 前者是「最终有几个摆件带着备注」。但既然没人展示，就没留下它的理由。
   * 这份代码里「算了但没人看」的字段和「写了但没人读的偏好」是同一种病。
   */
  /** 事件类型分布（按 EVENT_TYPE_ORDER，只用出现过的类型，按 count 倒序） */
  eventTypes: EventTypeCount[];
  /** 沙具子类汇总（按 count 倒序） */
  subcategoryCounts: SubcategoryCount[];
  /** 沙具大类汇总（由子类反查，按 count 倒序） */
  categoryCounts: CategoryCount[];
}

/**
 * 计算一次会话的客观统计。
 *
 * 容错：`events` 为空（旧版本会话）时，退化为「只看最终画面」——
 * 数量与分布仍然可算，过程类指标返回 0。
 */
export function computeSessionStats(session: SandSession): SessionStatsData {
  const events: SandboxEvent[] = session.events ?? [];
  const counts = countEventTypes(events);
  const times = events.map((event) => event.t).filter((t) => Number.isFinite(t));

  const firstItemAt = findFirst(events, 'item.add');
  const lastActionAt = times.length > 0 ? times[times.length - 1] : null;

  // 相邻事件的最长间隔（只看非零间隔）
  let longestPauseMs = 0;
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    if (gap > longestPauseMs) longestPauseMs = gap;
  }

  const durationMs =
    times.length >= 2 ? times[times.length - 1] - times[0] : 0;

  // 沙面统计：优先用会话里存的最终沙面。
  //
  // 没有 surface 字段时，**不要** `replayAll(events)` —— 那会把整条事件流
  // （含所有摆件操作）重算一遍，只为取一个沙面；4000 条纯 add 的会话
  // 实测 72ms，而只要有 surface 字段就只要 1ms，差 70 倍。
  //
  // 沙面是「最后一条 surface 事件即最终状态」的覆盖语义（见 applyEvent），
  // 所以只要倒着找最后一条 surface.* 事件就够了，是 O(n) 且常数极小。
  const surface = session.surface
    ? deserializeSurface(session.surface)
    : deserializeSurface(lastSurfaceEvent(events)?.payload?.after as SandSurface | undefined);
  const surfaceAggregate = surfaceStats(surface);
  const surfaceMovedRatio = surfaceAggregate.movedRatio;
  const wetRatio = surfaceAggregate.wetRatio;

  // 九宫格分布：用最终摆件位置
  const zones = ZONE_ORDER.map((zone) => ({ zone, count: 0 }));
  const zoneIndex = new Map(zones.map((cell, index) => [cell.zone, index]));
  for (const item of session.items) {
    const zone = zoneOf(item.x, item.y);
    const index = zoneIndex.get(zone);
    if (index !== undefined) zones[index].count += 1;
  }

  // 沙具计数
  const symbolMap = new Map<string, number>();
  for (const item of session.items) {
    symbolMap.set(item.symbolId, (symbolMap.get(item.symbolId) ?? 0) + 1);
  }
  const symbolCounts: SymbolCount[] = [...symbolMap.entries()]
    .map(([symbolId, count]) => ({
      symbolId,
      glyph: symbolGlyph(symbolId),
      label: symbolLabel(symbolId),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));

  return {
    itemCount: session.items.length,
    eventCount: events.length,
    durationMs,
    addCount: counts['item.add'] ?? 0,
    removeCount: counts['item.remove'] ?? 0,
    moveCount: counts['item.move'] ?? 0,
    scaleCount: counts['item.scale'] ?? 0,
    rotateCount: counts['item.rotate'] ?? 0,
    noteCount: counts['item.note'] ?? 0,
    strokeCount: counts['surface.stroke'] ?? 0,
    sceneChanges: counts['scene.change'] ?? 0,
    firstItemAt,
    lastActionAt,
    longestPauseMs,
    surfaceMovedRatio,
    wetRatio,
    zones,
    symbolCounts,
    eventTypes: buildEventTypes(counts, events.length),
    subcategoryCounts: buildSubcategoryCounts(session.items),
    categoryCounts: buildCategoryCounts(session.items),
  };
}

/** 从事件流倒着找最后一条携带 after 沙面的 surface 事件 */
function lastSurfaceEvent(events: SandboxEvent[]): SandboxEvent | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === 'surface.stroke' && event.payload?.after) return event;
    if (event.type === 'surface.reset') return undefined;
  }
  return undefined;
}

/** 事件类型分布：只列出现过的类型，按次数倒序、同次数按 EVENT_TYPE_ORDER 稳定排序 */
function buildEventTypes(
  counts: Record<string, number>,
  total: number,
): EventTypeCount[] {
  const orderIndex = new Map<string, number>(EVENT_TYPE_ORDER.map((type, index) => [type, index]));
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({
      type: type as SandboxEventType,
      label: eventLabel(type as SandboxEventType),
      count,
      ratio: total > 0 ? count / total : 0,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (orderIndex.get(a.type) ?? Number.MAX_SAFE_INTEGER) -
          (orderIndex.get(b.type) ?? Number.MAX_SAFE_INTEGER),
    );
}

/** 沙具子类汇总（用 subcategoryCategory 反查大类，未知 symbolId 单独记为「未知」） */
function buildSubcategoryCounts(items: SandSession['items']): SubcategoryCount[] {
  const map = new Map<SymbolSubcategory | 'unknown', number>();
  for (const item of items) {
    const symbol = getSymbolById(item.symbolId);
    const key: SymbolSubcategory | 'unknown' = symbol?.subcategory ?? 'unknown';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .filter(([, count]) => count > 0)
    .map(([subcategory, count]) => {
      if (subcategory === 'unknown') {
        return {
          subcategory: 'unknown' as const,
          label: '未知沙具',
          category: 'abstract' as SymbolCategory,
          categoryLabel: categoryLabels.abstract,
          count,
        };
      }
      const category = subcategoryCategory[subcategory];
      return {
        subcategory,
        label: subcategoryLabels[subcategory],
        category,
        categoryLabel: categoryLabels[category],
        count,
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
}

/** 沙具大类汇总：由子类反查得到，只列出现过的 */
function buildCategoryCounts(items: SandSession['items']): CategoryCount[] {
  const map = new Map<SymbolCategory, number>();
  for (const item of items) {
    const symbol = getSymbolById(item.symbolId);
    if (!symbol) continue;
    const category = subcategoryCategory[symbol.subcategory] ?? symbol.category;
    map.set(category as SymbolCategory, (map.get(category as SymbolCategory) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([category, count]) => ({ category, label: categoryLabels[category], count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
}

function countEventTypes(events: SandboxEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
}

function findFirst(events: SandboxEvent[], type: string): number | null {
  for (const event of events) {
    if (event.type === type) return event.t;
  }
  return null;
}

/** 归一化坐标 -> 九宫格 */
export function zoneOf(x: number, y: number): ZoneKey {
  const col = x < 1 / 3 ? 0 : x < 2 / 3 ? 1 : 2;
  const row = y < 1 / 3 ? 0 : y < 2 / 3 ? 1 : 2;
  const grid: ZoneKey[][] = [
    ['tl', 'tc', 'tr'],
    ['ml', 'mc', 'mr'],
    ['bl', 'bc', 'br'],
  ];
  return grid[row][col];
}
