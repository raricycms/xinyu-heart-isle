/**
 * 心屿 · 会话续接的 URL 参数约定（纯函数，可单测）
 *
 * ## 约定（SandboxPage 侧读取，Lead 集成时依赖）
 *
 * ```
 * /sandbox?from=<sessionId>&cursor=<N>
 * ```
 *
 * - `from`：要续接的源会话 id（必填）。**只读**，绝不修改原会话。
 * - `cursor`：续接到第几步（0 ~ 源会话事件数），省略时 = 源会话末尾。
 *   语义与回放页完全一致：`replay(events, cursor)` 就是新会话的初始画面。
 * - 兼容别名：`step`（等价于 `cursor`）。
 *
 * 语义要点：
 * 1. 复制源会话**前 cursor 条事件**到新会话；新会话换新 id、新 `at`，
 *    事件内容原样保留（含沙面 before/after 快照），因此新会话可独立回放；
 * 2. 新会话 `annotations` 只保留 `eventIndex < cursor` 的那些；
 * 3. 原会话一个字段都不改（不调 `saveSession(源会话)`）。
 *
 * 本文件只做「解析与构造 URL」+「复制会话」，不做任何存储写入，
 * 便于 SandboxPage 与回放页共用同一套约定。
 */

import type { SandSession } from '@/lib/types';

/** 续接参数（从 URL query string 解析而来） */
export interface ResumeParams {
  /** 源会话 id */
  from: string;
  /** 续接到第几步；null 表示未指定（= 末尾） */
  cursor: number | null;
}

/**
 * 从 `URLSearchParams`（或任意可迭代的 [k, v] 对）里解析续接参数。
 *
 * 返回 `null` 表示不是一个续接请求（没有 `from`）。
 * `cursor` 非法（NaN / 负数 / 非整数）时按「未指定」处理，由调用方夹取。
 */
export function parseResumeParams(
  params: URLSearchParams | Iterable<[string, string]> | null | undefined,
): ResumeParams | null {
  if (!params) return null;
  let target: URLSearchParams;
  if (params instanceof URLSearchParams) {
    target = params;
  } else {
    target = new URLSearchParams();
    for (const [key, value] of params) target.append(key, value);
  }

  const from = (target.get('from') ?? '').trim();
  if (from.length === 0) return null;

  // `cursor` 优先，`step` 为兼容别名
  const raw = target.get('cursor') ?? target.get('step');
  const cursor = parseStep(raw);
  return { from, cursor };
}

/** 解析步数；非法值返回 null */
export function parseStep(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  if (rounded < 0) return null;
  return rounded;
}

/** 构造续接链接，例如 `/sandbox?from=session_abc&cursor=12` */
export function buildResumeHref(sessionId: string, cursor?: number): string {
  const base = `/sandbox?from=${encodeURIComponent(sessionId)}`;
  if (cursor === undefined) return base;
  return `${base}&cursor=${Math.max(0, Math.floor(cursor))}`;
}

/**
 * 从源会话复制出「续接到第 cursor 步」的新会话。
 *
 * - 不改源会话（返回全新对象，事件数组也重新拷贝）
 * - `cursor` 会夹到 `[0, events.length]`
 * - 新会话：新 id / 新 at / 解锁 / 未归档 / 保留标题但标注来源
 * - `items` 由调用方（SandboxPage）用 `replay(events, cursor)` 算出，
 *   这里用同步的纯函数算，保证「复制出来的会话」自洽
 */
export function forkSessionAt(
  session: SandSession,
  cursor: number,
  options: {
    newId: string;
    now: string;
    replayItems: SandSession['items'];
    sceneId?: string;
    surface?: SandSession['surface'];
  },
): SandSession {
  const total = session.events?.length ?? 0;
  const clamped = Math.max(0, Math.min(Math.floor(cursor), total));
  const events = (session.events ?? []).slice(0, clamped).map((event) => ({
    ...event,
    payload: event.payload ? { ...event.payload } : undefined,
  }));

  const annotations = (session.annotations ?? [])
    .filter((annotation) => annotation.eventIndex >= 0 && annotation.eventIndex < clamped)
    .map((annotation) => ({ ...annotation }));

  return {
    ...session,
    id: options.newId,
    at: options.now,
    schemaVersion: 2,
    title: session.title,
    sceneId: options.sceneId ?? session.sceneId,
    items: options.replayItems.map((item) => ({ ...item })),
    events,
    surface: options.surface,
    locked: false,
    lockedAt: undefined,
    archived: false,
    archivedAt: undefined,
    endedAt: undefined,
    annotations,
    meta: session.meta ? { ...session.meta } : undefined,
  };
}

/**
 * 给续接画面用的说明文案（回放页展示，明确「不会改动原会话」）。
 * 纯函数便于单测文案里的关键数字。
 */
export function resumeHintText(cursor: number, total: number): string {
  const step = Math.max(0, Math.min(cursor, total));
  return `会复制这次会话到第 ${step} 步（共 ${total} 步），作为新会话继续。原来的这次不会被改动。`;
}
