/**
 * 心屿 · 档案与会话的绑定关系
 *
 * 一个「本地档案」（`LocalClient`）与沙盘会话之间只有一条弱引用：
 * `session.meta.clientRef === client.id`。用引用而不是把会话塞进档案，
 * 是为了让同一份数据只存在一处（CONTRACT §3.3：业务只走 sessionStore）。
 *
 * 设计约束：
 * 1. **纯函数优先**：所有查询/改写都能脱离浏览器存储做单测；
 * 2. **只呈现事实**：`clientSummary` 只统计次与日期，不产生任何评价；
 * 3. **化名**：本模块不接触、不校验真实身份信息，只有 `alias`。
 */

import type { LocalClient, SandSession } from '@/lib/types';
import { getSession, isArchived, saveSession } from '@/lib/sessionStore';

/** 某档案的会话统计（全部为客观事实） */
export interface ClientSummary {
  /** 未归档会话数 */
  sessionCount: number;
  /** 已归档会话数 */
  archivedCount: number;
  /** 最早一次会话时间（ISO）；没有会话时为 null */
  firstAt: string | null;
  /** 最近一次会话时间（ISO）；没有会话时为 null */
  lastAt: string | null;
}

/** 空统计（供空状态与单测复用；每次返回新对象，避免调用方误改缓存） */
export function emptySummary(): ClientSummary {
  return { sessionCount: 0, archivedCount: 0, firstAt: null, lastAt: null };
}

/** 会话绑定的档案 id（未绑定返回 undefined） */
export function boundClientId(session: SandSession): string | undefined {
  const ref = session.meta?.clientRef;
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined;
}

/** 是否未绑定任何档案 */
export function isUnbound(session: SandSession): boolean {
  return boundClientId(session) === undefined;
}

/** 某档案下的会话，按时间倒序。`includeArchived` 为 false 时排除已归档。 */
export function sessionsOfClient(
  sessions: SandSession[],
  clientId: string,
  includeArchived = true,
): SandSession[] {
  return sessions
    .filter((session) => session.meta?.clientRef === clientId)
    .filter((session) => (includeArchived ? true : !isArchived(session)))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** 所有未绑定档案的会话（按时间倒序）；档案详情页的「可关联会话」入口用 */
export function unboundSessions(sessions: SandSession[]): SandSession[] {
  return sessions.filter(isUnbound).sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * 统计某档案的会话。
 *
 * `clients` 用于确认档案存在：档案已被删除时返回空统计，
 * 避免"幽灵档案"在列表里显示一个查不到来源的次数。
 */
export function clientSummary(
  clients: LocalClient[],
  sessions: SandSession[],
  clientId: string,
): ClientSummary {
  if (!clients.some((client) => client.id === clientId)) return emptySummary();

  const mine = sessions.filter((session) => session.meta?.clientRef === clientId);
  if (mine.length === 0) return emptySummary();

  const sorted = [...mine].sort((a, b) => a.at.localeCompare(b.at));
  const archivedCount = mine.filter(isArchived).length;

  return {
    sessionCount: mine.length - archivedCount,
    archivedCount,
    firstAt: sorted[0].at,
    lastAt: sorted[sorted.length - 1].at,
  };
}

/** 批量统计（列表页一次算完，避免 O(n×m) 的重复 filter） */
export function clientSummaries(
  clients: LocalClient[],
  sessions: SandSession[],
): Map<string, ClientSummary> {
  const bucket = new Map<string, SandSession[]>();
  for (const session of sessions) {
    const ref = session.meta?.clientRef;
    if (!ref) continue;
    const list = bucket.get(ref);
    if (list) list.push(session);
    else bucket.set(ref, [session]);
  }

  const result = new Map<string, ClientSummary>();
  for (const client of clients) {
    const mine = bucket.get(client.id);
    if (!mine || mine.length === 0) {
      result.set(client.id, emptySummary());
      continue;
    }
    const sorted = [...mine].sort((a, b) => a.at.localeCompare(b.at));
    const archivedCount = mine.filter(isArchived).length;
    result.set(client.id, {
      sessionCount: mine.length - archivedCount,
      archivedCount,
      firstAt: sorted[0].at,
      lastAt: sorted[sorted.length - 1].at,
    });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/*                                  纯改写                                     */
/* -------------------------------------------------------------------------- */

/**
 * 返回一份把 `clientRef` 设为 `clientId`（或清除）的新会话。
 * 不改原对象：`useSessions()` 返回的是不可变快照（CONTRACT §3.2）。
 */
export function withClientRef(session: SandSession, clientId: string | null): SandSession {
  const meta = { ...(session.meta ?? {}) };
  if (clientId) {
    meta.clientRef = clientId;
    // 绑定档案时顺手补上化名，便于脱离档案也能看出是谁（仍然只是化名）
    return { ...session, meta };
  }
  delete meta.clientRef;
  const hasOtherFields = Object.keys(meta).length > 0;
  return { ...session, meta: hasOtherFields ? meta : undefined };
}

/** 把化名同步进 meta.alias（导出单会话时不丢上下文） */
export function withClientAlias(session: SandSession, alias: string | null): SandSession {
  const meta = { ...(session.meta ?? {}) };
  if (alias) meta.alias = alias;
  else delete meta.alias;
  return { ...session, meta: Object.keys(meta).length > 0 ? meta : undefined };
}

/** 归档开关的纯函数版本（单测直接覆盖，不依赖存储） */
export function withArchived(session: SandSession, archived: boolean, now = new Date().toISOString()): SandSession {
  if (archived) {
    if (session.archived === true) return session;
    return { ...session, archived: true, archivedAt: now };
  }
  if (session.archived !== true && session.archivedAt === undefined) return session;
  const { archived: _archived, archivedAt: _archivedAt, ...rest } = session;
  void _archived;
  void _archivedAt;
  return rest as SandSession;
}

/* -------------------------------------------------------------------------- */
/*                            写入（经 sessionStore）                           */
/* -------------------------------------------------------------------------- */

/**
 * 把一次会话绑定到某档案。
 * 返回更新后的会话；会话不存在时返回 null（不抛错，便于 UI 提示）。
 */
export function attachSessionToClient(
  sessionId: string,
  clientId: string,
  alias?: string,
): SandSession | null {
  const session = getSession(sessionId);
  if (!session) return null;
  const bound = withClientAlias(withClientRef(session, clientId), alias ?? null);
  saveSession(bound);
  return bound;
}

/** 解除绑定（回到「未绑定会话」）。 */
export function detachSession(sessionId: string): SandSession | null {
  const session = getSession(sessionId);
  if (!session) return null;
  const detached = withClientRef(session, null);
  saveSession(detached);
  return detached;
}

/** 批量绑定；返回成功条数 */
export function attachSessionsToClient(
  sessionIds: string[],
  clientId: string,
  alias?: string,
): number {
  let count = 0;
  for (const id of sessionIds) {
    if (attachSessionToClient(id, clientId, alias)) count += 1;
  }
  return count;
}
