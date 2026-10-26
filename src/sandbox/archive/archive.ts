/**
 * 心屿 · 全量档案导出 / 导入（`xinyu-archive/v1`）
 *
 * 为什么需要这一层：
 * 单个 `.sandplay.json` 是**一次会话**的对外格式（`sandplay-session/v1`，见 FORMAT.md）。
 * 但"把整台设备上的档案带走"需要一次拿到「多条会话 + 多个档案」以及它们之间的绑定关系，
 * 于是外面再包一层 envelope。envelope 本身**不重新定义会话结构**，
 * 内层仍然逐条是合法的 `sandplay-session/v1` 文件——这样：
 * - 第三方只需要支持 `sandplay-session/v1` 就能读懂里面每一条；
 * - 本项目的校验器/CLI 可以原样复用；
 * - 单个会话文件与全量档案文件可以互相升级/降级，不需要第二套解析逻辑。
 *
 * 红线（CONTRACT §5）：
 * - 不包含任何可识别身份字段（档案只有 `alias`，字段名命中 `sandplay.ts` 的黑名单即报错）；
 * - 导出前 UI 必须让用户勾选「已取得同意」；
 * - 导入**只写用户自己的浏览器**，全程无网络。
 */

import type { LocalClient, SandSession } from '@/lib/types';
import type { SandplayFile } from '@/format/sandplay';
import {
  SANDPAY_FORMAT,
  fromSandplayFile,
  toSandplayFile,
  validateSandplayFile,
} from '@/format/sandplay';
import { coerceSession } from '@/format/migrate';
import type { ExportOptions } from '@/format/sandplay';
import { DEFAULT_EXPORT_OPTIONS } from '@/format/sandplay';
import { saveClient, saveSession } from '@/lib/sessionStore';

/** envelope 格式标识 */
export const XINYU_ARCHIVE_FORMAT = 'xinyu-archive/v1' as const;

/** 生产者标识（与 `sandplay.ts` 保持一致的 app 名） */
const PRODUCER = { app: '心屿 Xinyu', version: '2.0.0' } as const;

/**
 * envelope 里的档案条目。
 *
 * 与内部 `LocalClient` 的差异：
 * - `createdAt` 取代内部 `at`（导出文件统一用可读字段名，且与 `session.createdAt` 对齐）；
 * - 不导出任何本机专属字段（目前 `LocalClient` 也没有）。
 */
export interface ArchiveClientRecord {
  /** 本机档案 id；导入时尽量保留，以便会话的 `meta.clientRef` 继续指得上 */
  id: string;
  /** 化名 / 代号 —— 唯一的身份标识，永远不是真实姓名 */
  alias: string;
  /** 咨询师自己的备注（可选） */
  note?: string;
  /** 是否已归档 */
  archived?: boolean;
  /** 颜色标记（纯展示，无语义） */
  color?: string;
  /** 建档时间（ISO 8601） */
  createdAt: string;
}

/** 全量档案文件结构 */
export interface XinyuArchiveEnvelope {
  format: typeof XINYU_ARCHIVE_FORMAT;
  /** envelope 结构版本（本文件为 1） */
  version: 1;
  /** 导出时刻（ISO 8601） */
  exportedAt: string;
  producer: { app: string; version: string };
  /** 逐条均为完整的 `sandplay-session/v1` 文件 */
  sessions: SandplayFile[];
  /** 本地档案（化名） */
  clients: ArchiveClientRecord[];
}

/* -------------------------------------------------------------------------- */
/*                                    导出                                     */
/* -------------------------------------------------------------------------- */

/** 内部档案 -> 导出条目 */
export function toArchiveClientRecord(client: LocalClient): ArchiveClientRecord {
  const record: ArchiveClientRecord = {
    id: client.id,
    alias: client.alias,
    createdAt: client.at,
  };
  if (client.note) record.note = client.note;
  if (client.archived) record.archived = true;
  if (client.color) record.color = client.color;
  return record;
}

/** 导出条目 -> 内部档案（缺字段时给安全兜底） */
export function fromArchiveClientRecord(record: ArchiveClientRecord, now = new Date()): LocalClient {
  return {
    id: record.id,
    at: record.createdAt || now.toISOString(),
    alias: record.alias,
    note: record.note || undefined,
    archived: record.archived === true ? true : undefined,
    color: record.color || undefined,
  };
}

export interface BuildArchiveOptions {
  /** 逐条会话导出的裁剪选项 */
  exportOptions?: ExportOptions;
  /** 导出时刻，便于单测固定 */
  now?: Date;
}

/**
 * 生成全量档案 envelope。
 *
 * 会话按时间倒序（与 `useSessions()` 一致），档案按建档时间倒序。
 * `stats` 不写入 envelope：报告单里的统计是**渲染时算**的，写死进文件会让体积翻倍且容易过期。
 */
export function buildArchiveEnvelope(
  sessions: SandSession[],
  clients: LocalClient[],
  options: BuildArchiveOptions = {},
): XinyuArchiveEnvelope {
  const exportOptions = options.exportOptions ?? DEFAULT_EXPORT_OPTIONS;
  const now = options.now ?? new Date();

  return {
    format: XINYU_ARCHIVE_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    producer: { app: PRODUCER.app, version: PRODUCER.version },
    sessions: [...sessions]
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((session) => toSandplayFile(session, exportOptions)),
    clients: [...clients]
      .sort((a, b) => b.at.localeCompare(a.at))
      .map(toArchiveClientRecord),
  };
}

/* -------------------------------------------------------------------------- */
/*                                    校验                                     */
/* -------------------------------------------------------------------------- */

export interface ArchiveIssue {
  /** 出错位置，例如 `clients[2].alias`、`sessions[0].session.id` */
  path: string;
  message: string;
}

export interface ArchiveValidation {
  ok: boolean;
  issues: ArchiveIssue[];
  data?: XinyuArchiveEnvelope;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验 envelope 外壳。
 *
 * 只看外壳（format / version / exportedAt / producer / 两个数组），
 * 内层每条会话交给 `validateSandplayFile`（导入时逐条校验，才能报告"第几条坏了"）。
 */
export function validateArchiveEnvelope(input: unknown): ArchiveValidation {
  const issues: ArchiveIssue[] = [];

  if (!isObject(input)) {
    return { ok: false, issues: [{ path: '$', message: '文件内容不是有效的 JSON 对象。' }] };
  }
  if (input.format !== XINYU_ARCHIVE_FORMAT) {
    return {
      ok: false,
      issues: [
        {
          path: 'format',
          message: `这不是心屿全量档案文件（format 应为 "${XINYU_ARCHIVE_FORMAT}"，实际是 ${JSON.stringify(
            input.format,
          )}）。单个会话请用「导入单条会话」，或在记录单页导出。`,
        },
      ],
    };
  }
  if (input.version !== 1) {
    return { ok: false, issues: [{ path: 'version', message: 'version 必须是 1。' }] };
  }
  if (typeof input.exportedAt !== 'string' || Number.isNaN(Date.parse(input.exportedAt))) {
    issues.push({ path: 'exportedAt', message: 'exportedAt 必须是合法的 ISO 时间字符串。' });
  }
  if (!isObject(input.producer)) {
    issues.push({ path: 'producer', message: 'producer 必须是对象。' });
  }

  if (!Array.isArray(input.sessions)) {
    issues.push({ path: 'sessions', message: 'sessions 必须是数组。' });
  }
  if (!Array.isArray(input.clients)) {
    issues.push({ path: 'clients', message: 'clients 必须是数组。' });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, issues, data: input as unknown as XinyuArchiveEnvelope };
}

/** 解析文本并校验外壳（JSON 语法错误也在这里兜住） */
export function parseArchiveText(text: string): ArchiveValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return {
      ok: false,
      issues: [
        {
          path: '$',
          message: `不是合法的 JSON：${cause instanceof Error ? cause.message : String(cause)}`,
        },
      ],
    };
  }
  return validateArchiveEnvelope(parsed);
}

/* -------------------------------------------------------------------------- */
/*                                    导入                                     */
/* -------------------------------------------------------------------------- */

/** 导入所需的最小副作用面；默认指向真实的 sessionStore，单测可注入假实现。 */
export interface ArchiveImportDeps {
  /** 已存在的会话 id 集合（用于判重） */
  existingSessionIds: ReadonlySet<string>;
  /** 已存在的档案 id 集合 */
  existingClientIds: ReadonlySet<string>;
  /**
   * 写入一个会话，返回是否真的写成功。
   *
   * 为什么要有返回值：导入时可能因为 localStorage 配额满而写失败。
   * 如果这里声明成 `void`，调用方只能「调用了就当成功」，
   * 于是把 50 个文件「导入」进一个 0 条数据的库里，还报「全部导入成功」。
   * 返回 `false` 时计进 `failed`，用户才知道该先清理空间再重试。
   */
  saveSession: (session: SandSession) => boolean;
  saveClient: (client: LocalClient) => boolean;
}

export interface ArchiveImportResult {
  /** 成功写入的会话数 */
  imported: number;
  /** 已存在而跳过的会话数（重复导入不产生副本） */
  skipped: number;
  /** 校验失败 / 结构异常的会话数 */
  failed: number;
  /** 新建的档案数 */
  clientsCreated: number;
  /** 覆盖更新的档案数（同 id） */
  clientsUpdated: number;
  /** 逐条失败原因，前 10 条，供 toast/详情展示 */
  issues: ArchiveIssue[];
  /** 因找不到档案而被清除 clientRef 的会话数（避免变成"幽灵绑定"） */
  refsCleared: number;
}

/** 判断某个 id 是否是已知档案（本机已有 or 本次文件自带） */
function knownClientIds(
  deps: ArchiveImportDeps,
  envelope: XinyuArchiveEnvelope,
): Set<string> {
  const ids = new Set<string>(deps.existingClientIds);
  for (const record of envelope.clients) {
    if (isObject(record) && typeof record.id === 'string' && record.id) ids.add(record.id);
  }
  return ids;
}

/**
 * 把 envelope 写回本机。
 *
 * 行为约定（决定了用户看到什么）：
 * - **会话按 id 判重**：已存在则跳过，不覆盖、不产生副本（防止重复导入把列表刷成双份）；
 * - 每条会话先过 `validateSandplayFile`（正式格式的唯一判定入口），
 *   再用 `fromSandplayFile` 转回内部模型，最后 `coerceSession` 做一次兜底归一化；
 * - 档案按 id upsert；`meta.clientRef` 指向未知档案时**清除**该引用，
 *   而不是留一个查不到的点（会话本身仍然保留，落到「未绑定会话」里）。
 *
 * 不做任何解读、不做任何合并启发式：全程只搬字段。
 */
export function importArchiveEnvelope(
  envelope: XinyuArchiveEnvelope,
  deps: ArchiveImportDeps,
): ArchiveImportResult {
  const result: ArchiveImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    clientsCreated: 0,
    clientsUpdated: 0,
    issues: [],
    refsCleared: 0,
  };

  // ------------------------------- 档案 -------------------------------
  const refs = knownClientIds(deps, envelope);
  for (const [index, raw] of envelope.clients.entries()) {
    if (!isObject(raw)) {
      result.issues.push({ path: `clients[${index}]`, message: '档案条目必须是对象。' });
      continue;
    }
    const record = raw as unknown as ArchiveClientRecord;
    if (typeof record.id !== 'string' || !record.id) {
      result.issues.push({ path: `clients[${index}].id`, message: '档案缺少 id，已跳过。' });
      continue;
    }
    if (typeof record.alias !== 'string' || !record.alias.trim()) {
      result.issues.push({ path: `clients[${index}].alias`, message: '档案缺少化名，已跳过。' });
      continue;
    }
    const client = fromArchiveClientRecord(record);
    const wrote = deps.saveClient(client);
    if (wrote) {
      if (deps.existingClientIds.has(record.id)) result.clientsUpdated += 1;
      else result.clientsCreated += 1;
    } else {
      // 写失败不增加「已创建/已更新」计数 —— 否则报告的数字与实际库里的条目数不符
      result.issues.push({
        path: `clients[${index}].id`,
        message: '档案写入失败（可能是本机存储空间已满），已跳过。',
      });
    }
  }

  // ------------------------------- 会话 -------------------------------
  const seen = new Set<string>(deps.existingSessionIds);
  for (const [index, raw] of envelope.sessions.entries()) {
    const path = `sessions[${index}]`;
    const validation = validateSandplayFile(raw);
    if (!validation.ok || !validation.data) {
      result.failed += 1;
      if (result.issues.length < 20) {
        const first = validation.issues.find((issue) => issue.severity === 'error');
        result.issues.push({
          path,
          message: first ? `${first.path}：${first.message}` : '格式校验未通过。',
        });
      }
      continue;
    }

    let session: SandSession;
    try {
      session = fromSandplayFile(raw as SandplayFile);
    } catch (cause) {
      result.failed += 1;
      if (result.issues.length < 20) {
        result.issues.push({
          path,
          message: `无法转换为本地会话：${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
      continue;
    }

    const coerced = coerceSession(session);
    if (!coerced) {
      result.failed += 1;
      if (result.issues.length < 20) {
        result.issues.push({ path, message: '会话结构无法识别。' });
      }
      continue;
    }

    if (seen.has(coerced.id)) {
      result.skipped += 1;
      continue;
    }

    // 未知档案引用：清掉引用，让会话落到「未绑定会话」而不是消失
    const ref = coerced.meta?.clientRef;
    if (ref && !refs.has(ref)) {
      const meta = { ...(coerced.meta ?? {}) };
      delete meta.clientRef;
      coerced.meta = Object.keys(meta).length > 0 ? meta : undefined;
      result.refsCleared += 1;
    }

    seen.add(coerced.id);
    // 写失败（配额满等）要计进 failed，不能假装导入成功
    if (deps.saveSession(coerced)) {
      result.imported += 1;
    } else {
      result.failed += 1;
    }
  }

  return result;
}

/** 供 UI 直接调用的默认依赖（真实读写本机存储） */
export function defaultImportDeps(
  sessions: SandSession[],
  clients: LocalClient[],
): ArchiveImportDeps {
  return {
    existingSessionIds: new Set(sessions.map((session) => session.id)),
    existingClientIds: new Set(clients.map((client) => client.id)),
    saveSession: (session) => saveSession(session),
    saveClient: (client) => saveClient(client),
  };
}

/** 便捷入口：校验 + 导入一步到位（UI 用） */
export function importArchive(
  input: unknown,
  sessions: SandSession[],
  clients: LocalClient[],
): { ok: boolean; message: string; result?: ArchiveImportResult } {
  const validation = validateArchiveEnvelope(input);
  if (!validation.ok || !validation.data) {
    return { ok: false, message: validation.issues[0]?.message ?? '文件结构不正确。' };
  }
  const result = importArchiveEnvelope(validation.data, defaultImportDeps(sessions, clients));
  return { ok: true, message: summarizeImportResult(result), result };
}

/** 一行摘要（UI toast 用）；只报数字，不评价 */
export function summarizeImportResult(result: ArchiveImportResult): string {
  const parts = [`导入 ${result.imported} 条会话`];
  parts.push(`新增 ${result.clientsCreated} 个档案`);
  if (result.clientsUpdated > 0) parts.push(`更新 ${result.clientsUpdated} 个档案`);
  if (result.skipped > 0) parts.push(`跳过已存在 ${result.skipped} 条`);
  if (result.failed > 0) parts.push(`失败 ${result.failed} 条`);
  if (result.refsCleared > 0) parts.push(`清除无效档案引用 ${result.refsCleared} 条`);
  return parts.join('，') + '。';
}

/** 供 CLI / 单测：一键生成再解析（同时验证导出与导入两侧的闭环） */
export function roundTripArchive(
  sessions: SandSession[],
  clients: LocalClient[],
): { envelope: XinyuArchiveEnvelope; reimported: ArchiveImportResult } {
  const envelope = buildArchiveEnvelope(sessions, clients);
  const reimported = importArchiveEnvelope(envelope, {
    existingSessionIds: new Set<string>(),
    existingClientIds: new Set<string>(),
    // 这是一次「只验证内容能否原样再导入」的干跑，不该产生任何副作用，
    // 所以显式返回 true 表示「逻辑上写成功」，而不是真去写。
    saveSession: () => true,
    saveClient: () => true,
  });
  return { envelope, reimported };
}

/** 会话文件本身也允许直接导入（用户可能只拖了一个 `.sandplay.json`） */
export function looksLikeSessionFile(input: unknown): boolean {
  return isObject(input) && input.format === SANDPAY_FORMAT;
}
