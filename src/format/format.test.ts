/**
 * 心屿 · 格式层测试（`sandplay-session/v1` 校验 / 往返 / 迁移）
 *
 * 对应任务：task-6 §3。
 *
 * 这一层的价值在于「文件会离开这台机器」——导出给人看、导入别人的文件。
 * 因此测试重点是：
 * 1. 合法文件必须放行（不能过度严格，否则用户导出再导入就失败）；
 * 2. 每一类坏数据都必须被拦住，且 `issues[].path` 指到具体字段（可读、可修）；
 * 3. 隐私红线：身份字段出现就必须拒绝；
 * 4. 往返等价：`toSandplayFile -> fromSandplayFile` 不丢字段；
 * 5. 迁移正确性：v1 快照迁移后的事件流 `replayAll` 必须等于 items。
 */

import { describe, expect, it } from 'vitest';
import type { SandSession, SandboxEvent, SandboxItem } from '@/lib/types';
import {
  DEFAULT_EXPORT_OPTIONS,
  SANDPAY_FORMAT,
  fromSandplayFile,
  parseSandplayFile,
  toSandplayFile,
  validateSandplayFile,
} from '@/format/sandplay';
import type { ValidationIssue, ValidationResult } from '@/format/sandplay';
import { coerceSession, isLegacySnapshot, migrateSnapshot } from '@/format/migrate';
import { replayAll, makeEvent } from '@/sandbox/events';
import { serializeSurface } from '@/sandbox/surfaceState';
import { createSurfaceState } from '@/sandbox/surfaceCodec';

/* -------------------------------------------------------------------------- */
/*                                  测试夹具                                   */
/* -------------------------------------------------------------------------- */

function item(id: string, overrides: Partial<SandboxItem> = {}): SandboxItem {
  return {
    id,
    symbolId: 'nature.tree',
    x: 0.42,
    y: 0.58,
    scale: 1.2,
    rotation: 15,
    z: 1,
    ...overrides,
  };
}

function buildSession(overrides: Partial<SandSession> = {}): SandSession {
  const items = [item('i1'), item('i2', { x: 0.7, y: 0.2, z: 2, note: '这里是一棵树' })];
  const events: SandboxEvent[] = [];
  events.push(
    makeEvent(events, 'session.start', { kind: 'session.start', sceneId: 'beach', mode: 'self' }, undefined, 0),
  );
  events.push(makeEvent(events, 'item.add', { kind: 'item.add', item: items[0] }, 'i1', 1000));
  events.push(makeEvent(events, 'item.add', { kind: 'item.add', item: items[1] }, 'i2', 2000));
  events.push(makeEvent(events, 'item.move', { kind: 'item.move', x: 0.7, y: 0.2 }, 'i1', 3000));

  return {
    schemaVersion: 2,
    id: 'session_test_1',
    at: '2026-10-20T09:00:00.000Z',
    title: '测试沙盘',
    mode: 'self',
    sceneId: 'beach',
    items,
    events,
    locked: false,
    ...overrides,
  };
}

/** 取某次校验结果里的错误（按 path 过滤） */
function errorsAt(result: ValidationResult, path: string): ValidationIssue[] {
  return result.issues.filter((issue) => issue.path === path && issue.severity === 'error');
}

/** 生成一个「合法」的文件对象，便于逐字段破坏 */
function validFile(): Record<string, unknown> {
  return toSandplayFile(buildSession()) as unknown as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/*                            1. 合法文件放行                                  */
/* -------------------------------------------------------------------------- */

describe('合法文件必须通过校验（不能过度严格）', () => {
  it('toSandplayFile 的产物自身校验通过', () => {
    const result = validateSandplayFile(validFile());
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('校验通过时回填 data（供调用方直接用）', () => {
    const result = validateSandplayFile(validFile());
    expect(result.data).toBeDefined();
    expect(result.data?.id).toBe('session_test_1');
    expect(result.data?.items).toHaveLength(2);
  });

  it('strict 模式下同样通过（strict 只提升 warning 的等级）', () => {
    expect(validateSandplayFile(validFile(), true).ok).toBe(true);
  });

  it('events 为空数组时通过（只导出结果、不导出过程）', () => {
    const file = toSandplayFile(buildSession(), { ...DEFAULT_EXPORT_OPTIONS, includeEvents: false });
    expect(validateSandplayFile(file).ok).toBe(true);
    expect(file.session.events).toEqual([]);
  });

  it('摆件为空数组时通过（未摆放任何沙具就保存）', () => {
    const file = toSandplayFile(buildSession({ items: [], events: [] }));
    expect(validateSandplayFile(file).ok).toBe(true);
  });

  it('带沙面时通过，且沙面字段完整', () => {
    const session = buildSession({ surface: serializeSurface(createSurfaceState(16, 12)) });
    const file = toSandplayFile(session);
    expect(file.session.surface?.cols).toBe(16);
    expect(file.session.surface?.rows).toBe(12);
    expect(file.session.surface?.height).toBeTruthy();
    expect(validateSandplayFile(file).ok).toBe(true);
  });

  it('带 meta / annotations / reflection / prompts 时通过', () => {
    const session = buildSession({
      reflection: '今天很平静',
      prompts: ['你摆了什么？'],
      meta: { phase: 'reflect', sessionNo: 3, alias: '小岛', consentProcess: true },
      annotations: [
        { id: 'a1', eventIndex: 2, t: 2000, text: '这里动了很久', author: 'self', at: '2026-10-20T09:05:00.000Z' },
      ],
    });
    const file = toSandplayFile(session);
    const result = validateSandplayFile(file);
    expect(result.ok).toBe(true);
    expect(result.data?.meta?.phase).toBe('reflect');
    expect(result.data?.annotations).toHaveLength(1);
  });

  it('parseSandplayFile 能解析合法 JSON 文本', () => {
    const text = JSON.stringify(toSandplayFile(buildSession()), null, 2);
    const result = parseSandplayFile(text);
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe('session_test_1');
  });
});

/* -------------------------------------------------------------------------- */
/*                          2. 每一类坏数据都必须拦住                           */
/* -------------------------------------------------------------------------- */

describe('坏数据拦截（issues 必须可读且指到具体字段）', () => {
  it('非对象输入被拒', () => {
    for (const bad of [null, undefined, 42, '字符串', [], true]) {
      const result = validateSandplayFile(bad);
      expect(result.ok).toBe(false);
      expect(errorsAt(result, '$').length).toBeGreaterThan(0);
    }
  });

  it('format 不对被拒，且报错里写出期望值', () => {
    const file = { ...validFile(), format: 'sandplay-session/v2' };
    const result = validateSandplayFile(file);
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'format').length).toBe(1);
    expect(errorsAt(result, 'format')[0].message).toContain(SANDPAY_FORMAT);
  });

  it('version 不是 1 被拒', () => {
    const result = validateSandplayFile({ ...validFile(), version: 2 });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'version').length).toBe(1);
  });

  it('exportedAt 不是合法 ISO 时间被拒', () => {
    const result = validateSandplayFile({ ...validFile(), exportedAt: '不是时间' });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'exportedAt').length).toBe(1);
  });

  it('producer 缺字段被拒（缺 app / 缺 version）', () => {
    const noApp = validateSandplayFile({ ...validFile(), producer: { version: '1.0.0' } });
    expect(noApp.ok).toBe(false);
    expect(errorsAt(noApp, 'producer.app').length).toBe(1);

    const noVersion = validateSandplayFile({ ...validFile(), producer: { app: 'x' } });
    expect(noVersion.ok).toBe(false);
    expect(errorsAt(noVersion, 'producer.version').length).toBe(1);
  });

  it('session 不是对象时立即返回（不再深入校验）', () => {
    const result = validateSandplayFile({ ...validFile(), session: '字符串' });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session').length).toBe(1);
    expect(result.data).toBeUndefined();
  });

  it('session 缺必需字符串字段被逐个报出', () => {
    const file = validFile();
    const session = { ...(file.session as Record<string, unknown>) };
    delete session.id;
    delete session.sceneId;
    const result = validateSandplayFile({ ...file, session });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.id').length).toBe(1);
    expect(errorsAt(result, 'session.sceneId').length).toBe(1);
  });

  it('mode 不在白名单被拒', () => {
    const file = validFile();
    const session = { ...(file.session as Record<string, unknown>), mode: 'therapist' };
    const result = validateSandplayFile({ ...file, session });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.mode').length).toBe(1);
    expect(errorsAt(result, 'session.mode')[0].message).toContain('counselor');
  });

  it('locked 不是布尔值被拒', () => {
    const file = validFile();
    const session = { ...(file.session as Record<string, unknown>), locked: 'yes' };
    const result = validateSandplayFile({ ...file, session });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.locked').length).toBe(1);
  });

  it('items 不是数组被拒', () => {
    const file = validFile();
    const session = { ...(file.session as Record<string, unknown>), items: {} };
    const result = validateSandplayFile({ ...file, session });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.items').length).toBe(1);
  });

  it('摆件缺 symbolId 被拒，path 指到具体下标', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const items = [...(session.items as Array<Record<string, unknown>>)];
    items[1] = { ...items[1], symbolId: '' };
    const result = validateSandplayFile({ ...file, session: { ...session, items } });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.items[1].symbolId').length).toBe(1);
  });

  it('x / y 超出 0~1 范围被拒（归一化坐标的硬约束）', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const items = [...(session.items as Array<Record<string, unknown>>)];
    items[0] = { ...items[0], x: 1.5 };
    items[1] = { ...items[1], y: -0.2 };
    const result = validateSandplayFile({ ...file, session: { ...session, items } });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.items[0].x').length).toBe(1);
    expect(errorsAt(result, 'session.items[1].y').length).toBe(1);
    expect(errorsAt(result, 'session.items[0].x')[0].message).toContain('0~1');
  });

  it('x / y 是 NaN / Infinity / 字符串时被拒', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const items = [...(session.items as Array<Record<string, unknown>>)];
    items[0] = { ...items[0], x: Number.NaN };
    const result = validateSandplayFile({ ...file, session: { ...session, items } });
    expect(errorsAt(result, 'session.items[0].x').length).toBe(1);

    const items2 = [...(session.items as Array<Record<string, unknown>>)];
    items2[0] = { ...items2[0], x: '0.5' };
    const result2 = validateSandplayFile({ ...file, session: { ...session, items: items2 } });
    expect(errorsAt(result2, 'session.items[0].x').length).toBe(1);
  });

  it('摆件 id 重复被拒（否则重放会互相覆盖）', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const items = [...(session.items as Array<Record<string, unknown>>)];
    items[1] = { ...items[1], id: items[0].id as string };
    const result = validateSandplayFile({ ...file, session: { ...session, items } });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.items[1].id').length).toBe(1);
    expect(errorsAt(result, 'session.items[1].id')[0].message).toContain('重复');
  });

  it('未知 event.type 被拒，并报出具体类型名', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const events = [...(session.events as Array<Record<string, unknown>>)];
    events[1] = { ...events[1], type: 'item.explode' };
    const result = validateSandplayFile({ ...file, session: { ...session, events } });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.events[1].type').length).toBe(1);
    expect(errorsAt(result, 'session.events[1].type')[0].message).toContain('item.explode');
  });

  it('event.t 不是数字被拒', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const events = [...(session.events as Array<Record<string, unknown>>)];
    events[0] = { ...events[0], t: '0' };
    const result = validateSandplayFile({ ...file, session: { ...session, events } });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.events[0].t').length).toBe(1);
  });

  it('event.payload 不是对象被拒', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const events = [...(session.events as Array<Record<string, unknown>>)];
    events[1] = { ...events[1], payload: '字符串' };
    const result = validateSandplayFile({ ...file, session: { ...session, events } });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.events[1].payload').length).toBe(1);
  });

  it('沙面 cols / rows 非正整数被拒，height 缺空被拒', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const result = validateSandplayFile({
      ...file,
      session: { ...session, surface: { cols: 0, rows: -1, height: '' } },
    });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.surface.cols').length).toBe(1);
    expect(errorsAt(result, 'session.surface.rows').length).toBe(1);
    expect(errorsAt(result, 'session.surface.height').length).toBe(1);
  });

  it('meta.phase 不在白名单被拒', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const result = validateSandplayFile({
      ...file,
      session: { ...session, meta: { phase: 'unknown-phase' } },
    });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.meta.phase').length).toBe(1);
  });

  it('annotations 结构错误被拒', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const result = validateSandplayFile({
      ...file,
      session: { ...session, annotations: [{ id: '', eventIndex: 'x', text: 1 }] },
    });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.annotations[0].id').length).toBe(1);
    expect(errorsAt(result, 'session.annotations[0].eventIndex').length).toBe(1);
    expect(errorsAt(result, 'session.annotations[0].text').length).toBe(1);
  });

  it('issues 里的 message 是给人看的中文（不是 UNAUTHORIZED 之类的错误码）', () => {
    const result = validateSandplayFile({ ...validFile(), format: 'x' });
    expect(result.issues.length).toBeGreaterThan(0);
    for (const issue of result.issues) {
      expect(issue.message).toMatch(/[\u4e00-\u9fa5]/);
      expect(issue.path).toBeTruthy();
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                        3. 隐私红线：身份字段必须拒绝                         */
/* -------------------------------------------------------------------------- */

describe('隐私红线（CONTRACT §5 / FORMAT.md）', () => {
  /**
   * `FORBIDDEN_FIELDS` 在源码里是模块私有常量（未导出），因此这份清单是
   * **独立于实现**写下的期望值 —— 这样它才能真正检验实现，而不是复制实现。
   * 若源码黑名单被删减，下面的用例会失败。
   */
  const REQUIRED_FORBIDDEN = [
    'name',
    'realName',
    'phone',
    'idCard',
    'email',
    'address',
    'wechat',
  ];

  it('应覆盖姓名 / 手机 / 身份证 / 邮箱 / 地址 / 微信等身份字段', () => {
    // 逐字段验证：每个都真的会被拒绝（等价于「在黑名单里」）
    for (const field of REQUIRED_FORBIDDEN) {
      const file = validFile();
      const session = file.session as Record<string, unknown>;
      const result = validateSandplayFile({
        ...file,
        session: { ...session, meta: { phase: 'reflect', [field]: '张三' } },
      });
      expect(result.ok, `字段 ${field} 应被拒绝但没有`).toBe(false);
      expect(errorsAt(result, `session.meta.${field}`).length).toBe(1);
    }
  });

  it('meta 里每一个身份字段出现都必须拒绝，且提示含「隐私」', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    for (const field of REQUIRED_FORBIDDEN) {
      const result = validateSandplayFile({
        ...file,
        session: { ...session, meta: { phase: 'reflect', [field]: '张三' } },
      });
      expect(result.ok, `字段 ${field} 应被拒绝但没有`).toBe(false);
      expect(errorsAt(result, `session.meta.${field}`)[0].message).toContain('隐私');
    }
  });

  it('meta 里出现真实姓名被拒（最常见的误用）', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const result = validateSandplayFile({
      ...file,
      session: { ...session, meta: { name: '李某某', phase: 'record' } },
    });
    expect(result.ok).toBe(false);
    expect(errorsAt(result, 'session.meta.name').length).toBe(1);
  });

  it('合法的化名字段（alias / clientRef）必须放行', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const result = validateSandplayFile({
      ...file,
      session: { ...session, meta: { alias: '小岛', clientRef: 'c_001', therapistRef: 't_007' } },
    });
    expect(result.ok).toBe(true);
  });

  /**
   * P2 隐私红线缺陷已修复：`findForbiddenFields()` 对**整棵 session 树**做深度遍历
   * （`src/format/sandplay.ts:225`），任何层级的禁用字段都会报错，路径精确。
   *
   * 历史：修复前只扫 `session.meta`，因此 `items[0].name = '李某某'` 能通过校验
   * 并被导出 —— 直接违反 VISION §5.6 的承诺。
   */
  it('摆件 payload 里的身份字段被拒绝，且 path 精确到具体位置', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const items = [...(session.items as Array<Record<string, unknown>>)];
    items[0] = { ...items[0], name: '李某某' };
    const result = validateSandplayFile({ ...file, session: { ...session, items } });

    expect(result.ok).toBe(false);
    const hits = errorsAt(result, 'session.items[0].name');
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain('隐私红线');
  });

  /**
   * 语义选择（与实现方确认过）：空字符串**放行**。
   * 理由：空串不构成明文身份信息，而 schema 允许可选字段存在。
   * 这条是反向回归 —— 防止将来有人把判断写严到「有键就拒」，
   * 那样所有导出的空 name 字段都会让合法文件校验失败。
   */
  it('空字符串的身份字段放行（可选字段存在但无内容）', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const items = [...(session.items as Array<Record<string, unknown>>)];
    items[0] = { ...items[0], name: '' };
    const result = validateSandplayFile({ ...file, session: { ...session, items } });
    expect(result.ok).toBe(true);
  });

  /**
   * 事件流里的 item 快照同样是明文，导出后一样会泄漏。
   * 这条专门覆盖 `events[].payload.item.name` 这条路径 ——
   * 如果只扫 items 而漏掉 events，等于留了个后门。
   */
  it('事件 payload 里的身份字段也被拒绝', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const events = [
      {
        type: 'item.add',
        at: '2026-02-01T00:00:00.000Z',
        payload: { item: { id: 'i1', symbolId: 's1', x: 0.5, y: 0.5, name: '李某某' } },
      },
    ];
    const result = validateSandplayFile({ ...file, session: { ...session, events } });

    expect(result.ok).toBe(false);
    const paths = result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.path);
    expect(paths.some((entry) => /events\[0\]\.payload\.item\.name$/.test(entry))).toBe(true);
  });

  /**
   * 深度遍历不能因为结构异常而崩掉：导入的是外部文件，不能假定结构良好。
   * 实现里有 WeakSet 环保护 + maxDepth=32。
   */
  it('循环引用的 session 不会让隐私扫描栈溢出', () => {
    const file = validFile();
    const session = file.session as Record<string, unknown>;
    const cyclic: Record<string, unknown> = { ...session, note: 'x' };
    cyclic.self = cyclic; // 自引用
    expect(() => validateSandplayFile({ ...file, session: cyclic })).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/*                          4. 往返等价（不丢字段）                            */
/* -------------------------------------------------------------------------- */

describe('往返等价：toSandplayFile -> fromSandplayFile', () => {
  it('基本会话往返后核心字段完全相同', () => {
    const session = buildSession();
    const file = toSandplayFile(session);
    const result = validateSandplayFile(file);
    expect(result.ok).toBe(true);
    const back = fromSandplayFile(file);

    expect(back.id).toBe(session.id);
    expect(back.at).toBe(session.at);
    expect(back.title).toBe(session.title);
    expect(back.mode).toBe(session.mode);
    expect(back.sceneId).toBe(session.sceneId);
    expect(back.locked).toBe(session.locked);
    expect(back.items).toEqual(session.items);
    expect(back.events).toEqual(session.events);
    expect(back.schemaVersion).toBe(2);
  });

  it('第二次往返与前一次结果相同（幂等，不会逐次丢东西）', () => {
    const first = fromSandplayFile(toSandplayFile(buildSession()));
    const second = fromSandplayFile(toSandplayFile(first));
    expect(second).toEqual(first);
  });

  it('摆件的可选字段（note / affectLabels / burial）不丢', () => {
    const session = buildSession({
      items: [
        item('i1', { note: '注释', affectLabels: ['紧张', '期待'], burial: 0.4 }),
        item('i2', { burial: 0 }),
      ],
    });
    const back = fromSandplayFile(toSandplayFile(session));
    expect(back.items[0].note).toBe('注释');
    expect(back.items[0].affectLabels).toEqual(['紧张', '期待']);
    expect(back.items[0].burial).toBe(0.4);
    // burial: 0 是合法值，不能被当成「未设置」丢掉
    expect(back.items[1].burial).toBe(0);
  });

  it('沙面往返后与原沙面等价（编码字符串逐字节相同）', () => {
    const surface = serializeSurface(createSurfaceState(24, 16));
    const session = buildSession({ surface });
    const back = fromSandplayFile(toSandplayFile(session));
    expect(back.surface?.cols).toBe(24);
    expect(back.surface?.rows).toBe(16);
    expect(back.surface?.height).toBe(surface.height);
  });

  it('meta / reflection / prompts / annotations / thumbnail 往返不丢', () => {
    const session = buildSession({
      reflection: '自述内容',
      prompts: ['问题一', '问题二'],
      meta: { phase: 'connect', sessionNo: 2, alias: '小岛', trayW: 72, consentPhoto: true },
      annotations: [
        { id: 'a1', eventIndex: 1, t: 1000, text: '标注', author: 'counselor', at: '2026-10-20T09:10:00.000Z' },
      ],
      thumbnail: 'data:image/png;base64,AAAA',
    });
    const back = fromSandplayFile(toSandplayFile(session));
    expect(back.reflection).toBe('自述内容');
    expect(back.prompts).toEqual(['问题一', '问题二']);
    expect(back.meta?.phase).toBe('connect');
    expect(back.meta?.alias).toBe('小岛');
    expect(back.meta?.trayW).toBe(72);
    expect(back.annotations?.[0].author).toBe('counselor');
    expect(back.thumbnail).toBe('data:image/png;base64,AAAA');
  });

  it('includeAttachments=false 时剥离 audioNote / imageData（隐私默认关闭）', () => {
    const session = buildSession({
      items: [item('i1', { audioNote: 'data:audio/webm;base64,AAA', imageData: 'data:image/png;base64,BBB' })],
    });
    const file = toSandplayFile(session, { ...DEFAULT_EXPORT_OPTIONS, includeAttachments: false });
    expect(file.session.items[0].audioNote).toBeUndefined();
    expect(file.session.items[0].imageData).toBeUndefined();
    expect(validateSandplayFile(file).ok).toBe(true);
  });

  it('includeAttachments=true 时保留 audioNote / imageData', () => {
    const session = buildSession({
      items: [item('i1', { audioNote: 'data:audio/webm;base64,AAA' })],
    });
    const file = toSandplayFile(session, { ...DEFAULT_EXPORT_OPTIONS, includeAttachments: true });
    expect(file.session.items[0].audioNote).toBe('data:audio/webm;base64,AAA');
  });

  it('includeThumbnail=false 时不导出缩略图', () => {
    const session = buildSession({ thumbnail: 'data:image/png;base64,AAAA' });
    const file = toSandplayFile(session, { ...DEFAULT_EXPORT_OPTIONS, includeThumbnail: false });
    expect(file.session.thumbnail).toBeUndefined();
  });

  it('includeEvents=false 时导出结果仍可被 fromSandplayFile 还原出 items', () => {
    const session = buildSession();
    const file = toSandplayFile(session, { ...DEFAULT_EXPORT_OPTIONS, includeEvents: false });
    const back = fromSandplayFile(file);
    expect(back.events).toEqual([]);
    expect(back.items).toEqual(session.items);
  });

  it('generateId 选项可以给导入的会话换一个新 id（避免覆盖本地同 id 会话）', () => {
    const file = toSandplayFile(buildSession());
    const back = fromSandplayFile(file, { generateId: () => 'fresh-id' });
    expect(back.id).toBe('fresh-id');
    expect(back.title).toBe('测试沙盘'); // 其余字段不受影响
  });

  it('导出文件带 stats 时不影响校验与往返', () => {
    const file = toSandplayFile(buildSession(), DEFAULT_EXPORT_OPTIONS, {
      itemCount: 2,
      durationMs: 3000,
    });
    expect(file.session.stats).toEqual({ itemCount: 2, durationMs: 3000 });
    expect(validateSandplayFile(file).ok).toBe(true);
  });

  it('导出的 producer 带 app 与 version（第三方工具据此识别）', () => {
    const file = toSandplayFile(buildSession());
    expect(file.producer.app).toBeTruthy();
    expect(file.producer.version).toBeTruthy();
    expect(file.format).toBe(SANDPAY_FORMAT);
    expect(file.version).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/*                        5. 迁移正确性（核心断言）                            */
/* -------------------------------------------------------------------------- */

describe('migrateSnapshot：v1 快照 -> v2 会话', () => {
  const legacy = {
    id: 'legacy-snap',
    at: '2025-11-11T11:11:11.000Z',
    title: '旧沙盘',
    sceneId: 'meadow',
    items: [
      { id: 'i1', symbolId: 'nature.tree', x: 0.3, y: 0.4, scale: 1, rotation: 0, z: 1 },
      { id: 'i2', symbolId: 'animal.dog', x: 0.65, y: 0.75, scale: 1.5, rotation: 30, z: 2 },
      { id: 'i3', symbolId: 'building.house', x: 0.5, y: 0.5, scale: 1, rotation: 0, z: 3 },
    ],
    reflection: '一段旧自述',
  };

  it('产出的会话是 schemaVersion 2 且保留 id / 时间 / 标题 / 场景', () => {
    const session = migrateSnapshot(legacy);
    expect(session.schemaVersion).toBe(2);
    expect(session.id).toBe('legacy-snap');
    expect(session.at).toBe('2025-11-11T11:11:11.000Z');
    expect(session.title).toBe('旧沙盘');
    expect(session.sceneId).toBe('meadow');
    expect(session.items).toHaveLength(3);
  });

  it('每个摆件都补了一条 item.add 事件（可回放的前提）', () => {
    const session = migrateSnapshot(legacy);
    const adds = session.events.filter((event) => event.type === 'item.add');
    expect(adds).toHaveLength(3);
    expect(adds.map((event) => event.itemId)).toEqual(['i1', 'i2', 'i3']);
  });

  it('补了 session.start 与 session.import 标记来源', () => {
    const session = migrateSnapshot(legacy);
    expect(session.events[0].type).toBe('session.start');
    const imported = session.events.find((event) => event.type === 'session.import');
    expect(imported).toBeDefined();
    expect(imported!.payload).toMatchObject({ from: 'sandbox-snapshot/v1' });
  });

  it('事件时间戳单调递增（否则时间轴会乱）', () => {
    const session = migrateSnapshot(legacy);
    const times = session.events.map((event) => event.t);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  /** ★ 迁移正确性的核心断言 ★ */
  it('【核心】迁移后的事件流 replayAll 结果与 items 完全一致', () => {
    const session = migrateSnapshot(legacy);
    const replayed = replayAll(session.events);
    expect(replayed.items).toHaveLength(session.items.length);
    expect(replayed.items).toEqual(session.items);
    // 场景也要能重放出来
    expect(replayed.sceneId).toBe('meadow');
  });

  it('迁移结果能通过 sandplay 校验（能直接导出成合法文件）', () => {
    const session = migrateSnapshot(legacy);
    const file = toSandplayFile(session);
    const result = validateSandplayFile(file);
    expect(result.ok).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('自述被迁移成 reflection.edit 事件（不只留在字段里）', () => {
    const session = migrateSnapshot(legacy);
    expect(session.reflection).toBe('一段旧自述');
    const edit = session.events.find((event) => event.type === 'reflection.edit');
    expect(edit).toBeDefined();
    expect(edit!.payload).toMatchObject({ text: '一段旧自述' });
  });

  it('缺字段的历史数据被宽松归一化，不抛错', () => {
    const messy = {
      items: [
        { symbolId: 'nature.tree' }, // 缺 id / x / y / scale
        { id: 'ok', symbolId: 'animal.cat', x: 5, y: -3, scale: 99, rotation: 0, z: 1 }, // 越界
        { id: 'bad-no-symbol' }, // 缺 symbolId -> 应被丢弃
        null, // 完全非法 -> 丢弃
        '字符串', // 丢弃
      ],
    };
    const session = migrateSnapshot(messy);
    // 3 个有效摆件（2 个补 id、1 个 ok；缺 symbolId 与非法项被丢）
    expect(session.items).toHaveLength(2);
    for (const entry of session.items) {
      expect(entry.x).toBeGreaterThanOrEqual(0);
      expect(entry.x).toBeLessThanOrEqual(1);
      expect(entry.y).toBeGreaterThanOrEqual(0);
      expect(entry.y).toBeLessThanOrEqual(1);
      expect(entry.scale).toBeLessThanOrEqual(4);
      expect(entry.symbolId).toBeTruthy();
    }
    // 归一化后仍然可重放且一致
    expect(replayAll(session.events).items).toEqual(session.items);
  });

  it('空 items 快照迁移后事件流为空 items（不崩）', () => {
    const session = migrateSnapshot({});
    expect(session.items).toEqual([]);
    expect(replayAll(session.events).items).toEqual([]);
  });

  it('非法 at 被替换为当前时间（不会把 NaN 时间写进数据）', () => {
    const session = migrateSnapshot({ items: [], at: '不是时间' });
    expect(Number.isNaN(Date.parse(session.at))).toBe(false);
  });

  it('缺 sceneId 时回落到 beach', () => {
    expect(migrateSnapshot({ items: [] }).sceneId).toBe('beach');
  });
});

/* -------------------------------------------------------------------------- */
/*                         6. coerceSession 分流                               */
/* -------------------------------------------------------------------------- */

describe('coerceSession：v2 原样 / v1 迁移 / 非法返回 null', () => {
  it('v2 会话原样保留（不重复迁移、不丢事件）', () => {
    const session = buildSession();
    const coerced = coerceSession(session);
    expect(coerced).not.toBeNull();
    expect(coerced!.id).toBe(session.id);
    expect(coerced!.events).toHaveLength(session.events.length);
    expect(coerced!.items).toEqual(session.items);
    expect(coerced!.schemaVersion).toBe(2);
  });

  it('v1 快照被迁移（补出事件流）', () => {
    const coerced = coerceSession({
      id: 'v1',
      at: '2025-01-01T00:00:00.000Z',
      items: [{ id: 'a', symbolId: 'nature.rock', x: 0.2, y: 0.2, scale: 1, rotation: 0, z: 1 }],
    });
    expect(coerced).not.toBeNull();
    expect(coerced!.schemaVersion).toBe(2);
    expect(coerced!.events.some((event) => event.type === 'item.add')).toBe(true);
    expect(replayAll(coerced!.events).items).toEqual(coerced!.items);
  });

  it('非法输入返回 null（不抛错）', () => {
    for (const bad of [null, undefined, 42, 'x', true, {}, { foo: 'bar' }]) {
      expect(coerceSession(bad)).toBeNull();
    }
  });

  it('v2 会话里脏事件被过滤（缺 t 的事件被丢掉）', () => {
    const coerced = coerceSession({
      schemaVersion: 2,
      mode: 'self',
      items: [],
      events: [
        { t: 0, type: 'session.start' },
        { type: 'item.add' }, // 缺 t -> 丢弃
        null,
        '字符串',
        { t: 100, type: 'session.save' },
      ],
    });
    expect(coerced!.events).toHaveLength(2);
    expect(coerced!.events.map((event) => event.type)).toEqual(['session.start', 'session.save']);
  });

  it('isLegacySnapshot 正确区分 v1 / v2', () => {
    expect(isLegacySnapshot({ items: [] })).toBe(true);
    expect(isLegacySnapshot({ items: [], events: [] })).toBe(false); // 有 events = v2
    expect(isLegacySnapshot({ schemaVersion: 2, items: [] })).toBe(false);
    expect(isLegacySnapshot(null)).toBe(false);
    expect(isLegacySnapshot('x')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*                          7. parseSandplayFile 容错                          */
/* -------------------------------------------------------------------------- */

describe('parseSandplayFile 文本解析容错', () => {
  it('非法 JSON 返回 ok:false 且 issues 说明原因', () => {
    const result = parseSandplayFile('{不是 JSON');
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe('$');
    expect(result.issues[0].message).toContain('JSON');
  });

  it('空字符串返回 ok:false 而不是抛错', () => {
    expect(() => parseSandplayFile('')).not.toThrow();
    expect(parseSandplayFile('').ok).toBe(false);
  });

  it('合法 JSON 但不是本格式时返回 ok:false 且指出 format 问题', () => {
    const result = parseSandplayFile(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'format')).toBe(true);
  });

  it('带 BOM 的 JSON 文本（HANDOVER §4.1 的真实事故来源）', () => {
    const text = '\uFEFF' + JSON.stringify(toSandplayFile(buildSession()));
    // JSON.parse 不接受 BOM，应当返回可读错误而不是抛异常
    expect(() => parseSandplayFile(text)).not.toThrow();
    const result = parseSandplayFile(text);
    // 记录当前行为：会解析失败（调用方应先 strip BOM）
    expect(result.ok).toBe(false);
  });
});
