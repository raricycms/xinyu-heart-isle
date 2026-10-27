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
 * 最小结构检查：这是个能用的沙具吗？
 *
 * 只查 `id` 是字符串，因为后续所有操作（move/remove/note…）都按 id 定位。
 * 不校验 x/y/scale 范围 —— 那些是 UI 的职责，重放层强行校验会让
 * 历史文件里一个越界的历史数值导致整个会话打不开。
 *
 * 抽成函数是因为两处要用：`item.add` 和折叠事件恢复。
 * 两处各写一遍判断，早晚会漂移成两种容错标准。
 */
function isSandboxItem(value: unknown): value is SandboxItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string'
  );
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

    case 'session.save': {
      return state;
    }

    case 'session.import': {
      /*
       * 折叠事件（`from: 'compacted'`）承载**被丢弃窗口里的沙具**。
       *
       * ── 这里修过一个「假承诺」bug ──────────────────────────────────
       *
       * 原实现的注释写着「把它们折叠进一条合成事件，保证重放一致」，
       * 但这一分支直接 `return state` —— 什么都没恢复。
       * 实测：先摆 10 个沙具、再做 4005 次移动，重放后 items 数是 0。
       * 也就是说注释承诺的事从来没发生过，而没有任何测试发现它。
       *
       * 现在折叠事件把 `items` 一起带下来，重放时并回状态。
       */
      const carried = payload.items;
      if (!Array.isArray(carried) || carried.length === 0) return state;

      /*
       * 合并策略：折叠事件在事件流**最前面**，所以它带来的沙具
       * 先入状态；后续事件（move/remove 等）再按序作用于它们。
       * 已经在状态里的同 id 项不重复添加（后续 item.add 会覆盖）。
       */
      const existing = new Set(state.items.map((item) => item.id));
      const restored = carried
        .filter((item): item is SandboxItem => isSandboxItem(item) && !existing.has(item.id))
        .map(cloneItem);

      if (restored.length === 0) return state;
      return { ...state, items: [...restored, ...state.items] };
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

    /*
     * 折叠是**累积**的，不是每次重算。
     *
     * ── 这里修过一个会让用户丢沙具的 bug ────────────────────────────
     *
     * 原实现只检查「本次被丢弃的 head 里有没有 item.add」。问题在于：
     *
     *   第 1 次截断：head = [item.add#0]  → 插入合成事件 ✓
     *   第 2 次截断：head = [move#1]      → adds 为空，不插入 ✗
     *
     * 于是上一次插的合成事件因为不是新插入的，被正常推进 tail 后
     * 在**下一次**截断时落到 head 里，而 head 里它又不是 item.add，
     * 就被安静地扔掉了。
     *
     * 实测后果：先摆 10 个沙具、再做 4005 次移动，
     * 最终事件流里 item.add 数量 = **0**，重放出来的沙盘是空的。
     * 用户看到的是「用了很久之后，早期摆的东西全不见了」。
     *
     * 判据必须是：只要被丢弃的头部含 `item.add`，**或本来就是一条
     * 折叠事件**，就要在新的窗口头部补一条合成事件。后者保证
     * 折叠状态能一直传到窗口前面，不会中途蒸发。
     */
    const needsCompaction = head.some(
      (e) =>
        e.type === 'item.add' ||
        (e.type === 'session.import' && e.payload?.from === 'compacted'),
    );

    /* 时间戳沿用「最后一条被丢弃事件」的时间，让折叠点在时间轴上位置正确 */
    const compactedAt = head[head.length - 1]?.t ?? 0;

    if (needsCompaction) {
      /*
       * 如果 tail 开头已经是一条折叠事件（上一次截断留下的），
       * 不要重复插入 —— 两条 `session.import` 会让重放多做一次空导入。
       */
      const tailStartsWithCompacted =
        tail.length > 0 &&
        tail[0]!.type === 'session.import' &&
        tail[0]!.payload?.from === 'compacted';

      if (tailStartsWithCompacted) {
        return { events: tail, cursor: tail.length };
      }

      /*
       * 插入折叠事件会让总长变成 MAX_EVENTS + 1，所以要从 tail
       * 再削掉一条，保证**永不超限**。
       *
       * 第一版忘了这一步，实测长度是 4001 —— 上限形同虚设，
       * 而「上限」是本地存储不爆的唯一保障。
       */
      const trimmedOff = tail.length > 0 ? tail[0] : undefined;
      const trimmedTail = tail.length > 0 ? tail.slice(1) : tail;

      /*
       * 把被丢弃窗口里的沙具**带下去**。
       *
       * 光插一条 `{from:'compacted'}` 是不够的 —— 重放器看到它
       * 只能知道"这里有过东西"，不知道是**什么**。
       * 所以要把 head 里所有 item.add 的 item 收集起来，
       * 连同上一条折叠事件已经携带的那些（累积保留）。
       */
      const carried = new Map<string, SandboxItem>();

      /*
       * 先继承上一次折叠携带的沙具。
       *
       * 上一轮的折叠事件这时候可能出现在**两个位置之一**：
       *   - 在 head 里（这轮刚好被挤出窗口）
       *   - 在 tail 的最前面（这轮还在窗口里，这是常见情况）
       *
       * 第一版只查了 head，于是每轮都从零开始收集：
       * 实测摆 10 个沙具后只携带了 1 个 —— 因为每次截断只丢 1 条事件，
       * 上一轮的折叠事件留在 tail 里没被看到，累积链条断了。
       */
      for (const candidate of [head[0], tail[0]]) {
        if (
          !candidate ||
          candidate.type !== 'session.import' ||
          candidate.payload?.from !== 'compacted'
        ) {
          continue;
        }
        const inherited = candidate.payload?.items;
        if (!Array.isArray(inherited)) continue;
        for (const item of inherited) {
          if (isSandboxItem(item)) carried.set(item.id, item);
        }
      }

      /* 收集本次被丢弃的 item.add */
      for (const dropped of head) {
        if (dropped.type !== 'item.add') continue;
        const item = dropped.payload?.item;
        if (isSandboxItem(item)) carried.set(item.id, item);
      }

      /*
       * 为腾位置被削掉的那条 `tail[0]` 也可能是 `item.add`。
       *
       * 不收集它，那个沙具就**彻底消失**了：它既不在折叠事件里，
       * 也不在后续事件流里，重放时根本不出现。
       *
       * 实测症状：先摆 10 个沙具再做 4005 次移动，最终只活了 1 个。
       * 因为每次截断都从 tail 头部削掉一条（正好是下一个 item.add），
       * 而只有第 1 次削到的那条在 head 里被看到了。
       */
      if (trimmedOff && trimmedOff.type === 'item.add') {
        const item = trimmedOff.payload?.item;
        if (isSandboxItem(item)) carried.set(item.id, item);
      }

      const compactedEvent: SandboxEvent = {
        t: compactedAt,
        type: 'session.import',
        payload: { from: 'compacted', items: [...carried.values()] },
      };
      const events = [compactedEvent, ...trimmedTail];
      return { events, cursor: events.length };
    }

    return { events: tail, cursor: tail.length };
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
