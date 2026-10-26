/**
 * 心屿 · 数据模型迁移
 *
 * 版本策略（VISION.md §6.2）：
 * | 版本 | 数据 | 兼容 |
 * | v1.1 | SandboxSnapshot + schemaVersion:1 | 读旧数据 |
 * | v2.0 | SandSession + events，导入时自动迁移 | v1 快照可读、可回放（只有一次 session.import） |
 *
 * 本文件是**唯一**做版本升级的地方。任何老数据进入系统都必须先过 `migrateSnapshot`。
 */

import type { SandboxItem, SandboxSnapshot, SandSession, SandboxEvent } from '@/lib/types';
import { makeEvent } from '@/sandbox/events';

/** v1 快照的宽松形状（历史数据可能缺字段） */
export interface LegacySnapshot {
  id?: unknown;
  at?: unknown;
  title?: unknown;
  items?: unknown;
  sceneId?: unknown;
  reflection?: unknown;
  prompts?: unknown;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 宽松归一化摆件：容忍历史数据里的缺字段 / 越界值 */
export function normalizeItem(raw: unknown, index: number): SandboxItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = str(item.id) || `item_legacy_${index}`;
  const symbolId = str(item.symbolId);
  if (!symbolId) return null;
  return {
    id,
    symbolId,
    x: clamp01(numOr(item.x, 0.5)),
    y: clamp01(numOr(item.y, 0.5)),
    scale: Math.min(4, Math.max(0.2, numOr(item.scale, 1))),
    rotation: numOr(item.rotation, 0),
    z: Math.round(numOr(item.z, index + 1)),
    ...(typeof item.note === 'string' && item.note ? { note: item.note } : {}),
    ...(Array.isArray(item.affectLabels)
      ? { affectLabels: item.affectLabels.filter((v): v is string => typeof v === 'string') }
      : {}),
    ...(typeof item.audioNote === 'string' ? { audioNote: item.audioNote } : {}),
    ...(typeof item.imageData === 'string' ? { imageData: item.imageData } : {}),
    ...(typeof item.burial === 'number' && Number.isFinite(item.burial)
      ? { burial: Math.min(1, Math.max(0, item.burial)) }
      : {}),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * v1 `SandboxSnapshot` -> v2 `SandSession`。
 *
 * 迁移策略（与 VISION.md §6.1 一致）：
 * - 补一条 `session.start`；
 * - 每个摆件补一条 `item.add`（t 递增），这样「重放 = 当前状态」仍然成立；
 * - 再补一条 `session.import` 标记来源；
 * - `surface` 为空（v1 没有沙面数据）。
 */
export function migrateSnapshot(legacy: LegacySnapshot): SandSession {
  const items: SandboxItem[] = Array.isArray(legacy.items)
    ? legacy.items
        .map((raw, index) => normalizeItem(raw, index))
        .filter((item): item is SandboxItem => item !== null)
    : [];

  const at = typeof legacy.at === 'string' && !Number.isNaN(Date.parse(legacy.at))
    ? legacy.at
    : new Date().toISOString();
  const sceneId = str(legacy.sceneId) || 'beach';

  const events: SandboxEvent[] = [];
  events.push(makeEvent(events, 'session.start', { kind: 'session.start', sceneId, mode: 'self' }, undefined, 0));
  items.forEach((item, index) => {
    events.push(
      makeEvent(events, 'item.add', { kind: 'item.add', item }, item.id, (index + 1) * 1000),
    );
  });
  events.push(
    makeEvent(
      events,
      'session.import',
      { kind: 'session.import', from: 'sandbox-snapshot/v1' },
      undefined,
      (items.length + 1) * 1000,
    ),
  );

  const reflection = typeof legacy.reflection === 'string' && legacy.reflection.trim()
    ? legacy.reflection
    : undefined;

  if (reflection) {
    events.push(
      makeEvent(
        events,
        'reflection.edit',
        { kind: 'reflection.edit', text: reflection },
        undefined,
        (items.length + 2) * 1000,
      ),
    );
  }

  return {
    schemaVersion: 2,
    id: str(legacy.id) || `session_migrated_${Date.now()}`,
    at,
    title: str(legacy.title) || '未命名沙盘',
    mode: 'self',
    sceneId,
    items,
    events,
    reflection,
    prompts: Array.isArray(legacy.prompts)
      ? legacy.prompts.filter((v): v is string => typeof v === 'string')
      : undefined,
    locked: false,
    meta: { phase: 'record', sessionNo: 1 },
  };
}

/**
 * 把任意来源的数据升级为 `SandSession`。
 * 接受的输入：
 * - 已是 v2 的 `SandSession`（原样返回，补齐缺失字段）
 * - v1 `SandboxSnapshot`（走迁移）
 */
export function coerceSession(input: unknown): SandSession | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  // 已经是 v2
  if (raw.schemaVersion === 2 || (Array.isArray(raw.events) && typeof raw.mode === 'string')) {
    const items = Array.isArray(raw.items)
      ? raw.items
          .map((item, index) => normalizeItem(item, index))
          .filter((item): item is SandboxItem => item !== null)
      : [];
    const events = Array.isArray(raw.events)
      ? raw.events.filter(
          (event): event is SandboxEvent =>
            !!event && typeof event === 'object' && typeof (event as SandboxEvent).t === 'number',
        )
      : [];
    return {
      schemaVersion: 2,
      id: str(raw.id) || `session_${Date.now()}`,
      at: str(raw.at) || new Date().toISOString(),
      title: str(raw.title) || '未命名沙盘',
      endedAt: typeof raw.endedAt === 'string' ? raw.endedAt : undefined,
      mode: (raw.mode === 'counselor' || raw.mode === 'supervision' ? raw.mode : 'self'),
      sceneId: str(raw.sceneId) || 'beach',
      items,
      events,
      surface:
        raw.surface && typeof raw.surface === 'object'
          ? (raw.surface as SandSession['surface'])
          : undefined,
      reflection: typeof raw.reflection === 'string' ? raw.reflection : undefined,
      prompts: Array.isArray(raw.prompts)
        ? raw.prompts.filter((v): v is string => typeof v === 'string')
        : undefined,
      locked: raw.locked === true,
      lockedAt: typeof raw.lockedAt === 'string' ? raw.lockedAt : undefined,
      meta: raw.meta && typeof raw.meta === 'object' ? (raw.meta as SandSession['meta']) : undefined,
      annotations: Array.isArray(raw.annotations)
        ? (raw.annotations as SandSession['annotations'])
        : undefined,
      archived: raw.archived === true,
      archivedAt: typeof raw.archivedAt === 'string' ? raw.archivedAt : undefined,
      thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : undefined,
    };
  }

  // v1 快照
  if (Array.isArray(raw.items)) {
    return migrateSnapshot(raw as LegacySnapshot);
  }

  return null;
}

/** 判断一条 localStorage 数据是 v1 还是 v2（用于导出/导入分流） */
export function isLegacySnapshot(value: unknown): value is SandboxSnapshot {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return raw.schemaVersion !== 2 && Array.isArray(raw.items) && !Array.isArray(raw.events);
}
