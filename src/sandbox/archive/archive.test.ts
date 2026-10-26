/**
 * 心屿 · 档案层单测
 *
 * 覆盖四块纯逻辑：
 * 1. `clientBinding`：绑定 / 解绑 / 统计（含空数据）；
 * 2. `download`：文件名 sanitize、Blob MIME、BOM 规则；
 * 3. `archive`：envelope 结构、导出→导入闭环、判重、坏数据不炸；
 * 4. `reportFacts`：记录单模型只含事实、无解读措辞。
 *
 * 注意：`clientBinding` 的写入函数依赖 `getSession/saveSession`（localStorage），
 * 因此在 node 环境下只测**纯函数**部分（`withClientRef` / `withArchived` / `sessionsOfClient` / `clientSummary`），
 * 写入链路由边界情况（会话不存在 → 返回 null）来保证不抛错。
 */

import { describe, expect, it } from 'vitest';
import type { LocalClient, SandSession, SandboxItem } from '@/lib/types';
import {
  boundClientId,
  clientSummaries,
  clientSummary,
  emptySummary,
  isUnbound,
  sessionsOfClient,
  unboundSessions,
  withArchived,
  withClientAlias,
  withClientRef,
  attachSessionToClient,
  detachSession,
} from '@/sandbox/archive/clientBinding';
import {
  MAX_FILENAME_LENGTH,
  archiveFilename,
  buildCsvBlob,
  buildJsonBlob,
  buildMarkdownBlob,
  canDownload,
  dataUrlToBlob,
  formatStamp,
  hasBom,
  reportImageFilename,
  sandplayFilename,
  sanitizeFilename,
  withBom,
} from '@/sandbox/archive/download';
import {
  XINYU_ARCHIVE_FORMAT,
  buildArchiveEnvelope,
  fromArchiveClientRecord,
  importArchive,
  importArchiveEnvelope,
  looksLikeSessionFile,
  parseArchiveText,
  roundTripArchive,
  summarizeImportResult,
  toArchiveClientRecord,
  validateArchiveEnvelope,
} from '@/sandbox/archive/archive';
import type { ArchiveImportDeps } from '@/sandbox/archive/archive';
import {
  INTERPRETATION_PATTERNS,
  REPORT_DISCLAIMER,
  buildSessionReport,
  formatSpan,
  reportToMarkdown,
} from '@/sandbox/archive/reportFacts';
import { toSandplayFile, validateSandplayFile, DEFAULT_EXPORT_OPTIONS } from '@/format/sandplay';

/* -------------------------------------------------------------------------- */
/*                                  造数据                                    */
/* -------------------------------------------------------------------------- */

const ISO = '2026-10-20T02:30:00.000Z';

function item(id: string, overrides: Partial<SandboxItem> = {}): SandboxItem {
  return {
    id,
    symbolId: 'tree',
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    z: 1,
    ...overrides,
  };
}

function session(overrides: Partial<SandSession> = {}): SandSession {
  return {
    schemaVersion: 2,
    id: 'session_1',
    at: ISO,
    title: '海边的一天',
    mode: 'counselor',
    sceneId: 'beach',
    items: [item('i1'), item('i2', { x: 0.2, y: 0.8, z: 2 })],
    events: [
      { t: 0, type: 'session.start', payload: { sceneId: 'beach' } },
      { t: 1000, type: 'item.add', itemId: 'i1', payload: { item: item('i1') } },
      { t: 5000, type: 'item.add', itemId: 'i2', payload: { item: item('i2') } },
    ],
    locked: true,
    surface: { cols: 8, rows: 6, height: 'AA==', state: 'wet', waterAdded: 2 },
    reflection: '想记住这一片海。',
    meta: { alias: '小林', clientRef: 'client_a', sessionNo: 1 },
    annotations: [{ id: 'a1', eventIndex: 1, t: 1000, text: '在这里停了一会儿', author: 'counselor', at: ISO }],
    ...overrides,
  };
}

function client(id: string, alias: string, overrides: Partial<LocalClient> = {}): LocalClient {
  return { id, alias, at: ISO, ...overrides };
}

/** 内存版导入依赖（不碰 localStorage） */
function memoryDeps(
  existingSessions: SandSession[] = [],
  existingClients: LocalClient[] = [],
): { deps: ArchiveImportDeps; sessions: SandSession[]; clients: LocalClient[] } {
  const sessions = [...existingSessions];
  const clients = [...existingClients];
  return {
    sessions,
    clients,
    deps: {
      existingSessionIds: new Set(sessions.map((s) => s.id)),
      existingClientIds: new Set(clients.map((c) => c.id)),
      saveSession: (s) => {
        const index = sessions.findIndex((entry) => entry.id === s.id);
        if (index >= 0) sessions[index] = s;
        else sessions.push(s);
        return true;
      },
      saveClient: (c) => {
        const index = clients.findIndex((entry) => entry.id === c.id);
        if (index >= 0) clients[index] = c;
        else clients.push(c);
        return true;
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                              1. 绑定与统计                                  */
/* -------------------------------------------------------------------------- */

describe('clientBinding · 统计', () => {
  it('空数据返回全 0 且时间为 null', () => {
    const summary = clientSummary([], [], 'client_a');
    expect(summary).toEqual({ sessionCount: 0, archivedCount: 0, firstAt: null, lastAt: null });
    expect(summary.sessionCount).toBe(0);
  });

  it('emptySummary 每次返回新对象（避免调用方改到共享缓存）', () => {
    const a = emptySummary();
    const b = emptySummary();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('档案不存在时统计恒为空，不产生幽灵次数', () => {
    const summary = clientSummary([], [session()], 'client_a');
    expect(summary.sessionCount).toBe(0);
    expect(summary.lastAt).toBeNull();
  });

  it('clientSummary 区分未归档 / 已归档，并给出首末时间', () => {
    const sessions = [
      session({ id: 's1', at: '2026-09-01T00:00:00.000Z' }),
      session({ id: 's2', at: '2026-10-01T00:00:00.000Z' }),
      session({ id: 's3', at: '2026-10-15T00:00:00.000Z', archived: true }),
    ];
    const summary = clientSummary([client('client_a', '小林')], sessions, 'client_a');
    expect(summary.sessionCount).toBe(2);
    expect(summary.archivedCount).toBe(1);
    expect(summary.firstAt).toBe('2026-09-01T00:00:00.000Z');
    // 最近一次包含归档会话 —— 归档只是收起来，不是没发生过
    expect(summary.lastAt).toBe('2026-10-15T00:00:00.000Z');
  });

  it('clientSummaries 批量结果与逐个计算一致', () => {
    const clients = [client('client_a', '小林'), client('client_b', 'A2')];
    const sessions = [
      session({ id: 's1', meta: { clientRef: 'client_a' } }),
      session({ id: 's2', meta: { clientRef: 'client_b' }, archived: true }),
    ];
    const map = clientSummaries(clients, sessions);
    expect(map.size).toBe(2);
    expect(map.get('client_a')).toEqual(clientSummary(clients, sessions, 'client_a'));
    expect(map.get('client_b')?.archivedCount).toBe(1);
  });

  it('sessionsOfClient 按 includeArchived 过滤且时间倒序', () => {
    const sessions = [
      session({ id: 'old', at: '2026-09-01T00:00:00.000Z' }),
      session({ id: 'new', at: '2026-10-01T00:00:00.000Z' }),
      session({ id: 'gone', at: '2026-10-10T00:00:00.000Z', archived: true }),
    ];
    expect(sessionsOfClient(sessions, 'client_a', true).map((s) => s.id)).toEqual([
      'gone',
      'new',
      'old',
    ]);
    expect(sessionsOfClient(sessions, 'client_a', false).map((s) => s.id)).toEqual(['new', 'old']);
    expect(sessionsOfClient(sessions, 'client_a', false)).toHaveLength(2);
  });

  it('未绑定会话可被识别并单独列出', () => {
    const sessions = [
      session({ id: 'bound' }),
      session({ id: 'free', meta: undefined }),
      session({ id: 'free2', meta: { alias: '没档案' } }),
    ];
    expect(isUnbound(sessions[1])).toBe(true);
    expect(boundClientId(sessions[0])).toBe('client_a');
    expect(unboundSessions(sessions).map((s) => s.id)).toEqual(['free', 'free2']);
  });

  it('sessionCount + archivedCount 恒等于该档案的会话总数', () => {
    // UI 的「总次数」就是这么加的（sessionCount 只算未归档）。
    // 这条不变式一旦破了，全部归档后档案会显示成 0 次，看起来像数据丢了。
    const sessions = [
      session({ id: 's1', meta: { clientRef: 'client_a' } }),
      session({ id: 's2', meta: { clientRef: 'client_a' }, archived: true }),
      session({ id: 's3', meta: { clientRef: 'client_a' }, archived: true }),
      session({ id: 'other', meta: { clientRef: 'client_b' } }),
    ];
    const clients = [client('client_a', '小林'), client('client_b', 'A2')];
    const summary = clientSummary(clients, sessions, 'client_a');
    const total = sessions.filter((s) => s.meta?.clientRef === 'client_a').length;

    expect(summary.sessionCount).toBe(1);
    expect(summary.archivedCount).toBe(2);
    expect(summary.sessionCount + summary.archivedCount).toBe(total);
    expect(total).toBe(3);
  });
});

describe('clientBinding · 改写', () => {
  it('withClientRef 绑定后 clientRef 正确，且不改原对象', () => {
    const original = session({ meta: { alias: '小林' } });
    const bound = withClientRef(original, 'client_b');
    expect(bound.meta?.clientRef).toBe('client_b');
    expect(bound.meta?.alias).toBe('小林');
    expect(original.meta?.clientRef).toBeUndefined();
    expect(bound).not.toBe(original);
  });

  it('解绑后 clientRef 消失，其他 meta 字段保留', () => {
    const bound = withClientRef(session(), 'client_a');
    const detached = withClientRef(bound, null);
    expect(detached.meta?.clientRef).toBeUndefined();
    expect(detached.meta?.alias).toBe('小林');
    expect(isUnbound(detached)).toBe(true);
  });

  it('解绑最后一个 meta 字段后 meta 整体变 undefined', () => {
    const detached = withClientRef(session({ meta: { clientRef: 'client_a' } }), null);
    expect(detached.meta).toBeUndefined();
  });

  it('withClientAlias 写入与清除化名', () => {
    expect(withClientAlias(session({ meta: {} }), 'A2').meta?.alias).toBe('A2');
    expect(withClientAlias(session({ meta: { alias: '小林' } }), null).meta).toBeUndefined();
  });

  it('withArchived 归档 / 取消归档可反复切换', () => {
    const archived = withArchived(session({ archived: undefined }), true, ISO);
    expect(archived.archived).toBe(true);
    expect(archived.archivedAt).toBe(ISO);

    const restored = withArchived(archived, false);
    expect(restored.archived).toBeUndefined();
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.id).toBe('session_1');
  });

  it('已归档再归档返回同一引用（幂等，避免多余写入）', () => {
    const archived = withArchived(session(), true, ISO);
    expect(withArchived(archived, true, '2026-11-01T00:00:00.000Z')).toBe(archived);
  });

  it('会话不存在时绑定/解绑返回 null 而不抛错', () => {
    expect(attachSessionToClient('does-not-exist', 'client_a')).toBeNull();
    expect(detachSession('does-not-exist')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*                              2. 文件名与 Blob                               */
/* -------------------------------------------------------------------------- */

describe('download · 文件名', () => {
  it('sanitizeFilename 去掉 Windows 保留字符', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('sanitizeFilename 保留中文，把空格折叠为连字符', () => {
    expect(sanitizeFilename('海边 的 一天')).toBe('海边-的-一天');
    // 中文不能被误删
    expect(sanitizeFilename('小林')).toBe('小林');
  });

  it('sanitizeFilename 处理空串与纯特殊字符', () => {
    expect(sanitizeFilename('')).toBe('未命名');
    expect(sanitizeFilename('///')).toBe('未命名');
    expect(sanitizeFilename('   ')).toBe('未命名');
  });

  it('sanitizeFilename 超长时截断到 80 个字符', () => {
    const long = '沙'.repeat(200);
    const result = sanitizeFilename(long);
    expect(Array.from(result)).toHaveLength(MAX_FILENAME_LENGTH);
    expect(MAX_FILENAME_LENGTH).toBe(80);
  });

  it('sanitizeFilename 截断不切开代理对（emoji 仍完整）', () => {
    const result = sanitizeFilename('🌊'.repeat(100));
    expect(Array.from(result)).toHaveLength(80);
    expect(result.includes('\uFFFD')).toBe(false);
    expect(Array.from(result).every((ch) => ch === '🌊')).toBe(true);
  });

  it('sanitizeFilename 去掉首尾句点（Windows 不允许已句点结尾）', () => {
    expect(sanitizeFilename('...abc...')).toBe('abc');
    expect(sanitizeFilename('con')).toBe('_con');
  });

  it('formatStamp 输出 yyyyMMdd-HHmm', () => {
    expect(formatStamp(new Date(2026, 9, 27, 9, 5))).toBe('20261027-0905');
  });

  it('单会话文件名格式为 sandplay-{title}-{stamp}.sandplay.json', () => {
    const name = sandplayFilename('海边的一天', new Date(2026, 9, 27, 9, 5));
    expect(name).toBe('sandplay-海边的一天-20261027-0905.sandplay.json');
    expect(name.endsWith('.sandplay.json')).toBe(true);
  });

  it('全量档案文件名与图片文件名格式正确', () => {
    const stamp = new Date(2026, 9, 27, 9, 5);
    expect(archiveFilename(stamp)).toBe('sandplay-archive-20261027-0905.sandplay-archive.json');
    expect(reportImageFilename('海边的一天', stamp)).toBe(
      'sandplay-海边的一天-20261027-0905.png',
    );
  });
});

describe('download · 编码与 Blob', () => {
  it('downloadJson 生成的 Blob type 为 application/json（无 BOM）', async () => {
    const blob = buildJsonBlob({ a: 1, 中文: '值' });
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    expect(text.startsWith('\uFEFF')).toBe(false);
    // 不加 BOM 才能被 JSON.parse 直接吃下
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toEqual({ a: 1, 中文: '值' });
  });

  it('Markdown / CSV 加 BOM，JSON 不加（按原始字节判定）', async () => {
    // 注意：不能用 blob.text() 判断 BOM —— TextDecoder 默认会吃掉 BOM，
    // 必须看真实的 UTF-8 字节（EF BB BF）。
    const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
    const startsWithBom = (bytes: Uint8Array) =>
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

    const md = buildMarkdownBlob('# 记录单');
    const csv = buildCsvBlob('a,b\n1,2');
    const json = buildJsonBlob({ 中文: '值' });

    expect(md.type).toBe('text/markdown');
    expect(csv.type).toBe('text/csv');
    expect(startsWithBom(await bytesOf(md))).toBe(true);
    expect(startsWithBom(await bytesOf(csv))).toBe(true);
    expect(startsWithBom(await bytesOf(json))).toBe(false);

    // text() 仍能读回正文（BOM 被解码器消化掉，不污染可用内容）
    expect(await md.text()).toBe('# 记录单');
    expect(hasBom(withBom(await md.text()))).toBe(true);
  });

  it('withBom 幂等，不会叠两个 BOM', () => {
    const once = withBom('中文');
    expect(hasBom(once)).toBe(true);
    expect(once).toBe('\uFEFF中文');
    expect(withBom(once)).toBe(once);
    expect(Array.from(withBom(once)).filter((ch) => ch === '\uFEFF')).toHaveLength(1);
  });

  it('node 环境下 canDownload 为 false，且不会抛错', () => {
    expect(canDownload()).toBe(false);
  });

  it('dataUrlToBlob 解析 base64 与非 base64 dataURL，非法输入返回 null', () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const blob = dataUrlToBlob(png);
    expect(blob).not.toBeNull();
    expect(blob?.type).toBe('image/png');
    expect(dataUrlToBlob('not-a-data-url')).toBeNull();
    expect(dataUrlToBlob('data:text/plain,hello')?.type).toBe('text/plain');
  });
});

/* -------------------------------------------------------------------------- */
/*                              3. 导出 / 导入                                 */
/* -------------------------------------------------------------------------- */

describe('archive · envelope 结构', () => {
  it('envelope 顶层字段符合 xinyu-archive/v1', () => {
    const envelope = buildArchiveEnvelope(
      [session()],
      [client('client_a', '小林')],
      { now: new Date('2026-10-27T00:00:00.000Z') },
    );
    expect(envelope.format).toBe(XINYU_ARCHIVE_FORMAT);
    expect(envelope.format).toBe('xinyu-archive/v1');
    expect(envelope.version).toBe(1);
    expect(envelope.exportedAt).toBe('2026-10-27T00:00:00.000Z');
    expect(envelope.producer.app).toBe('心屿 Xinyu');
    expect(Array.isArray(envelope.sessions)).toBe(true);
    expect(Array.isArray(envelope.clients)).toBe(true);
    expect(validateArchiveEnvelope(envelope).ok).toBe(true);
  });

  it('envelope.sessions 里每一条都是合法的 sandplay-session/v1', () => {
    const envelope = buildArchiveEnvelope([session()], [client('client_a', '小林')]);
    expect(envelope.sessions).toHaveLength(1);
    expect(envelope.sessions[0].format).toBe('sandplay-session/v1');
    const validation = validateSandplayFile(envelope.sessions[0]);
    expect(validation.ok).toBe(true);
    expect(validation.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });

  it('envelope.clients 使用 createdAt 且不含任何身份字段', () => {
    const envelope = buildArchiveEnvelope(
      [session()],
      [client('client_a', '小林', { note: '每周三' })],
    );
    const record = envelope.clients[0];
    expect(record.alias).toBe('小林');
    expect(record.createdAt).toBe(ISO);
    expect(record.note).toBe('每周三');
    const keys = Object.keys(record);
    for (const forbidden of ['realName', 'phone', 'idCard', 'email', 'address', 'name']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('导出选项真实生效：includeEvents=false 时事件为空', () => {
    const envelope = buildArchiveEnvelope([session()], [], {
      exportOptions: { includeEvents: false, includeSurface: false, includeThumbnail: false, includeAttachments: false },
    });
    expect(envelope.sessions[0].session.events).toEqual([]);
    expect(envelope.sessions[0].session.surface).toBeUndefined();
  });

  it('toArchiveClientRecord / fromArchiveClientRecord 往返保真', () => {
    const original = client('client_a', '小林', { note: '备注', archived: true, color: 'teal' });
    const record = toArchiveClientRecord(original);
    expect(record.archived).toBe(true);
    expect(record.color).toBe('teal');
    const restored = fromArchiveClientRecord(record);
    expect(restored.id).toBe(original.id);
    expect(restored.alias).toBe(original.alias);
    expect(restored.at).toBe(original.at);
    expect(restored.note).toBe(original.note);
    expect(restored.archived).toBe(true);
  });

  it('校验器拒绝错误的 format 与版本', () => {
    expect(validateArchiveEnvelope({ format: 'nope' }).ok).toBe(false);
    expect(validateArchiveEnvelope(null).ok).toBe(false);
    const wrongVersion = validateArchiveEnvelope({
      format: XINYU_ARCHIVE_FORMAT,
      version: 2,
      exportedAt: ISO,
      producer: { app: 'x', version: '1' },
      sessions: [],
      clients: [],
    });
    expect(wrongVersion.ok).toBe(false);
    expect(wrongVersion.issues[0].path).toBe('version');
  });

  it('parseArchiveText 对非 JSON 文本给出可读错误', () => {
    const result = parseArchiveText('这不是 json');
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('不是合法的 JSON');
  });

  it('looksLikeSessionFile 能区分子会话文件与全量档案', () => {
    expect(looksLikeSessionFile(toSandplayFile(session()))).toBe(true);
    expect(looksLikeSessionFile(buildArchiveEnvelope([session()], []))).toBe(false);
  });
});

describe('archive · 导出导入闭环', () => {
  it('导出后能原样再导入（会话数与字段一致）', () => {
    const { envelope, reimported } = roundTripArchive(
      [session()],
      [client('client_a', '小林')],
    );
    expect(envelope.sessions).toHaveLength(1);
    expect(reimported.imported).toBe(1);
    expect(reimported.failed).toBe(0);
    expect(reimported.clientsCreated).toBe(1);
  });

  it('导入闭环后会话的绑定关系与字段保留', () => {
    const memory = memoryDeps();
    const envelope = buildArchiveEnvelope([session()], [client('client_a', '小林')]);
    const result = importArchiveEnvelope(envelope, memory.deps);

    expect(result.imported).toBe(1);
    const restored = memory.sessions[0];
    expect(restored.id).toBe('session_1');
    expect(restored.title).toBe('海边的一天');
    expect(restored.meta?.clientRef).toBe('client_a');
    expect(restored.reflection).toBe('想记住这一片海。');
    expect(restored.items).toHaveLength(2);
    expect(restored.annotations).toHaveLength(1);
    expect(memory.clients[0].alias).toBe('小林');
  });

  it('重复导入同 id 会话被跳过，不产生副本', () => {
    const envelope = buildArchiveEnvelope([session()], [client('client_a', '小林')]);
    const memory = memoryDeps([session()], [client('client_a', '小林')]);
    const result = importArchiveEnvelope(envelope, memory.deps);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.clientsUpdated).toBe(1);
    expect(result.clientsCreated).toBe(0);
    expect(memory.sessions).toHaveLength(1);
  });

  it('坏会话计入 failed，好会话仍然导入', () => {
    const envelope = buildArchiveEnvelope([session()], [client('client_a', '小林')]);
    const broken = { format: 'sandplay-session/v1', version: 1 } as unknown;
    const mixed = { ...envelope, sessions: [broken, envelope.sessions[0]] };
    const memory = memoryDeps();
    const result = importArchiveEnvelope(mixed as typeof envelope, memory.deps);

    expect(result.failed).toBe(1);
    expect(result.imported).toBe(1);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].path).toBe('sessions[0]');
  });

  it('未知档案引用被清除，会话落到未绑定', () => {
    const envelope = buildArchiveEnvelope([session()], []); // 不带档案
    const memory = memoryDeps();
    const result = importArchiveEnvelope(envelope, memory.deps);

    expect(result.imported).toBe(1);
    expect(result.refsCleared).toBe(1);
    expect(memory.sessions[0].meta?.clientRef).toBeUndefined();
    expect(isUnbound(memory.sessions[0])).toBe(true);
  });

  it('summarizeImportResult 只报数字，不含评价词', () => {
    const text = summarizeImportResult({
      imported: 3,
      skipped: 1,
      failed: 0,
      clientsCreated: 1,
      clientsUpdated: 0,
      issues: [],
      refsCleared: 0,
    });
    expect(text).toContain('导入 3 条会话');
    expect(text).toContain('新增 1 个档案');
    expect(text).toContain('跳过已存在 1 条');
    for (const pattern of INTERPRETATION_PATTERNS) {
      expect(text).not.toContain(pattern);
    }
  });

  it('importArchive 对错误 format 直接拒绝，不写任何数据', () => {
    const memory = memoryDeps();
    const result = importArchive({ format: 'something-else' }, memory.sessions, memory.clients);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('xinyu-archive/v1');
    expect(memory.sessions).toHaveLength(0);
  });

  it('空档案导出仍能导入（0 条会话不报错）', () => {
    const memory = memoryDeps();
    const envelope = buildArchiveEnvelope([], []);
    const result = importArchiveEnvelope(envelope, memory.deps);
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(0);
    expect(validateArchiveEnvelope(envelope).ok).toBe(true);
  });

  it('单个 .sandplay.json 文件可被识别并走同一条导入路径', () => {
    // 用户在档案页可能只拖来一个单会话文件；UI 会把它包成单条 envelope。
    const file = toSandplayFile(session(), { ...DEFAULT_EXPORT_OPTIONS });
    expect(looksLikeSessionFile(file)).toBe(true);
    expect(validateSandplayFile(file).ok).toBe(true);

    const wrapped = {
      format: XINYU_ARCHIVE_FORMAT,
      version: 1 as const,
      exportedAt: ISO,
      producer: { app: '心屿 Xinyu', version: '2.0.0' },
      sessions: [file],
      clients: [],
    };
    const memory = memoryDeps();
    const result = importArchiveEnvelope(wrapped, memory.deps);
    expect(result.imported).toBe(1);
    expect(memory.sessions[0].id).toBe('session_1');
    // 会话里带着一个本机不存在的 clientRef，应被清除而不是丢会话
    expect(result.refsCleared).toBe(1);
    expect(memory.sessions[0].meta?.clientRef).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/*                              4. 记录单事实模型                              */
/* -------------------------------------------------------------------------- */

describe('reportFacts · 只含事实', () => {
  it('记录单包含必需的事实区块', () => {
    const model = buildSessionReport(session(), undefined, ISO);
    expect(model.title).toBe('海边的一天');
    expect(model.sceneLabel).toBe('沙滩');
    expect(model.modeLabel).toBe('咨询中使用');
    expect(model.lockedLabel).toBe('已封盘');
    expect(model.itemCount).toBe(2);
    expect(model.eventCount).toBe(3);
    expect(model.time.startedAt).toBe(ISO);
    expect(model.disclaimer).toBe(REPORT_DISCLAIMER);
  });

  it('摆件清单含坐标与序号，按层级升序', () => {
    const model = buildSessionReport(session());
    expect(model.items).toHaveLength(2);
    expect(model.items[0].z).toBe(1);
    expect(model.items[1].z).toBe(2);
    expect(model.items[0].index).toBe(1);
    expect(typeof model.items[0].x).toBe('number');
    expect(model.items[1].x).toBe(0.2);
    expect(model.items[1].y).toBe(0.8);
  });

  it('写下的文字与批注原样保留', () => {
    const model = buildSessionReport(session());
    expect(model.reflection).toBe('想记住这一片海。');
    expect(model.annotations).toHaveLength(1);
    expect(model.annotations[0].text).toBe('在这里停了一会儿');
    expect(model.annotations[0].step).toBe(2);
  });

  it('沙面统计为可测得的量', () => {
    const model = buildSessionReport(session());
    expect(model.surface.recorded).toBe(true);
    expect(model.surface.cols).toBe(8);
    expect(model.surface.rows).toBe(6);
    expect(model.surface.waterAdded).toBe(2);
    expect(model.surface.movedRatio).toBeGreaterThanOrEqual(0);
    expect(model.surface.movedRatio).toBeLessThanOrEqual(1);
  });

  it('无沙面数据时 recorded 为 false（不伪造统计）', () => {
    const model = buildSessionReport(session({ surface: undefined }));
    expect(model.surface.recorded).toBe(false);
    expect(model.surface.cols).toBeUndefined();
  });

  it('记录单模型与 Markdown 全文都不含解读性措辞', () => {
    const model = buildSessionReport(session());
    const markdown = reportToMarkdown(model);
    const haystacks = [JSON.stringify(model), markdown];
    for (const haystack of haystacks) {
      for (const pattern of INTERPRETATION_PATTERNS) {
        expect(haystack).not.toContain(pattern);
      }
    }
    // 免责声明必须出现，且是否定式
    expect(markdown).toContain('不含解释与诊断');
  });

  it('Markdown 含全部必需小节', () => {
    const markdown = reportToMarkdown(buildSessionReport(session()));
    for (const heading of ['## 基本信息', '## 摆件清单', '## 沙面统计', '## 写下的文字', '## 批注']) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain('想记住这一片海。');
    // 摆件坐标必须落进 Markdown（含位置坐标是硬要求）
    expect(markdown).toContain('0.50');
  });

  it('空会话的记录单不会崩，且给出"无摆件"', () => {
    const model = buildSessionReport(
      session({ items: [], events: [], annotations: [], reflection: undefined, surface: undefined }),
    );
    expect(model.items).toHaveLength(0);
    expect(model.itemCount).toBe(0);
    expect(model.reflection).toBeNull();
    const markdown = reportToMarkdown(model);
    expect(markdown).toContain('无摆件。');
    expect(markdown).toContain('这次没有写下文字。');
  });

  it('formatSpan 输出可读时长', () => {
    expect(formatSpan(0)).toBe('0 秒');
    expect(formatSpan(45_000)).toBe('45 秒');
    expect(formatSpan(125_000)).toBe('2 分 5 秒');
  });

  it('未封盘会话的 lockedLabel 为未封盘', () => {
    expect(buildSessionReport(session({ locked: false })).lockedLabel).toBe('未封盘');
  });
});
