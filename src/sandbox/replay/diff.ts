/**
 * 心屿 · 会话差异清单（纯函数，可单测）
 *
 * **只算事实差分，不给结论。** 每一项都能被两次会话的数字直接验证：
 * 摆件数、沙具种类的新增/消失、场景是否变化、时长差、沙面改动比例差。
 *
 * 明确禁止在此文件出现：进步 / 退步 / 改善 / 恶化 / 健康度 / 趋势 / 说明 / 意味着。
 * 文案里只有「增加 / 减少 / 未变 / 变化 / 相同」这类中性描述。
 */

import type { SandSession } from '@/lib/types';
import { getScene } from '@/sandbox/scenes';
import { symbolLabel } from '@/sandbox/symbols';
import { computeSessionStats, type SessionStatsData } from '@/sandbox/replay/stats';

/** 一条事实差异 */
export interface FactDiff {
  /** 稳定 key，用于 React 列表 */
  key: string;
  /** 事实名称，例如「摆件数」 */
  label: string;
  /** 前一次的展示值 */
  before: string;
  /** 后一次的展示值 */
  after: string;
  /** 差值的展示形式，例如「+2」「-1」「0」「换到「夜晚」」 */
  change: string;
  /** 变化方向，仅用于着色；`same` 表示无变化 */
  direction: 'up' | 'down' | 'same';
}

export interface SessionDiff {
  before: SandSession;
  after: SandSession;
  facts: FactDiff[];
  /** 新增的沙具种类标签（按名称排序） */
  addedSymbols: string[];
  /** 消失的沙具种类标签（按名称排序） */
  removedSymbols: string[];
}

function signed(value: number, unit = ''): { text: string; direction: FactDiff['direction'] } {
  if (value === 0) return { text: `0${unit}`, direction: 'same' };
  const sign = value > 0 ? '+' : '';
  return { text: `${sign}${value}${unit}`, direction: value > 0 ? 'up' : 'down' };
}

function formatMinutes(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 计算两次会话之间的事实差异。
 *
 * 约定 `before` 是时间上更早的一次，`after` 是更晚的一次（调用方负责排序）。
 * 差异清单的顺序固定：数量 → 种类 → 场景 → 时长 → 沙面，便于逐次对照。
 */
export function diffSessions(
  before: SandSession,
  after: SandSession,
  stats?: { before?: SessionStatsData; after?: SessionStatsData },
): SessionDiff {
  const beforeStats = stats?.before ?? computeSessionStats(before);
  const afterStats = stats?.after ?? computeSessionStats(after);
  const facts: FactDiff[] = [];

  // 1. 摆件数
  const itemDelta = signed(afterStats.itemCount - beforeStats.itemCount);
  facts.push({
    key: 'itemCount',
    label: '摆件数',
    before: String(beforeStats.itemCount),
    after: String(afterStats.itemCount),
    change: itemDelta.text,
    direction: itemDelta.direction,
  });

  // 2. 操作次数
  const eventDelta = signed(afterStats.eventCount - beforeStats.eventCount);
  facts.push({
    key: 'eventCount',
    label: '操作次数',
    before: String(beforeStats.eventCount),
    after: String(afterStats.eventCount),
    change: eventDelta.text,
    direction: eventDelta.direction,
  });

  // 3. 沙具种类（只比种类，不比「好坏」）
  const beforeSymbols = new Set(beforeStats.symbolCounts.map((entry) => entry.symbolId));
  const afterSymbols = new Set(afterStats.symbolCounts.map((entry) => entry.symbolId));
  const addedIds = [...afterSymbols].filter((id) => !beforeSymbols.has(id));
  const removedIds = [...beforeSymbols].filter((id) => !afterSymbols.has(id));
  const addedSymbols = addedIds.map((id) => symbolLabel(id)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const removedSymbols = removedIds
    .map((id) => symbolLabel(id))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));

  facts.push({
    key: 'symbolKinds',
    label: '沙具种类',
    before: `${beforeSymbols.size} 种`,
    after: `${afterSymbols.size} 种`,
    change: `${signed(afterSymbols.size - beforeSymbols.size).text} 种`,
    direction: signed(afterSymbols.size - beforeSymbols.size).direction,
  });

  if (addedSymbols.length > 0) {
    facts.push({
      key: 'symbolsAdded',
      label: '新增种类',
      before: '—',
      after: addedSymbols.join('、'),
      change: `${addedSymbols.length} 种`,
      direction: 'same',
    });
  }
  if (removedSymbols.length > 0) {
    facts.push({
      key: 'symbolsRemoved',
      label: '消失种类',
      before: removedSymbols.join('、'),
      after: '—',
      change: `${removedSymbols.length} 种`,
      direction: 'same',
    });
  }

  // 4. 场景（用会话最终 sceneId，不做推测）
  const beforeScene = getScene(before.sceneId);
  const afterScene = getScene(after.sceneId);
  const sceneChanged = before.sceneId !== after.sceneId;
  facts.push({
    key: 'scene',
    label: '场景',
    before: beforeScene.label,
    after: afterScene.label,
    change: sceneChanged ? '换场景' : '相同',
    direction: 'same',
  });

  // 5. 时长
  const durationDeltaMs = afterStats.durationMs - beforeStats.durationMs;
  const durationDelta = signed(Math.round(durationDeltaMs / 1000), ' 秒');
  facts.push({
    key: 'duration',
    label: '时长',
    before: formatMinutes(beforeStats.durationMs),
    after: formatMinutes(afterStats.durationMs),
    change: durationDelta.text,
    direction: durationDelta.direction,
  });

  // 6. 沙面改动比例（百分比差，取整到 1 个百分点）
  const movedDelta = Math.round((afterStats.surfaceMovedRatio - beforeStats.surfaceMovedRatio) * 100);
  const movedSigned = signed(movedDelta, ' 个百分点');
  facts.push({
    key: 'surfaceMoved',
    label: '沙面改动比例',
    before: `${Math.round(beforeStats.surfaceMovedRatio * 100)}%`,
    after: `${Math.round(afterStats.surfaceMovedRatio * 100)}%`,
    change: movedSigned.text,
    direction: movedSigned.direction,
  });

  return { before, after, facts, addedSymbols, removedSymbols };
}

/** 生成一段只含事实的差异标题，例如「10月20日 → 10月26日」 */
export function diffCaption(before: SandSession, after: SandSession): string {
  return `${shortDate(before.at)} → ${shortDate(after.at)}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
