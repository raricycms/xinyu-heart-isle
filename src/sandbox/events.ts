/**
 * 心屿 · 沙盘事件流引擎
 *
 * 一个事件 = 一次可重放的变更。所有变更都走这里，因此：
 * - 撤销/重做 = 移动事件指针 + 重放；
 * - 时间轴回放 = 从 0 重放到任意序号；
 * - 客观统计 = 从事件流计算，而不是从最终画面猜；
 * - 一致性 = 「重放事件」必须等于「当前 items」（测试保证）。
 *
 * 设计约束：
 * 1. **纯函数**：本文件不接触 DOM / 存储 / React，便于单元测试。
 * 2. **不可变**：reducer 返回新对象，不修改入参。
 * 3. **可校验**：`assertConsistent` 用于开发期与测试断言。
 */

import type {
  SandboxEvent,
  SandboxEventType,
  SandboxItem,
  SandSurface,
  SessionPhase,
} from '@/lib/types';

/** 重放所需的完整状态（会话中所有「可被事件改变」的部分） */
export interface SandboxState {
  items: SandboxItem[];
  sceneId: string;
  surface?: SandSurface;
  phase?: SessionPhase;
  locked: boolean;
  reflection?: string;
  annotations: Array<{ id: string; eventIndex: number; t: number; text: string }>;
}

/** 场景 id 常量（与 sandbox/scenes.ts 的 id 对齐，避免循环依赖） */
export const DEFAULT_SCENE = 'beach';

export function createInitialState(sceneId: string = DEFAULT_SCENE): SandboxState {
  return {
    items: [],
    sceneId,
    surface: undefined,
    phase: 'intro',
    locked: false,
    reflection: undefined,
    annotations: [],
  };
}

/* -------------------------------------------------------------------------- */
/*                              载荷类型（白名单）                              */
/* -------------------------------------------------------------------------- */

/**
 * 事件载荷形状。用可辨识联合保证「写出的事件一定可被正确重放」。
 * 注意：`payload` 在持久化时是 `Record<string, unknown>`，
 * 写入端请优先使用下面的 `makeEvent` 构造器以获得类型安全。
 */
export type EventPayload =
  | { kind: 'item.add'; item: SandboxItem }
  | { kind: 'item.move'; x: number; y: number }
  | { kind: 'item.scale'; scale: number }
  | { kind: 'item.rotate'; rotation: number }
  | { kind: 'item.remove' }
  | { kind: 'item.note'; note?: string }
  | { kind: 'item.affect'; affectLabels: string[] }
  | { kind: 'item.layer'; z: number }
  | { kind: 'item.bury'; burial: number }
  | { kind: 'scene.change'; sceneId: string }
  | { kind: 'surface.stroke'; tool: string; before?: SandSurface; after: SandSurface }
  | { kind: 'surface.reset' }
  | { kind: 'session.start'; sceneId: string; mode: string }
  | { kind: 'session.phase'; phase: SessionPhase }
  | { kind: 'session.lock' }
  | { kind: 'session.save'; title?: string }
  | { kind: 'session.import'; from?: string }
  | { kind: 'annotation.add'; id: string; eventIndex: number; text: string }
  | { kind: 'reflection.edit'; text: string };

/** 事件条数上限：超过后合并同类事件，避免本地存储无限增长 */
export const MAX_EVENTS = 4000;

/* -------------------------------------------------------------------------- */
/*                                   重放                                     */
/* -------------------------------------------------------------------------- */

function cloneItem(item: SandboxItem): SandboxItem {
  return { ...item };
}

/**
 * 重放器的内部累加器。
 *
 * 为什么需要它：`applyEvent` 为了 React 的引用比较必须是纯函数，
 * 于是 `item.add` 只能写 `{ ...state, items: [...state.items, item] }` ——
 * **每次 add 都全量复制 items 数组**，重放 N 条 add 就是 O(n²)
 * （4000 条实测 53ms，且随事件数翻倍变 4 倍）。
 *
 * 重放是纯内部过程，中间状态不会外泄，所以这里允许**就地修改**：
 * - `items` + `index` 构成可变累加器，add 走 O(1) push / O(1) 覆盖；
 * - 结束时**只复制一次**数组返回。
 *
 * 语义完全由 `applyEvent` 单点定义（`mutate: true` 走就地分支，
 * 其余分支已返回新对象），不存在两套逻辑走偏的风险。
 */
interface ReplayDraft {
  state: SandboxState;
  /** id -> items 下标，用于 O(1) 覆盖 */
  index: Map<string, number>;
  /** items 是否被就地改过（决定末尾要不要复制） */
  mutated: boolean;
}

function beginDraft(initial: SandboxState): ReplayDraft {
  return {
    state: initial,
    index: new Map(initial.items.map((item, i) => [item.id, i])),
    mutated: false,
  };
}

/**
 * 应用一条事件，返回新状态。
 * 遇到未知类型或缺失 itemId 时**安全跳过**（历史数据容错），不抛错。
 *
 * `draft` 仅供 `replay` 内部使用：传入时 `item.add` 就地修改 items，
 * 换取线性复杂度。外部调用不传，得到与旧实现完全一致的纯函数行为。
 */
export function applyEvent(
  state: SandboxState,
  event: SandboxEvent,
  draft?: ReplayDraft,
): SandboxState {
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  switch (event.type) {
    case 'item.add': {
      const item = payload.item as SandboxItem | undefined;
      if (!item || typeof item.id !== 'string') return state;

      if (draft) {
        const at = draft.index.get(item.id);
        if (at === undefined) {
          // 快路径：新 id，直接追加
          draft.index.set(item.id, state.items.length);
          state.items.push(cloneItem(item));
        } else {
          // 同 id 覆盖，保证重放幂等
          state.items[at] = cloneItem(item);
        }
        draft.mutated = true;
        return state;
      }

      // 同 id 覆盖，保证重放幂等
      const nextItems = state.items.filter((it) => it.id !== item.id);
      nextItems.push(cloneItem(item));
      return { ...state, items: nextItems };
    }

    case 'item.move': {
      if (!event.itemId) return state;
      const x = num(payload.x);
      const y = num(payload.y);
      if (x === undefined || y === undefined) return state;
      return {
        ...state,
        items: state.items.map((it) => (it.id === event.itemId ? { ...it, x, y } : it)),
      };
    }

    case 'item.scale': {
      if (!event.itemId) return state;
      const scale = num(payload.scale);
      if (scale === undefined) return state;
      return {
        ...state,
        items: state.items.map((it) => (it.id === event.itemId ? { ...it, scale } : it)),
      };
    }

    case 'item.rotate': {
      if (!event.itemId) return state;
      const rotation = num(payload.rotation);
      if (rotation === undefined) return state;
      return {
        ...state,
        items: state.items.map((it) => (it.id === event.itemId ? { ...it, rotation } : it)),
      };
    }

    case 'item.remove': {
      if (!event.itemId) return state;
      return { ...state, items: state.items.filter((it) => it.id !== event.itemId) };
    }

    case 'item.note': {
      if (!event.itemId) return state;
      const note = typeof payload.note === 'string' ? payload.note : undefined;
      return {
        ...state,
        items: state.items.map((it) => (it.id === event.itemId ? { ...it, note } : it)),
      };
    }

    case 'item.affect': {
      if (!event.itemId) return state;
      const labels = Array.isArray(payload.affectLabels)
        ? (payload.affectLabels as string[]).filter((s) => typeof s === 'string')
        : [];
      return {
        ...state,
        items: state.items.map((it) =>
          it.id === event.itemId ? { ...it, affectLabels: labels.length ? labels : undefined } : it,
        ),
      };
    }

    case 'item.layer': {
      if (!event.itemId) return state;
      const z = num(payload.z);
      if (z === undefined) return state;
      return {
        ...state,
        items: state.items.map((it) => (it.id === event.itemId ? { ...it, z } : it)),
      };
    }

    case 'item.bury': {
      if (!event.itemId) return state;
      const burial = num(payload.burial);
      if (burial === undefined) return state;
      return {
        ...state,
        items: state.items.map((it) => (it.id === event.itemId ? { ...it, burial } : it)),
      };
    }

    case 'scene.change': {
      const sceneId = typeof payload.sceneId === 'string' ? payload.sceneId : undefined;
      if (!sceneId) return state;
      return { ...state, sceneId };
    }

    case 'surface.stroke':
    case 'surface.reset': {
      if (event.type === 'surface.reset') return { ...state, surface: undefined };
      const after = payload.after as SandSurface | undefined;
      if (!after || typeof after.height !== 'string') return state;
      return { ...state, surface: after };
    }

    case 'session.start': {
      const sceneId = typeof payload.sceneId === 'string' ? payload.sceneId : state.sceneId;
      return { ...state, sceneId };
    }

    case 'session.phase': {
      const phase = payload.phase as SessionPhase | undefined;
      if (!phase) return state;
      return { ...state, phase };
    }

    case 'session.lock': {
      return { ...state, locked: true };
    }

    case 'session.save':
    case 'session.import': {
      return state;
    }

    case 'annotation.add': {
      const id = typeof payload.id === 'string' ? payload.id : undefined;
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (!id) return state;
      const eventIndex = num(payload.eventIndex) ?? 0;
      return {
        ...state,
        annotations: [...state.annotations, { id, eventIndex, t: event.t, text }],
      };
    }

    case 'reflection.edit': {
      const text = typeof payload.text === 'string' ? payload.text : undefined;
      return { ...state, reflection: text };
    }

    default:
      return state;
  }
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 从初始状态重放前 `count` 条事件（count 省略 = 全部） */
export function replay(
  events: SandboxEvent[],
  count: number = events.length,
  initial: SandboxState = createInitialState(),
): SandboxState {
  const limit = Math.max(0, Math.min(count, events.length));
  // 复制初始 items：draft 会就地修改，不能污染调用方传进来的对象
  const draft = beginDraft({ ...initial, items: [...initial.items] });
  let state = draft.state;
  for (let i = 0; i < limit; i += 1) {
    state = applyEvent(state, events[i], draft);
  }
  // 只在真被就地改过时复制一次，避免无谓分配
  return draft.mutated ? { ...state, items: [...state.items] } : state;
}

/** 重放全部事件，返回最终状态 */
export function replayAll(events: SandboxEvent[], initial?: SandboxState): SandboxState {
  return replay(events, events.length, initial);
}

/**
 * 校验「当前 items」与「事件重放结果」一致。
 * 返回 true 表示通过。用于开发断言、数据导入校验与单元测试。
 */
export function isConsistent(input: {
  items: SandboxItem[];
  events: SandboxEvent[];
  sceneId: string;
  initialSceneId?: string;
}): boolean {
  const replayed = replayAll(input.events, createInitialState(input.initialSceneId ?? DEFAULT_SCENE));
  if (replayed.items.length !== input.items.length) return false;
  const byId = new Map(replayed.items.map((it) => [it.id, it]));
  for (const item of input.items) {
    const other = byId.get(item.id);
    if (!other) return false;
    if (Math.abs(other.x - item.x) > 1e-9) return false;
    if (Math.abs(other.y - item.y) > 1e-9) return false;
    if (Math.abs(other.scale - item.scale) > 1e-9) return false;
    if (Math.abs(other.rotation - item.rotation) > 1e-9) return false;
    if (other.symbolId !== item.symbolId) return false;
    if ((other.note ?? '') !== (item.note ?? '')) return false;
    if ((other.z ?? 0) !== (item.z ?? 0)) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/*                                事件构造器                                   */
/* -------------------------------------------------------------------------- */

let sequenceHint = 0;

/** 会话内单调递增的时间（毫秒）。调用方应传入真实相对时间；这里只做兜底。 */
export function nextT(previous: SandboxEvent[]): number {
  const last = previous.length > 0 ? previous[previous.length - 1].t : 0;
  sequenceHint = Math.max(sequenceHint + 1, last + 1);
  return sequenceHint;
}

/** 重置内部计时提示（新建会话时调用） */
export function resetTimeline(): void {
  sequenceHint = 0;
}

/**
 * 构造一条类型安全的事件。
 * `t` 省略时用 `nextT(events)` 兜底（调用方一般给真实相对时间）。
 */
export function makeEvent(
  events: SandboxEvent[],
  type: SandboxEventType,
  payload?: EventPayload,
  itemId?: string,
  t?: number,
): SandboxEvent {
  const event: SandboxEvent = {
    t: t ?? nextT(events),
    type,
  };
  if (itemId) event.itemId = itemId;
  if (payload) {
    // 剥掉 kind 判别字段之外整体写入；kind 仅用于编译期校验
    const { kind: _kind, ...rest } = payload as EventPayload & { kind: string };
    void _kind;
    event.payload = rest as Record<string, unknown>;
  }
  return event;
}

/* -------------------------------------------------------------------------- */
/*                            撤销 / 重做（命令栈）                            */
/* -------------------------------------------------------------------------- */

/**
 * 撤销模型：事件流本身就是命令栈。
 * `cursor` 指向「已应用的事件数」；撤销 = cursor-1，重做 = cursor+1。
 * 新操作发生在撤销之后时，丢弃 cursor 之后的事件（标准分叉语义）。
 */
export interface CommandStack {
  events: SandboxEvent[];
  /** 已应用的事件数（0 ~ events.length） */
  cursor: number;
}

export function createStack(events: SandboxEvent[] = [], cursor?: number): CommandStack {
  return { events, cursor: cursor ?? events.length };
}

export function pushEvent(stack: CommandStack, event: SandboxEvent): CommandStack {
  // 分叉：丢弃被撤销的未来
  const kept = stack.cursor < stack.events.length ? stack.events.slice(0, stack.cursor) : stack.events;
  const nextEvents = [...kept, event];
  // 超出上限时保留最近的事件，但始终保留 session.start（如果有）
  if (nextEvents.length > MAX_EVENTS) {
    const head = nextEvents.slice(0, nextEvents.length - MAX_EVENTS);
    const tail = nextEvents.slice(head.length);
    // 如果被丢弃的头部含 item.add，把它们折叠进一条合成事件，保证重放一致
    const adds = head.filter((e) => e.type === 'item.add');
    const compacted =
      adds.length > 0
        ? [
            {
              t: head[head.length - 1]?.t ?? 0,
              type: 'session.import' as const,
              payload: { from: 'compacted' },
            },
          ]
        : [];
    return { events: [...compacted, ...tail], cursor: compacted.length + tail.length };
  }
  return { events: nextEvents, cursor: nextEvents.length };
}

export function canUndo(stack: CommandStack): boolean {
  return stack.cursor > 0;
}

export function canRedo(stack: CommandStack): boolean {
  return stack.cursor < stack.events.length;
}

export function undo(stack: CommandStack): CommandStack {
  if (!canUndo(stack)) return stack;
  return { ...stack, cursor: stack.cursor - 1 };
}

export function redo(stack: CommandStack): CommandStack {
  if (!canRedo(stack)) return stack;
  return { ...stack, cursor: stack.cursor + 1 };
}

/** 当前生效的事件（cursor 之前） */
export function activeEvents(stack: CommandStack): SandboxEvent[] {
  return stack.events.slice(0, stack.cursor);
}

/** 撤销/重做后重新计算状态 */
export function stateOf(stack: CommandStack, initialSceneId?: string): SandboxState {
  return replayAll(activeEvents(stack), createInitialState(initialSceneId));
}

/* -------------------------------------------------------------------------- */
/*                                事件描述（UI）                               */
/* -------------------------------------------------------------------------- */

const EVENT_LABELS: Record<SandboxEventType, string> = {
  'item.add': '放入',
  'item.move': '移动',
  'item.scale': '缩放',
  'item.rotate': '旋转',
  'item.remove': '移除',
  'item.note': '写注释',
  'item.affect': '标记感受',
  'item.layer': '改变层级',
  'item.bury': '埋入',
  'scene.change': '切换场景',
  'surface.stroke': '整理沙面',
  'surface.reset': '重置沙面',
  'session.start': '开始',
  'session.phase': '进入阶段',
  'session.lock': '封盘',
  'session.save': '保存',
  'session.import': '导入',
  'annotation.add': '批注',
  'reflection.edit': '修改自述',
};

export function eventLabel(type: SandboxEventType): string {
  return EVENT_LABELS[type] ?? type;
}

/** 毫秒 -> mm:ss */
export function formatEventTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
