import { describe, expect, it } from 'vitest';
import type { SandboxEvent, SandboxItem } from '@/lib/types';
import {
  applyEvent,
  canRedo,
  canUndo,
  createInitialState,
  createStack,
  isConsistent,
  makeEvent,
  pushEvent,
  redo,
  replay,
  replayAll,
  stateOf,
  undo,
} from '@/sandbox/events';

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

function buildEvents(): SandboxEvent[] {
  const events: SandboxEvent[] = [];
  events.push(makeEvent(events, 'session.start', { kind: 'session.start', sceneId: 'beach', mode: 'self' }, undefined, 0));
  events.push(makeEvent(events, 'item.add', { kind: 'item.add', item: item('a') }, 'a', 100));
  events.push(makeEvent(events, 'item.add', { kind: 'item.add', item: item('b', { x: 0.2 }) }, 'b', 200));
  events.push(makeEvent(events, 'item.move', { kind: 'item.move', x: 0.7, y: 0.3 }, 'a', 300));
  events.push(makeEvent(events, 'item.scale', { kind: 'item.scale', scale: 1.8 }, 'a', 400));
  events.push(makeEvent(events, 'item.rotate', { kind: 'item.rotate', rotation: 45 }, 'a', 500));
  events.push(makeEvent(events, 'item.note', { kind: 'item.note', note: '这是家' }, 'b', 600));
  events.push(makeEvent(events, 'item.remove', { kind: 'item.remove' }, 'b', 700));
  events.push(makeEvent(events, 'scene.change', { kind: 'scene.change', sceneId: 'night' }, undefined, 800));
  return events;
}

describe('applyEvent', () => {
  it('item.add 添加摆件并保持其他字段', () => {
    const state = applyEvent(createInitialState(), {
      t: 0,
      type: 'item.add',
      itemId: 'a',
      payload: { item: item('a') },
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0].symbolId).toBe('tree');
  });

  it('item.add 同 id 幂等（重放不重复）', () => {
    let state = createInitialState();
    const event: SandboxEvent = { t: 0, type: 'item.add', itemId: 'a', payload: { item: item('a') } };
    state = applyEvent(state, event);
    state = applyEvent(state, event);
    expect(state.items).toHaveLength(1);
  });

  it('缺少 itemId 的 move 被安全跳过', () => {
    const before = applyEvent(createInitialState(), {
      t: 0,
      type: 'item.add',
      itemId: 'a',
      payload: { item: item('a') },
    });
    const after = applyEvent(before, { t: 1, type: 'item.move', payload: { x: 0.9, y: 0.9 } });
    expect(after).toBe(before);
  });

  it('未知事件类型不抛错', () => {
    const state = createInitialState();
    const next = applyEvent(state, { t: 0, type: 'nonsense' as never });
    expect(next).toBe(state);
  });

  it('删除后重放不会残留', () => {
    const state = replayAll(buildEvents());
    expect(state.items.map((i) => i.id)).toEqual(['a']);
    expect(state.items[0].x).toBeCloseTo(0.7);
    expect(state.items[0].scale).toBeCloseTo(1.8);
    expect(state.items[0].rotation).toBe(45);
    expect(state.sceneId).toBe('night');
  });

  it('不含 NaN 的数值校验：错误类型被忽略', () => {
    let state = applyEvent(createInitialState(), {
      t: 0,
      type: 'item.add',
      itemId: 'a',
      payload: { item: item('a') },
    });
    state = applyEvent(state, { t: 1, type: 'item.move', itemId: 'a', payload: { x: 'bad', y: 0.3 } });
    expect(state.items[0].x).toBe(0.5);
  });
});

describe('replay 一致性', () => {
  it('重放结果等于逐步应用', () => {
    const events = buildEvents();
    const stepped = events.reduce((state, event) => applyEvent(state, event), createInitialState());
    const replayed = replayAll(events);
    expect(replayed.items).toEqual(stepped.items);
    expect(replayed.sceneId).toBe(stepped.sceneId);
  });

  it('分段重放与整段重放等价（时间轴拖动依赖这一点）', () => {
    const events = buildEvents();
    for (let i = 0; i <= events.length; i += 1) {
      const partial = replay(events, i);
      const manual = events.slice(0, i).reduce((state, event) => applyEvent(state, event), createInitialState());
      expect(partial.items).toEqual(manual.items);
    }
  });

  it('isConsistent 在一致时返回 true', () => {
    const events = buildEvents();
    const state = replayAll(events);
    expect(
      isConsistent({ items: state.items, events, sceneId: state.sceneId }),
    ).toBe(true);
  });

  it('isConsistent 在篡改 items 后返回 false', () => {
    const events = buildEvents();
    const state = replayAll(events);
    const tampered = state.items.map((it) => ({ ...it, x: 0.1 }));
    expect(isConsistent({ items: tampered, events, sceneId: state.sceneId })).toBe(false);
  });
});

describe('撤销 / 重做', () => {
  it('undo 后状态回退，redo 后恢复', () => {
    const events = buildEvents();
    const stack = createStack(events);
    const full = stateOf(stack);

    const undone = undo(stack);
    expect(canRedo(undone)).toBe(true);
    expect(stateOf(undone).sceneId).toBe('beach');

    const redone = redo(undone);
    expect(stateOf(redone).items).toEqual(full.items);
  });

  it('连续 undo 到起点后不再变化', () => {
    let stack = createStack(buildEvents());
    while (canUndo(stack)) stack = undo(stack);
    expect(stack.cursor).toBe(0);
    expect(undo(stack)).toBe(stack);
  });

  it('在撤销后新增操作会丢弃未来事件（分叉）', () => {
    const events = buildEvents();
    let stack = createStack(events);
    // 撤销到 b 被移除之前（此时 b 还在）
    stack = undo(stack);
    stack = undo(stack);
    expect(stateOf(stack).items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(canRedo(stack)).toBe(true);

    const branch = makeEvent(stack.events, 'item.add', { kind: 'item.add', item: item('c') }, 'c', 900);
    stack = pushEvent(stack, branch);
    expect(canRedo(stack)).toBe(false);
    expect(stateOf(stack).items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('makeEvent', () => {
  it('省略 t 时单调递增', () => {
    const events: SandboxEvent[] = [];
    const first = makeEvent(events, 'session.save', { kind: 'session.save' });
    events.push(first);
    const second = makeEvent(events, 'session.lock', { kind: 'session.lock' });
    expect(second.t).toBeGreaterThan(first.t);
  });

  it('payload 中的 kind 判别字段不被写入', () => {
    const event = makeEvent([], 'item.note', { kind: 'item.note', note: 'x' }, 'a', 5);
    expect(event.payload).toEqual({ note: 'x' });
  });
});
