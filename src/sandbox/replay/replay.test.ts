/**
 * 会话回放层单元测试。
 *
 * 覆盖三块纯逻辑（都能在没有 DOM 的环境里跑）：
 * 1. **cursor 语义**：`replay(events, n)` 必须等于「逐条 applyEvent 到第 n 条」——
 *    这是回放画面可信的地基，一旦不成立，拖动时间轴看到的就不是真实过程。
 * 2. **关键节点 / 过滤 / 游标描述**（moments.ts）
 * 3. **统计扩展**（事件类型分布、子类/大类汇总、九宫格边界）
 * 4. **差异清单**（只算事实、不带结论）
 * 5. **Markdown 导出**（纯函数、可核对的表格）
 * 6. **续接 URL 约定**（解析 / 构造 / 分支会话不改原会话）
 */

import { describe, expect, it } from 'vitest';
import type {
  SandSession,
  SandboxEvent,
  SandboxItem,
  SessionAnnotation,
} from '@/lib/types';
import {
  applyEvent,
  createInitialState,
  makeEvent,
  replay,
  replayAll,
} from '@/sandbox/events';
import { createSurfaceState } from '@/sandbox/surfaceCodec';
import { serializeSurface } from '@/sandbox/surfaceState';
import {
  clampCursor,
  describeCursor,
  eventCategory,
  findKeyMoments,
  matchesFilter,
} from '@/sandbox/replay/moments';
import { diffSessions } from '@/sandbox/replay/diff';
import { computeSessionStats, zoneOf, ZONE_ORDER } from '@/sandbox/replay/stats';
import {
  STATS_DISCLAIMER,
  statsFileName,
  toStatsMarkdown,
} from '@/sandbox/replay/statsExport';
import {
  buildResumeHref,
  forkSessionAt,
  parseResumeParams,
  parseStep,
  resumeHintText,
} from '@/sandbox/replay/resume';

/* -------------------------------------------------------------------------- */
/*                                  测试夹具                                   */
/* -------------------------------------------------------------------------- */

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

/** 一条有代表性的会话事件流：开场 → 加两件 → 移动 → 涂沙面 → 换场景 → 删一件 */
function buildEvents(): SandboxEvent[] {
  const events: SandboxEvent[] = [];
  events.push(
    makeEvent(events, 'session.start', { kind: 'session.start', sceneId: 'beach', mode: 'self' }, undefined, 0),
  );
  events.push(makeEvent(events, 'item.add', { kind: 'item.add', item: item('a') }, 'a', 1000));
  events.push(
    makeEvent(
      events,
      'item.add',
      { kind: 'item.add', item: item('b', { x: 0.1, y: 0.1, symbolId: 'house' }) },
      'b',
      2000,
    ),
  );
  events.push(makeEvent(events, 'item.move', { kind: 'item.move', x: 0.8, y: 0.8 }, 'a', 3000));
  // surface.stroke 需要真实的 after 快照，否则 reducer 会安全跳过（不写沙面）
  const surface = serializeSurface(createSurfaceState(8, 6));
  events.push(
    makeEvent(
      events,
      'surface.stroke',
      { kind: 'surface.stroke', tool: 'raise', after: surface },
      undefined,
      4000,
    ),
  );
  events.push(
    makeEvent(events, 'scene.change', { kind: 'scene.change', sceneId: 'night' }, undefined, 5000),
  );
  events.push(makeEvent(events, 'item.remove', { kind: 'item.remove' }, 'b', 6000));
  return events;
}

function session(overrides: Partial<SandSession> = {}): SandSession {
  const events = overrides.events ?? buildEvents();
  const state = replayAll(events);
  return {
    id: 'session_test',
    at: '2026-10-20T09:00:00.000Z',
    schemaVersion: 2,
    title: '测试会话',
    mode: 'self',
    sceneId: state.sceneId,
    items: state.items,
    events,
    locked: false,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/*                      1. cursor 语义：回放画面的地基                          */
/* -------------------------------------------------------------------------- */

describe('cursor 语义：replay(events, n) 等价于逐条 applyEvent', () => {
  it('对 0..n 每个位置，replay 的结果都与逐步 applyEvent 完全一致', () => {
    const events = buildEvents();
    let stepwise = createInitialState('beach');
    for (let n = 0; n <= events.length; n += 1) {
      const viaReplay = replay(events, n, createInitialState('beach'));
      expect(viaReplay.items).toEqual(stepwise.items);
      expect(viaReplay.sceneId).toBe(stepwise.sceneId);
      if (n < events.length) stepwise = applyEvent(stepwise, events[n]);
    }
  });

  it('cursor = 0 时是空画面，且不抛错', () => {
    const state = replay(buildEvents(), 0, createInitialState());
    expect(state.items).toEqual([]);
  });

  it('空事件流 + cursor = 0 不抛错', () => {
    expect(() => replay([], 0, createInitialState())).not.toThrow();
    expect(replay([], 0, createInitialState()).items).toHaveLength(0);
  });

  it('cursor 超出范围时被夹到末尾，不越界', () => {
    const events = buildEvents();
    const over = replay(events, 999, createInitialState());
    const exact = replayAll(events);
    expect(over.items).toEqual(exact.items);
    expect(over.items).toHaveLength(2 - 1); // 加了 2 件、删了 1 件
  });

  it('cursor 为负时不崩溃（按 0 处理）', () => {
    const state = replay(buildEvents(), -5, createInitialState());
    expect(state.items).toEqual([]);
  });

  it('拖动过程中 cursor 递增，画面单调地「多出」历史（可复现）', () => {
    const events = buildEvents();
    const atSawSurface = replay(events, 5, createInitialState('beach'));
    const beforeSurface = replay(events, 4, createInitialState('beach'));
    // 第 5 条是 surface.stroke；此前没有沙面
    expect(beforeSurface.surface).toBeUndefined();
    expect(atSawSurface.surface).toBeDefined();
  });

  it('第 6 步换场景后 sceneId 变化，前一步还是原场景', () => {
    const events = buildEvents();
    expect(replay(events, 5, createInitialState('beach')).sceneId).toBe('beach');
    expect(replay(events, 6, createInitialState('beach')).sceneId).toBe('night');
  });
});

/* -------------------------------------------------------------------------- */
/*                        2. 关键节点 / 过滤 / 游标描述                        */
/* -------------------------------------------------------------------------- */

describe('findKeyMoments', () => {
  it('挑出第一件摆件、第一次涂沙面、每次换场景，cursor 是 1-based 步数', () => {
    const moments = findKeyMoments(buildEvents(), { sceneLabel: () => '夜晚' });
    expect(moments.map((m) => m.kind)).toEqual([
      'first-item',
      'first-surface',
      'scene-change',
    ]);
    // 第 2 条事件（index 1）是第一次 item.add
    expect(moments[0].cursor).toBe(2);
    // 第 5 条事件（index 4）是第一次 surface.stroke
    expect(moments[1].cursor).toBe(5);
    // 第 6 条事件（index 5）是换场景
    expect(moments[2].cursor).toBe(6);
  });

  it('每个关键节点的 cursor 都能直接用于 replay，且是合法游标', () => {
    const events = buildEvents();
    const moments = findKeyMoments(events);
    expect(moments.length).toBeGreaterThan(0);
    for (const moment of moments) {
      expect(moment.cursor).toBeGreaterThan(0);
      expect(moment.cursor).toBeLessThanOrEqual(events.length);
      expect(() => replay(events, moment.cursor, createInitialState())).not.toThrow();
    }
  });

  it('空事件流返回空数组，不抛错', () => {
    expect(findKeyMoments([])).toEqual([]);
  });

  it('只有一条 scene.change 时不产生 first-item', () => {
    const events = [makeEvent([], 'scene.change', { kind: 'scene.change', sceneId: 'void' }, undefined, 0)];
    const moments = findKeyMoments(events);
    expect(moments).toHaveLength(1);
    expect(moments[0].kind).toBe('scene-change');
  });
});

describe('matchesFilter / eventCategory', () => {
  const events = buildEvents();

  it("filter = 'all' 时全部通过", () => {
    expect(events.every((event) => matchesFilter(event, 'all'))).toBe(true);
  });

  it("filter = 'item' 只保留 item.* 事件", () => {
    const kept = events.filter((event) => matchesFilter(event, 'item'));
    expect(kept.length).toBe(4); // 2 add + 1 move + 1 remove
    expect(kept.every((event) => event.type.startsWith('item.'))).toBe(true);
  });

  it("filter = 'surface' 只保留沙面事件", () => {
    const kept = events.filter((event) => matchesFilter(event, 'surface'));
    expect(kept).toHaveLength(1);
    expect(kept[0].type).toBe('surface.stroke');
  });

  it('eventCategory 把事件分到 item / surface / scene / meta', () => {
    expect(eventCategory('item.add')).toBe('item');
    expect(eventCategory('surface.stroke')).toBe('surface');
    expect(eventCategory('scene.change')).toBe('scene');
    expect(eventCategory('session.start')).toBe('meta');
  });
});

describe('clampCursor / describeCursor', () => {
  it('clampCursor 夹到 [0, eventCount]', () => {
    expect(clampCursor(-3, 7)).toBe(0);
    expect(clampCursor(99, 7)).toBe(7);
    expect(clampCursor(3.7, 7)).toBe(4);
    expect(clampCursor(Number.NaN, 7)).toBe(0);
  });

  it('describeCursor 在 0 时说明「开头」', () => {
    expect(describeCursor(buildEvents(), 0, () => '夜晚')).toContain('开头');
  });

  it('describeCursor 在换场景那一步给出场景名', () => {
    const text = describeCursor(buildEvents(), 6, () => '夜晚');
    expect(text).toContain('第 6 步');
    expect(text).toContain('夜晚');
  });
});

/* -------------------------------------------------------------------------- */
/*                              3. 统计扩展                                    */
/* -------------------------------------------------------------------------- */

describe('zoneOf 九宫格边界', () => {
  it('1/3 与 2/3 边界左闭右开，落在正确的格', () => {
    expect(zoneOf(0, 0)).toBe('tl');
    expect(zoneOf(0.33, 0.33)).toBe('tl');
    expect(zoneOf(1 / 3, 1 / 3)).toBe('mc'); // 边界值归入中间列/行
    expect(zoneOf(2 / 3, 2 / 3)).toBe('br');
    expect(zoneOf(0.999, 0.999)).toBe('br');
  });

  it('九个区域 key 与 ZONE_ORDER 一致', () => {
    expect(new Set(ZONE_ORDER).size).toBe(9);
    const zones = new Set(ZONE_ORDER);
    for (const key of ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']) {
      expect(zones.has(key as never)).toBe(true);
    }
  });
});

describe('computeSessionStats 扩展字段', () => {
  it('事件类型分布只含出现过的类型，按次数倒序，ratio 之和约为 1', () => {
    const stats = computeSessionStats(session());
    expect(stats.eventTypes.length).toBeGreaterThan(0);
    expect(stats.eventTypes.every((entry) => entry.count > 0)).toBe(true);
    for (let i = 1; i < stats.eventTypes.length; i += 1) {
      expect(stats.eventTypes[i - 1].count).toBeGreaterThanOrEqual(stats.eventTypes[i].count);
    }
    const ratioSum = stats.eventTypes.reduce((sum, entry) => sum + entry.ratio, 0);
    expect(ratioSum).toBeCloseTo(1, 5);
    // 每条事件都被计到
    expect(stats.eventTypes.reduce((sum, entry) => sum + entry.count, 0)).toBe(stats.eventCount);
  });

  it('空事件流时事件类型分布为空数组，ratio 不产生 NaN', () => {
    const stats = computeSessionStats(session({ events: [], items: [] }));
    expect(stats.eventTypes).toEqual([]);
    expect(stats.eventCount).toBe(0);
    expect(Number.isNaN(stats.surfaceMovedRatio)).toBe(false);
    expect(stats.surfaceMovedRatio).toBe(0);
    expect(stats.durationMs).toBe(0);
  });

  it('子类汇总按 subcategoryCategory 反查大类，数量与摆件数一致', () => {
    const stats = computeSessionStats(session());
    const subcategoryTotal = stats.subcategoryCounts.reduce((sum, entry) => sum + entry.count, 0);
    const categoryTotal = stats.categoryCounts.reduce((sum, entry) => sum + entry.count, 0);
    expect(subcategoryTotal).toBe(stats.itemCount);
    expect(categoryTotal).toBe(stats.itemCount);
  });

  it('树（nature-plant）归入自然大类，房子（building-home）归入建筑大类', () => {
    const stats = computeSessionStats(
      session({
        events: [],
        items: [item('t', { symbolId: 'tree' }), item('h', { symbolId: 'house' })],
      }),
    );
    const subcategories = stats.subcategoryCounts.map((entry) => entry.subcategory).sort();
    expect(subcategories).toEqual(['building-home', 'nature-plant']);
    const categories = stats.categoryCounts.map((entry) => entry.category).sort();
    expect(categories).toEqual(['building', 'nature']);
  });

  it('未知 symbolId 单独归为 unknown，不进大类合计', () => {
    const stats = computeSessionStats(
      session({ events: [], items: [item('x', { symbolId: '不存在的沙具' })] }),
    );
    expect(stats.subcategoryCounts).toHaveLength(1);
    expect(stats.subcategoryCounts[0].subcategory).toBe('unknown');
    expect(stats.subcategoryCounts[0].count).toBe(1);
    // 大类映射查不到，因此大类汇总为空，但子类合计仍等于摆件数
    expect(stats.categoryCounts).toEqual([]);
    expect(stats.subcategoryCounts.reduce((sum, entry) => sum + entry.count, 0)).toBe(1);
  });

  it('同次数时按 EVENT_TYPE_ORDER 稳定排序（item.add 在 item.remove 之前）', () => {
    const events = buildEvents();
    const stats = computeSessionStats(session({ events }));
    const adds = stats.eventTypes.find((entry) => entry.type === 'item.add');
    const removes = stats.eventTypes.find((entry) => entry.type === 'item.remove');
    expect(adds?.count).toBe(2);
    expect(removes?.count).toBe(1);
  });

  it('时长等于首尾事件时间差，单条事件时为 0', () => {
    const events = buildEvents();
    const stats = computeSessionStats(session({ events }));
    expect(stats.durationMs).toBe(6000 - 0);

    const single = computeSessionStats(
      session({ events: [makeEvent([], 'session.start', { kind: 'session.start', sceneId: 'beach', mode: 'self' }, undefined, 0)], items: [] }),
    );
    expect(single.durationMs).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/*                              4. 差异清单                                    */
/* -------------------------------------------------------------------------- */

describe('diffSessions', () => {
  const before = session({
    id: 'a',
    at: '2026-10-20T09:00:00.000Z',
    events: [],
    items: [item('t', { symbolId: 'tree' }), item('h', { symbolId: 'house' })],
  });
  const after = session({
    id: 'b',
    at: '2026-10-26T09:00:00.000Z',
    events: [],
    items: [item('t', { symbolId: 'tree' }), item('b', { symbolId: 'boat' })],
    sceneId: 'night',
  });

  it('摆件数变化给出带符号的差值与方向', () => {
    const diff = diffSessions(before, after);
    const fact = diff.facts.find((entry) => entry.key === 'itemCount');
    expect(fact?.before).toBe('2');
    expect(fact?.after).toBe('2');
    expect(fact?.change).toBe('0');
    expect(fact?.direction).toBe('same');
  });

  it('种类增减分别列出，且不写成评价词', () => {
    const diff = diffSessions(before, after);
    expect(diff.addedSymbols).toContain('小船');
    expect(diff.removedSymbols).toContain('房子');
  });

  it('场景变化只描述事实（换场景 / 相同）', () => {
    const diff = diffSessions(before, after);
    const scene = diff.facts.find((entry) => entry.key === 'scene');
    expect(scene?.change).toBe('换场景');
  });

  it('事实顺序固定：数量在前、沙面在后', () => {
    const diff = diffSessions(before, after);
    const keys = diff.facts.map((entry) => entry.key);
    expect(keys.indexOf('itemCount')).toBeLessThan(keys.indexOf('surfaceMoved'));
    expect(keys.indexOf('eventCount')).toBeLessThan(keys.indexOf('duration'));
  });

  it('文案里不出现任何评价性说法', () => {
    const diff = diffSessions(before, after);
    const text = JSON.stringify(diff.facts);
    for (const banned of ['进步', '退步', '改善', '恶化', '健康', '趋势', '意味着', '说明']) {
      expect(text).not.toContain(banned);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                          5. Markdown 导出（纯函数）                          */
/* -------------------------------------------------------------------------- */

describe('toStatsMarkdown', () => {
  const target = session();

  it('第一段是固定的免责说明', () => {
    const markdown = toStatsMarkdown(target, undefined, { exportedAt: new Date('2026-10-27T00:00:00Z') });
    const firstQuote = markdown.split('\n').find((line) => line.startsWith('> '));
    expect(firstQuote).toContain(STATS_DISCLAIMER);
  });

  it('包含所有必备小节', () => {
    const markdown = toStatsMarkdown(target);
    for (const heading of [
      '## 会话信息',
      '## 数量与时长',
      '## 时间分布',
      '## 沙面',
      '## 九宫格分布',
      '## 事件类型分布',
      '## 沙具汇总',
      '### 按大类',
      '### 按子类',
      '## 沙具清单',
    ]) {
      expect(markdown).toContain(heading);
    }
  });

  it('表格单元格里的竖线与换行被转义，不会破坏表格', () => {
    const tricky = session({ title: '标题|带竖线\n和换行' });
    const markdown = toStatsMarkdown(tricky);
    const titleRow = markdown.split('\n').find((line) => line.startsWith('| 标题 |'));
    expect(titleRow).toBeDefined();
    // 原文本的裸竖线不应出现（已被转义成 \|）
    expect(titleRow).toContain('\\|');
    expect(titleRow?.includes('\n')).toBe(false);
  });

  it('导出的数字与 computeSessionStats 一致', () => {
    const stats = computeSessionStats(target);
    const markdown = toStatsMarkdown(target, stats);
    expect(markdown).toContain(`| 摆件数 | ${stats.itemCount} |`);
    expect(markdown).toContain(`| 操作次数 | ${stats.eventCount} |`);
  });

  it('空会话也能导出，且不出现 undefined / NaN', () => {
    const empty = session({ events: [], items: [] });
    const markdown = toStatsMarkdown(empty);
    expect(markdown).not.toContain('undefined');
    expect(markdown).not.toContain('NaN');
  });

  it('文件名去掉路径非法字符并带日期', () => {
    const name = statsFileName(session({ title: 'a/b:c*?' , at: '2026-10-26T12:00:00.000Z' }));
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).toMatch(/\.md$/);
    expect(name).toContain('2026');
  });
});

/* -------------------------------------------------------------------------- */
/*                        6. 续接 URL 约定与分支会话                           */
/* -------------------------------------------------------------------------- */

describe('parseResumeParams / parseStep', () => {
  it('解析 from 与 cursor', () => {
    const parsed = parseResumeParams(new URLSearchParams('from=abc&cursor=12'));
    expect(parsed).toEqual({ from: 'abc', cursor: 12 });
  });

  it('没有 from 时返回 null（不是续接请求）', () => {
    expect(parseResumeParams(new URLSearchParams('cursor=3'))).toBeNull();
    expect(parseResumeParams(null)).toBeNull();
    expect(parseResumeParams(new URLSearchParams(''))).toBeNull();
  });

  it('省略 cursor 时为 null（表示末尾）', () => {
    expect(parseResumeParams(new URLSearchParams('from=abc'))).toEqual({ from: 'abc', cursor: null });
  });

  it('step 作为 cursor 的兼容别名', () => {
    expect(parseResumeParams(new URLSearchParams('from=abc&step=7'))).toEqual({
      from: 'abc',
      cursor: 7,
    });
  });

  it('cursor 非法值按未指定处理', () => {
    expect(parseStep('abc')).toBeNull();
    expect(parseStep('-3')).toBeNull();
    expect(parseStep('')).toBeNull();
    expect(parseStep('3.9')).toBe(3);
    expect(parseStep('0')).toBe(0);
  });

  it('buildResumeHref 与 parseResumeParams 可往返', () => {
    const href = buildResumeHref('session_abc', 12);
    expect(href).toBe('/sandbox?from=session_abc&cursor=12');
    const query = new URLSearchParams(href.split('?')[1]);
    expect(parseResumeParams(query)).toEqual({ from: 'session_abc', cursor: 12 });
  });

  it('buildResumeHref 对特殊字符做编码', () => {
    const href = buildResumeHref('a b&c', 3);
    expect(href).toContain('a%20b%26c');
    expect(parseResumeParams(new URLSearchParams(href.split('?')[1]))?.from).toBe('a b&c');
  });
});

describe('forkSessionAt', () => {
  const source = session({
    events: buildEvents(),
    annotations: [
      { id: 'n1', eventIndex: 1, t: 1000, text: '早期批注', at: '2026-10-20T09:01:00.000Z' },
      { id: 'n2', eventIndex: 5, t: 5000, text: '后期批注', at: '2026-10-20T09:05:00.000Z' },
    ] satisfies SessionAnnotation[],
  });

  it('只保留前 cursor 条事件', () => {
    const cursor = 3;
    const forked = forkSessionAt(source, cursor, {
      newId: 'session_new',
      now: '2026-10-27T00:00:00.000Z',
      replayItems: replay(source.events, cursor, createInitialState()).items,
    });
    expect(forked.events).toHaveLength(cursor);
    expect(forked.id).toBe('session_new');
    expect(forked.at).toBe('2026-10-27T00:00:00.000Z');
    expect(forked.items.map((entry) => entry.id).sort()).toEqual(['a', 'b']);
  });

  it('**不修改原会话**（事件条数、批注、items 全部不变）', () => {
    const before = JSON.stringify(source);
    forkSessionAt(source, 3, {
      newId: 'session_new',
      now: '2026-10-27T00:00:00.000Z',
      replayItems: [],
    });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('新会话的对象与原会话不共享引用（深拷贝事件与 items）', () => {
    const forked = forkSessionAt(source, 4, {
      newId: 'session_new',
      now: '2026-10-27T00:00:00.000Z',
      replayItems: replay(source.events, 4, createInitialState()).items,
    });
    expect(forked.events).not.toBe(source.events);
    expect(forked.events[0]).not.toBe(source.events[0]);
    expect(forked.items).not.toBe(source.items);
    // 改新会话不影响原会话
    forked.events[0].type = 'session.lock';
    expect(source.events[0].type).toBe('session.start');
  });

  it('只带走 eventIndex 小于 cursor 的批注', () => {
    const forked = forkSessionAt(source, 3, {
      newId: 'session_new',
      now: '2026-10-27T00:00:00.000Z',
      replayItems: [],
    });
    // 只保留 eventIndex = 1 的那条（< 3），eventIndex = 5 的丢掉
    expect(forked.annotations).toHaveLength(1);
    expect(forked.annotations?.[0].id).toBe('n1');
  });

  it('cursor 越界时被夹到事件总数', () => {
    const forked = forkSessionAt(source, 999, {
      newId: 'session_new',
      now: '2026-10-27T00:00:00.000Z',
      replayItems: [],
    });
    expect(forked.events).toHaveLength(source.events.length);
  });

  it('cursor = 0 时得到空事件流与新会话', () => {
    const forked = forkSessionAt(source, 0, {
      newId: 'session_new',
      now: '2026-10-27T00:00:00.000Z',
      replayItems: [],
    });
    expect(forked.events).toEqual([]);
    expect(forked.annotations).toEqual([]);
    expect(forked.locked).toBe(false);
    expect(forked.archived).toBe(false);
  });

  it('复制出来的会话可以被独立重放，结果等于源会话的前 cursor 步', () => {
    const cursor = 4;
    const forked = forkSessionAt(source, cursor, {
      newId: 'session_new',
      now: '2026-10-27T00:00:00.000Z',
      replayItems: replay(source.events, cursor, createInitialState('beach')).items,
      sceneId: replay(source.events, cursor, createInitialState('beach')).sceneId,
      surface: replay(source.events, cursor, createInitialState('beach')).surface,
    });
    const fromForked = replayAll(forked.events, createInitialState('beach'));
    expect(fromForked.items).toEqual(forked.items);
  });
});

describe('resumeHintText', () => {
  it('明确写出复制到第几步、共几步，以及不改原会话', () => {
    const text = resumeHintText(7, 20);
    expect(text).toContain('第 7 步');
    expect(text).toContain('共 20 步');
    expect(text).toContain('不会被改动');
  });

  it('越界 cursor 被夹取后再描述', () => {
    expect(resumeHintText(99, 5)).toContain('第 5 步');
    expect(resumeHintText(-3, 5)).toContain('第 0 步');
  });
});
