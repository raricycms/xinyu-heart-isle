/**
 * 心屿 · 沙盘会话状态机（React Hook）
 *
 * 这是沙盘模块的**唯一状态来源**。页面、渲染器、工具栏都通过它读写，
 * 不允许任何组件自己维护 items / events 的第二份副本。
 *
 * 它保证的四件事（对应 VISION.md §6.1 与 §7.4）：
 * 1. `items` 永远等于「事件重放结果」——撤销、回放、批注共用一条时间轴；
 * 2. 撤销/重做基于命令栈，且撤销本身也是一次状态变化（但不写入事件流）；
 * 3. 沙面（L2）与摆件共享同一个 `SandSession`，且沙面只按笔画存快照；
 * 4. 封盘后 `locked = true`，任何变更请求都被拒绝（只能另存副本）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SandSurface,
  SandboxEvent,
  SandboxItem,
  SandSession,
  SessionPhase,
  SessionMode,
  SurfaceTool,
} from '@/lib/types';
import { createId } from '@/lib/id';
import { nowISO } from '@/lib/date';
import {
  DEFAULT_SCENE,
  activeEvents,
  applyEvent,
  canRedo,
  canUndo,
  createInitialState,
  createStack,
  eventLabel,
  makeEvent,
  pushEvent,
  redo,
  replay,
  replayAll,
  undo,
  type CommandStack,
  type SandboxState,
} from '@/sandbox/events';
import {
  createSurfaceState,
  type SurfaceState,
} from '@/sandbox/surfaceCodec';
import { applyStroke } from '@/sandbox/surfaceOps';
import { deserializeSurface, serializeSurface } from '@/sandbox/surfaceState';

export interface SandboxSessionApi {
  /** 当前生效的状态（= 事件重放到 cursor 的结果） */
  state: SandboxState;
  /** 原始事件流（全部，含被撤销的未来） */
  events: SandboxEvent[];
  /** 已应用事件数 */
  cursor: number;
  /** 会话元信息 */
  title: string;
  setTitle: (title: string) => void;
  mode: SessionMode;
  setMode: (mode: SessionMode) => void;
  reflection: string;
  setReflection: (text: string) => void;
  /** 沙面运行时状态 */
  surface: SurfaceState;
  /** 是否封盘 */
  locked: boolean;
  /** 是否有未保存变更 */
  dirty: boolean;

  /* 摆件操作 */
  addItem: (symbolId: string, at?: { x: number; y: number }) => string | null;
  moveItem: (id: string, x: number, y: number) => void;
  scaleItem: (id: string, scale: number) => void;
  rotateItem: (id: string, rotation: number) => void;
  removeItem: (id: string) => void;
  setItemNote: (id: string, note: string) => void;
  setItemAffect: (id: string, labels: string[]) => void;
  setItemLayer: (id: string, z: number) => void;
  setItemBurial: (id: string, burial: number) => void;
  /** 批量应用一次拖动（合并成一条 move 事件，避免事件流爆炸） */
  commitMove: (id: string, from: { x: number; y: number }, to: { x: number; y: number }) => void;

  /* 场景 / 阶段 */
  setScene: (sceneId: string) => void;
  setPhase: (phase: SessionPhase) => void;

  /* 沙面操作 */
  strokeSurface: (
    tool: SurfaceTool,
    points: Array<{ x: number; y: number }>,
    radius: number,
    strength: number,
  ) => void;
  resetSurface: () => void;

  /* 历史 */
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** 跳转到任意时间点（回放用；不改变事件流，只改变 cursor） */
  seek: (cursor: number) => void;

  /* 会话 */
  lock: () => void;
  /** 导出为可保存的会话对象 */
  toSession: (options?: { thumbnail?: string; id?: string; at?: string; archived?: boolean }) => SandSession;
  /** 从已有会话载入（编辑模式） */
  loadSession: (session: SandSession) => void;
  /** 新建空白会话 */
  reset: (sceneId?: string) => void;
  /** 最近一次操作描述（用于状态栏） */
  lastAction: string | null;
}

export interface UseSandboxSessionOptions {
  /** 初始场景 */
  initialSceneId?: string;
  /** 初始模式 */
  initialMode?: SessionMode;
  /** 是否只读（回放时 true） */
  readOnly?: boolean;
}

/** 拖动过程中合并事件的节流窗口（毫秒） */
const MOVE_MERGE_MS = 220;

export function useSandboxSession(options: UseSandboxSessionOptions = {}): SandboxSessionApi {
  const { initialSceneId = DEFAULT_SCENE, initialMode = 'self', readOnly = false } = options;

  const [stack, setStack] = useState<CommandStack>(() =>
    createStack(
      [
        makeEvent([], 'session.start', { kind: 'session.start', sceneId: initialSceneId, mode: initialMode }, undefined, 0),
      ],
      1,
    ),
  );
  const [surface, setSurface] = useState<SurfaceState>(() => createSurfaceState());
  const [title, setTitleState] = useState('未命名沙盘');
  const [mode, setModeState] = useState<SessionMode>(initialMode);
  const [reflection, setReflectionState] = useState('');
  const [locked, setLocked] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const startedAtRef = useRef<number>(Date.now());
  const lastMoveRef = useRef<{ t: number; eventIndex: number } | null>(null);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  /* ------------------------------------------------------------------------ */
  /*                              状态派生                                     */
  /* ------------------------------------------------------------------------ */

  const state = useMemo<SandboxState>(() => {
    const base = replayAll(activeEvents(stack), createInitialState(initialSceneId));
    return { ...base, locked, reflection };
  }, [stack, initialSceneId, locked, reflection]);

  const editable = !readOnly && !locked;

  /** 相对会话开始的毫秒数 */
  const elapsed = useCallback(
    () => Math.max(0, Date.now() - startedAtRef.current),
    [],
  );

  /** 推入一条事件 */
  const emit = useCallback(
    (event: SandboxEvent, label?: string) => {
      setStack((prev) => pushEvent(prev, event));
      setDirty(true);
      if (label) setLastAction(label);
    },
    [],
  );

  const pushTyped = useCallback(
    (
      type: SandboxEvent['type'],
      payload: Parameters<typeof makeEvent>[2],
      itemId?: string,
      label?: string,
    ) => {
      if (readOnly || locked) return;
      const events = stackRef.current.events;
      const event = makeEvent(events, type, payload, itemId, elapsed());
      emit(event, label ?? eventLabel(type));
    },
    [elapsed, emit, locked, readOnly],
  );

  /* ------------------------------------------------------------------------ */
  /*                              摆件操作                                     */
  /* ------------------------------------------------------------------------ */

  const addItem = useCallback(
    (symbolId: string, at?: { x: number; y: number }) => {
      if (readOnly || locked) return null;
      const id = createId('item');
      const nudge = (stackRef.current.cursor % 5) * 0.05 - 0.1;
      const item: SandboxItem = {
        id,
        symbolId,
        x: clamp01((at?.x ?? 0.5) + (at ? 0 : nudge)),
        y: clamp01((at?.y ?? 0.55) + (at ? 0 : nudge * 0.6)),
        scale: 1,
        rotation: 0,
        z: nextZ(state.items),
      };
      pushTyped('item.add', { kind: 'item.add', item }, id, '放入');
      return id;
    },
    [locked, pushTyped, readOnly, state.items],
  );

  const moveItem = useCallback(
    (id: string, x: number, y: number) => {
      pushTyped('item.move', { kind: 'item.move', x: clamp01(x), y: clamp01(y) }, id, '移动');
    },
    [pushTyped],
  );

  /**
   * 提交一次拖动：如果最近 220ms 内刚提交过同一个摆件的移动，
   * 就把那条事件改成新坐标，而不是新增一条（避免一条事件流里塞几百条 move）。
   */
  const commitMove = useCallback(
    (id: string, from: { x: number; y: number }, to: { x: number; y: number }) => {
      void from;
      if (readOnly || locked) return;
      const now = Date.now();
      const last = lastMoveRef.current;
      if (last && now - last.t < MOVE_MERGE_MS) {
        setStack((prev) => {
          const events = [...prev.events];
          const index = last.eventIndex;
          const target = events[index];
          if (target && target.type === 'item.move' && target.itemId === id) {
            events[index] = {
              ...target,
              payload: { ...(target.payload ?? {}), x: clamp01(to.x), y: clamp01(to.y) },
            };
          }
          return { ...prev, events };
        });
        lastMoveRef.current = { t: now, eventIndex: last.eventIndex };
        setDirty(true);
        setLastAction('移动');
        return;
      }

      const event = makeEvent(
        stackRef.current.events,
        'item.move',
        { kind: 'item.move', x: clamp01(to.x), y: clamp01(to.y) },
        id,
        elapsed(),
      );
      const nextIndex = stackRef.current.cursor;
      setStack((prev) => pushEvent(prev, event));
      lastMoveRef.current = { t: now, eventIndex: nextIndex };
      setDirty(true);
      setLastAction('移动');
    },
    [elapsed, locked, readOnly],
  );

  const scaleItem = useCallback(
    (id: string, scale: number) => {
      pushTyped('item.scale', { kind: 'item.scale', scale: clamp(scale, 0.2, 4) }, id, '缩放');
    },
    [pushTyped],
  );

  const rotateItem = useCallback(
    (id: string, rotation: number) => {
      pushTyped('item.rotate', { kind: 'item.rotate', rotation: clamp(rotation, -180, 180) }, id, '旋转');
    },
    [pushTyped],
  );

  const removeItem = useCallback(
    (id: string) => {
      pushTyped('item.remove', { kind: 'item.remove' }, id, '移除');
    },
    [pushTyped],
  );

  const setItemNote = useCallback(
    (id: string, note: string) => {
      pushTyped('item.note', { kind: 'item.note', note: note.trim() || undefined }, id, '写注释');
    },
    [pushTyped],
  );

  const setItemAffect = useCallback(
    (id: string, labels: string[]) => {
      pushTyped('item.affect', { kind: 'item.affect', affectLabels: labels }, id, '标记感受');
    },
    [pushTyped],
  );

  const setItemLayer = useCallback(
    (id: string, z: number) => {
      pushTyped('item.layer', { kind: 'item.layer', z: clamp(z, 0, 999) }, id, '改变层级');
    },
    [pushTyped],
  );

  const setItemBurial = useCallback(
    (id: string, burial: number) => {
      pushTyped('item.bury', { kind: 'item.bury', burial: clamp01(burial) }, id, '埋入');
    },
    [pushTyped],
  );

  /* ------------------------------------------------------------------------ */
  /*                              场景 / 阶段                                  */
  /* ------------------------------------------------------------------------ */

  const setScene = useCallback(
    (sceneId: string) => {
      if (sceneId === state.sceneId) return;
      pushTyped('scene.change', { kind: 'scene.change', sceneId }, undefined, '切换场景');
    },
    [pushTyped, state.sceneId],
  );

  const setPhase = useCallback(
    (phase: SessionPhase) => {
      pushTyped('session.phase', { kind: 'session.phase', phase }, undefined, '进入阶段');
    },
    [pushTyped],
  );

  /* ------------------------------------------------------------------------ */
  /*                                沙面操作                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * 一次笔画 = 一条 `surface.stroke` 事件。
   * 事件里存 **before/after 两个快照**：回放时直接替换即可，
   * 不需要在重放期重算笔刷（保证回放结果与当时看到的完全一致）。
   */
  const strokeSurface = useCallback(
    (
      tool: SurfaceTool,
      points: Array<{ x: number; y: number }>,
      radius: number,
      strength: number,
    ) => {
      if (readOnly || locked || points.length === 0) return;
      const before = surface;
      const after = applyStroke(before, tool, points, radius, strength);
      setSurface(after);
      const events = stackRef.current.events;
      const event = makeEvent(
        events,
        'surface.stroke',
        {
          kind: 'surface.stroke',
          tool,
          before: serializeSurface(before),
          after: serializeSurface(after),
        },
        undefined,
        elapsed(),
      );
      emit(event, toolLabel(tool));
    },
    [elapsed, emit, locked, readOnly, surface],
  );

  const resetSurface = useCallback(() => {
    if (readOnly || locked) return;
    setSurface(createSurfaceState());
    pushTyped('surface.reset', { kind: 'surface.reset' }, undefined, '重置沙面');
  }, [locked, pushTyped, readOnly]);

  /* ------------------------------------------------------------------------ */
  /*                                  历史                                     */
  /* ------------------------------------------------------------------------ */

  const doUndo = useCallback(() => {
    if (readOnly || locked) return;
    setStack((prev) => {
      const next = undo(prev);
      if (next === prev) return prev;
      // 回退时不改沙面快照：从事件流里找最近一条 surface.stroke 的 before
      return next;
    });
    setDirty(true);
    setLastAction('撤销');
  }, [locked, readOnly]);

  const doRedo = useCallback(() => {
    if (readOnly || locked) return;
    setStack((prev) => redo(prev));
    setDirty(true);
    setLastAction('重做');
  }, [locked, readOnly]);

  /**
   * 沙面单独维护一份运行态，撤销时需要把它与事件流对齐：
   * 找到 cursor 之前最后一条 surface 事件，取其 after（或 undefined -> 空白）。
   */
  useEffect(() => {
    const events = activeEvents(stack);
    let target: SandSurface | undefined;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type === 'surface.stroke') {
        target = event.payload?.after as SandSurface | undefined;
        break;
      }
      if (event.type === 'surface.reset') {
        target = undefined;
        break;
      }
    }
    const next = deserializeSurface(target);
    setSurface((prev) => (surfaceEqual(prev, next) ? prev : next));
    // 只在 cursor 变化时同步，避免拖动笔刷时反复解码
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack.cursor]);

  const seek = useCallback((cursor: number) => {
    setStack((prev) => ({ ...prev, cursor: Math.max(0, Math.min(cursor, prev.events.length)) }));
  }, []);

  /* ------------------------------------------------------------------------ */
  /*                                  会话                                     */
  /* ------------------------------------------------------------------------ */

  const lock = useCallback(() => {
    if (readOnly || locked) return;
    pushTyped('session.lock', { kind: 'session.lock' }, undefined, '封盘');
    setLocked(true);
  }, [locked, pushTyped, readOnly]);

  const toSession = useCallback(
    (params: { thumbnail?: string; id?: string; at?: string; archived?: boolean } = {}): SandSession => {
      const events = [...stack.events];
      return {
        schemaVersion: 2,
        id: params.id ?? createId('session'),
        at: params.at ?? nowISO(),
        title: title.trim() || '未命名沙盘',
        endedAt: locked ? nowISO() : undefined,
        mode,
        sceneId: state.sceneId,
        items: state.items.map((item) => ({ ...item })),
        events,
        surface: serializeSurface(surface),
        reflection: reflection.trim() || undefined,
        locked,
        lockedAt: locked ? nowISO() : undefined,
        ...(params.thumbnail ? { thumbnail: params.thumbnail } : {}),
        ...(params.archived ? { archived: true, archivedAt: nowISO() } : {}),
        annotations: state.annotations.map((a, index) => ({
          id: a.id,
          eventIndex: a.eventIndex,
          t: a.t,
          text: a.text,
          at: new Date(startedAtRef.current + a.t).toISOString(),
          ...(index === -1 ? {} : {}),
        })),
      };
    },
    [locked, mode, reflection, stack.events, state.annotations, state.items, state.sceneId, surface, title],
  );

  const loadSession = useCallback((session: SandSession) => {
    const events = session.events.length > 0 ? [...session.events] : synthesizeEvents(session);
    setStack(createStack(events, events.length));
    setSurface(deserializeSurface(session.surface));
    setTitleState(session.title);
    setModeState(session.mode);
    setReflectionState(session.reflection ?? '');
    setLocked(session.locked);
    setDirty(false);
    setLastAction(null);
    startedAtRef.current = Date.now() - (events.length > 0 ? events[events.length - 1].t : 0);
  }, []);

  const reset = useCallback(
    (sceneId = DEFAULT_SCENE) => {
      const startEvent = makeEvent(
        [],
        'session.start',
        { kind: 'session.start', sceneId, mode },
        undefined,
        0,
      );
      setStack(createStack([startEvent], 1));
      setSurface(createSurfaceState());
      setTitleState('未命名沙盘');
      setReflectionState('');
      setLocked(false);
      setDirty(false);
      setLastAction(null);
      startedAtRef.current = Date.now();
      lastMoveRef.current = null;
    },
    [mode],
  );

  /* ------------------------------------------------------------------------ */

  return {
    state,
    events: stack.events,
    cursor: stack.cursor,
    title,
    setTitle: setTitleState,
    mode,
    setMode: setModeState,
    reflection,
    setReflection: (text: string) => {
      setReflectionState(text);
      setDirty(true);
    },
    surface,
    locked,
    dirty,
    addItem,
    moveItem,
    scaleItem,
    rotateItem,
    removeItem,
    setItemNote,
    setItemAffect,
    setItemLayer,
    setItemBurial,
    commitMove,
    setScene,
    setPhase,
    strokeSurface,
    resetSurface,
    undo: doUndo,
    redo: doRedo,
    canUndo: canUndo(stack) && editable,
    canRedo: canRedo(stack) && editable,
    seek,
    lock,
    toSession,
    loadSession,
    reset,
    lastAction,
  };
}

/* -------------------------------------------------------------------------- */
/*                                   工具函数                                  */
/* -------------------------------------------------------------------------- */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0.02, 0.98);
}

function nextZ(items: SandboxItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.z), 0) + 1;
}

function surfaceEqual(a: SurfaceState, b: SurfaceState): boolean {
  if (a.state !== b.state) return false;
  if (a.height.cols !== b.height.cols || a.height.rows !== b.height.rows) return false;
  const len = a.height.data.length;
  for (let i = 0; i < len; i += 1) {
    if (a.height.data[i] !== b.height.data[i]) return false;
  }
  return true;
}

function toolLabel(tool: SurfaceTool): string {
  const labels: Record<SurfaceTool, string> = {
    raise: '推沙',
    dig: '挖沙',
    smooth: '抹平',
    rake: '耙纹',
    water: '喷水',
    flatten: '铺沙',
    tunnel: '隧道',
  };
  return labels[tool] ?? tool;
}

/** 为没有事件流的旧会话合成一条最小事件流，保证时间轴可用 */
function synthesizeEvents(session: SandSession): SandboxEvent[] {
  const events: SandboxEvent[] = [
    makeEvent([], 'session.import', { kind: 'session.import', from: 'session-without-events' }, undefined, 0),
  ];
  session.items.forEach((item, index) => {
    events.push(
      makeEvent(events, 'item.add', { kind: 'item.add', item }, item.id, (index + 1) * 1000),
    );
  });
  return events;
}

export { applyEvent, replay };
