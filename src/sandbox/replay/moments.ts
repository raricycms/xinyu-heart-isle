/**
 * 心屿 · 时间轴关键节点与事件过滤（纯函数，可单测）
 *
 * 「关键节点」只挑**可客观定义**的时刻：第一件摆件、第一次整理沙面、每一次换场景。
 * 不挑「情绪最高点」这类需要推断的时刻——那不在本产品的能力与伦理边界内。
 *
 * 约定：关键节点的 `cursor` 是「重放到第几条事件」（1-based 的步数），
 * 与 `replay(events, cursor)` / `Timeline` 的 cursor 语义完全一致。
 */

import type { SandboxEvent, SandboxEventType, SandSession } from '@/lib/types';
import { eventLabel, formatEventTime } from '@/sandbox/events';

/** 关键节点类型 */
export type MomentKind = 'first-item' | 'first-surface' | 'scene-change';

export interface KeyMoment {
  /** 稳定 id，用于 React key 与测试断言 */
  id: string;
  kind: MomentKind;
  /** 重放到第几条事件（0 ~ events.length） */
  cursor: number;
  /** 该事件的相对时间（毫秒） */
  t: number;
  /** 中文标签，例如「第 1 件摆件」「换到「夜晚」」 */
  label: string;
  /** `mm:ss` 形式的时间 */
  time: string;
}

/** 事件列表过滤档位（只影响列表展示，不影响 cursor 语义） */
export type TimelineFilter = 'all' | 'item' | 'surface';

/** 判断一条事件是否属于某个过滤档位 */
export function matchesFilter(event: SandboxEvent, filter: TimelineFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'item') return event.type.startsWith('item.');
  if (filter === 'surface') {
    return event.type === 'surface.stroke' || event.type === 'surface.reset';
  }
  return true;
}

/** 按事件类型归类，供 UI 上色/分组（不表达任何评价） */
export function eventCategory(type: SandboxEventType): 'item' | 'surface' | 'scene' | 'meta' {
  if (type.startsWith('item.')) return 'item';
  if (type.startsWith('surface.')) return 'surface';
  if (type === 'scene.change') return 'scene';
  return 'meta';
}

/**
 * 从事件流里找出关键节点。
 *
 * - 第一件摆件：第一条 `item.add`
 * - 第一次整理沙面：第一条 `surface.stroke`
 * - 每次换场景：每一条 `scene.change`
 *
 * 结果按 `cursor` 升序；同一时刻多个节点时保持事件顺序稳定。
 */
export function findKeyMoments(
  events: SandboxEvent[],
  options: { sceneLabel?: (sceneId: string) => string } = {},
): KeyMoment[] {
  const sceneLabel = options.sceneLabel ?? ((id: string) => id);
  const moments: KeyMoment[] = [];
  let sawFirstItem = false;
  let sawFirstSurface = false;

  events.forEach((event, index) => {
    const cursor = index + 1;
    const base = { cursor, t: event.t, time: formatEventTime(event.t) };

    if (event.type === 'item.add' && !sawFirstItem) {
      sawFirstItem = true;
      moments.push({
        id: `first-item-${index}`,
        kind: 'first-item',
        label: `第一件摆件（${eventLabel('item.add')}）`,
        ...base,
      });
      return;
    }

    if (event.type === 'surface.stroke' && !sawFirstSurface) {
      sawFirstSurface = true;
      moments.push({
        id: `first-surface-${index}`,
        kind: 'first-surface',
        label: '第一次整理沙面',
        ...base,
      });
      return;
    }

    if (event.type === 'scene.change') {
      const sceneId = typeof event.payload?.sceneId === 'string' ? event.payload.sceneId : '';
      moments.push({
        id: `scene-${index}`,
        kind: 'scene-change',
        label: sceneId ? `换到「${sceneLabel(sceneId)}」` : '换场景',
        ...base,
      });
    }
  });

  return moments;
}

/** 会话级关键节点（场景名用 sessions 里的 sceneId 直接显示，不做映射时回退 id） */
export function sessionKeyMoments(
  session: SandSession,
  sceneLabel: (sceneId: string) => string,
): KeyMoment[] {
  return findKeyMoments(session.events ?? [], { sceneLabel });
}

/**
 * 在事件流里为某个 `eventIndex` 找到最接近的可用跳转位置。
 * 批注可能指向超出范围的事件序号（历史数据/边界），这里夹到 [0, length]。
 */
export function clampCursor(cursor: number, eventCount: number): number {
  if (!Number.isFinite(cursor)) return 0;
  return Math.max(0, Math.min(Math.round(cursor), Math.max(0, eventCount)));
}

/**
 * 当前 cursor 落在哪一条事件之后（用于「当前这一步」的描述）。
 * cursor = 0 时返回 null（还没有任何操作）。
 */
export function describeCursor(
  events: SandboxEvent[],
  cursor: number,
  sceneLabel: (sceneId: string) => string,
): string {
  if (cursor <= 0 || events.length === 0) return '开头（还没有操作）';
  const index = Math.min(cursor, events.length) - 1;
  const event = events[index];
  if (!event) return '开头（还没有操作）';
  const label = eventLabel(event.type);
  const time = formatEventTime(event.t);
  if (event.type === 'scene.change') {
    const sceneId = typeof event.payload?.sceneId === 'string' ? event.payload.sceneId : '';
    return `第 ${index + 1} 步 · ${time} · 换到「${sceneLabel(sceneId)}」`;
  }
  return `第 ${index + 1} 步 · ${time} · ${label}`;
}
