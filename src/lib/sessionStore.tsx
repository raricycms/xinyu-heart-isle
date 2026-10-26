/**
 * 心屿 · 会话与档案存储（v2）
 *
 * 这一层把「localStorage 镜像」与「IndexedDB 主存」缝在一起，业务代码只调本文件。
 *
 * 存储策略（为什么两套）：
 * - localStorage：**会话本体镜像**。同步读取、跨标签页同步、无异步心智负担，
 *   也保证「导出全部」与「隐私模式下仍可用」；单会话 JSON 约 20~60KB，容量可控。
 * - IndexedDB：**二进制与大数据**（缩略图、录音、自定义图），localStorage 放不下也放不优雅。
 *
 * 一致性：写会话时同步写 localStorage，并异步尽力写 IndexedDB；
 * IndexedDB 失败不影响主流程（已降级为「只有镜像」）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  STORAGE_KEYS,
  clientStore,
  sessionStore,
  readJSON,
  useCollection,
  writeJSON,
} from '@/lib/storage';
import type { LocalClient, RetentionDays, SandSession } from '@/lib/types';
import { coerceSession, isLegacySnapshot } from '@/format/migrate';
import {
  idbDeleteSession,
  idbGetSession,
  idbPutSession,
  idbAvailable,
  refreshIdbCache,
  subscribeIdb,
} from '@/lib/idb';

/* -------------------------------------------------------------------------- */
/*                                 读取与查询                                  */
/* -------------------------------------------------------------------------- */

/** 是否已归档（显式标记或已锁定且超过保留期） */
export function isArchived(session: SandSession): boolean {
  return session.archived === true;
}

/** 是否可编辑（封盘后不可改，只能另存副本） */
export function isEditable(session: SandSession | null | undefined): boolean {
  return !session || session.locked !== true;
}

/** 按时间倒序的会话列表（含旧数据自动迁移） */
export function listSessions(): SandSession[] {
  const raw = readJSON<unknown[]>(STORAGE_KEYS.sessions, []);
  const sessions = Array.isArray(raw)
    ? raw.map((entry) => coerceSession(entry)).filter((s): s is SandSession => s !== null)
    : [];
  const legacy = readJSON<unknown[]>(STORAGE_KEYS.sandbox, []);
  if (Array.isArray(legacy) && legacy.length > 0) {
    for (const entry of legacy) {
      if (isLegacySnapshot(entry)) {
        const migrated = coerceSession(entry);
        if (migrated && !sessions.some((s) => s.id === migrated.id)) sessions.push(migrated);
      }
    }
  }
  return sessions.sort((a, b) => b.at.localeCompare(a.at));
}

export function getSession(id: string): SandSession | null {
  return listSessions().find((session) => session.id === id) ?? null;
}

/** 过滤：默认排除归档 */
export function filterSessions(
  sessions: SandSession[],
  options: { includeArchived?: boolean; clientRef?: string; mode?: string } = {},
): SandSession[] {
  return sessions.filter((session) => {
    if (!options.includeArchived && isArchived(session)) return false;
    if (options.clientRef && session.meta?.clientRef !== options.clientRef) return false;
    if (options.mode && session.mode !== options.mode) return false;
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/*                                   写入                                      */
/* -------------------------------------------------------------------------- */

/**
 * 保存会话（覆盖写）。返回是否写入 localStorage 成功。
 *
 * **必须透传 `upsert` 的结果**：曾经这里无条件 `return true`，
 * 于是配额满 / 隐私模式下写入失败时，页面照样弹「沙盘已保存在这台设备上」，
 * 用户刷新后数据没了 —— 这是比保存失败更糟的一类 bug（静默丢数据）。
 * 页面侧的 `if (!ok)` 分支就是为此存在，不能被一个假的 `true` 短路。
 */
export function saveSession(session: SandSession): boolean {
  const ok = sessionStore.upsert(session);
  // 异步尽力写 IndexedDB（缩略图/附件走这里）。失败不影响 localStorage 的结论，
  // 因为 localStorage 才是「已保存」的判据，IndexedDB 只是附件镜像。
  void idbPutSession(session);
  return ok;
}

export function removeSession(id: string): void {
  sessionStore.remove(id);
  void idbDeleteSession(id);
}

export function clearSessions(): void {
  sessionStore.clear();
}

/** 从 IndexedDB 异步读取（镜像缺失时的兜底，例如清过 localStorage） */
export async function loadSessionFromIdb(id: string): Promise<SandSession | null> {
  const fromIdb = await idbGetSession(id);
  if (!fromIdb) return null;
  const coerced = coerceSession(fromIdb);
  if (coerced) saveSession(coerced);
  return coerced;
}

/* -------------------------------------------------------------------------- */
/*                                   归档                                      */
/* -------------------------------------------------------------------------- */

/** 归档（拆除阶段的产品化：归档而非删除） */
export function archiveSession(id: string): void {
  const session = getSession(id);
  if (!session) return;
  saveSession({
    ...session,
    archived: true,
    archivedAt: new Date().toISOString(),
  });
}

/** 取消归档 */
export function unarchiveSession(id: string): void {
  const session = getSession(id);
  if (!session) return;
  const { archived: _archived, archivedAt: _archivedAt, ...rest } = session;
  void _archived;
  void _archivedAt;
  saveSession(rest as SandSession);
}

/**
 * 按保留期清理归档会话。
 * `retentionDays === 0` 表示永久保留，不清理。
 * 返回被清理的会话 id 列表（用于 UI 提示「已清理 N 个」）。
 */
export function purgeExpired(retentionDays: RetentionDays, now = Date.now()): string[] {
  if (!retentionDays) return [];
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const session of listSessions()) {
    if (!isArchived(session)) continue;
    const stamp = session.archivedAt ?? session.endedAt ?? session.at;
    const time = Date.parse(stamp);
    if (Number.isFinite(time) && time < cutoff) {
      removeSession(session.id);
      removed.push(session.id);
    }
  }
  return removed;
}

/* -------------------------------------------------------------------------- */
/*                                   档案                                      */
/* -------------------------------------------------------------------------- */

export const localClientStore = clientStore;

export function listClients(): LocalClient[] {
  return clientStore.getAll();
}

/**
 * 保存本地档案（覆盖写）。返回是否写入成功。
 *
 * 与 `saveSession` 同理：导入备份时若配额满，不能「调用了就当成功」，
 * 否则用户看到「导入 50 个档案」但库里一条都没有。
 */
export function saveClient(client: LocalClient): boolean {
  return clientStore.upsert(client);
}

export function removeClient(id: string): void {
  clientStore.remove(id);
}

/** 统计某档案下的会话数（不含归档） */
export function countSessionsOfClient(sessions: SandSession[], clientId: string): number {
  return sessions.filter((s) => s.meta?.clientRef === clientId && !isArchived(s)).length;
}

/* -------------------------------------------------------------------------- */
/*                               React 订阅钩子                                */
/* -------------------------------------------------------------------------- */

/**
 * 订阅会话集合。
 *
 * 与 `useCollection` 的区别：会做**迁移与排序**，且额外合并 v1 旧快照。
 * 返回值是全站唯一的会话视图来源。
 */
export function useSessions(): SandSession[] {
  const raw = useCollection<SandSession>(STORAGE_KEYS.sessions);
  const legacy = useCollection<SandSession>(STORAGE_KEYS.sandbox);
  // 用长度做廉价依赖，避免每次渲染都全量迁移
  return useMemo(() => listSessions(), [raw, legacy]);
}

export function useClients(): LocalClient[] {
  const raw = useCollection<LocalClient>(STORAGE_KEYS.clients);
  return useMemo(() => {
    void raw;
    return listClients();
  }, [raw]);
}

/** IndexedDB 是否可用（异步探测；SSR 安全） */
export function useIdbAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void idbAvailable().then((value) => {
      if (alive) setAvailable(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return available;
}

/** 订阅 IndexedDB 变化（导入 / 清空后触发重载） */
export function useIdbSubscription(onChange: () => void): void {
  const handler = useCallback(() => onChange(), [onChange]);
  useEffect(() => subscribeIdb(handler), [handler]);
}

/* -------------------------------------------------------------------------- */
/*                              导入导出（会话级）                              */
/* -------------------------------------------------------------------------- */

/** 把 v1 旧快照全部迁移为 v2 会话并落盘（幂等） */
export function migrateLegacySnapshots(): { migrated: number } {
  const legacyRaw = readJSON<unknown[]>(STORAGE_KEYS.sandbox, []);
  if (!Array.isArray(legacyRaw) || legacyRaw.length === 0) return { migrated: 0 };
  const existing = readJSON<unknown[]>(STORAGE_KEYS.sessions, []);
  const existingIds = new Set(
    (Array.isArray(existing) ? existing : [])
      .map((entry) => (entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === 'string'),
  );

  let migrated = 0;
  const next = Array.isArray(existing) ? [...existing] : [];
  for (const entry of legacyRaw) {
    if (!isLegacySnapshot(entry)) continue;
    const session = coerceSession(entry);
    if (!session || existingIds.has(session.id)) continue;
    next.push(session);
    existingIds.add(session.id);
    migrated += 1;
  }
  if (migrated > 0) {
    writeJSON(STORAGE_KEYS.sessions, next);
    // 迁移后清空旧键，避免重复迁移与容量浪费
    writeJSON(STORAGE_KEYS.sandbox, []);
    refreshIdbCache();
  }
  return { migrated };
}
