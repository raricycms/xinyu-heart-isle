import { useSyncExternalStore } from 'react';
import type {
  BaseRecord,
  JournalEntry,
  LocalClient,
  MoodEntry,
  Preferences,
  SandSession,
  SandboxSnapshot,
  ScaleResult,
  ToolSession,
} from './types';

/**
 * 本地持久化层。
 *
 * 本项目没有后端，所有数据只写入 localStorage。这一层负责：
 * 1. 统一 key 命名与 JSON 编解码（含容错）；
 * 2. 提供一个极简的订阅机制，让 React 通过 useSyncExternalStore 实时更新；
 * 3. 跨标签页同步（storage 事件）；
 * 4. 全量导出 / 导入 / 清空（用户对自己的数据有完全控制权）。
 */

const NAMESPACE = 'xinyu';
const SCHEMA_VERSION = 1;

export const STORAGE_KEYS = {
  moods: `${NAMESPACE}.moods`,
  scaleResults: `${NAMESPACE}.scaleResults`,
  /** v1 沙盘快照（只读兼容；新数据写 sessions） */
  sandbox: `${NAMESPACE}.sandbox`,
  /** v2 沙盘会话（事件流 + 沙面）。全量序列化到 localStorage 作为 IndexedDB 的兜底与导出源。 */
  sessions: `${NAMESPACE}.sessions`,
  /** v2 本地档案（化名，仅本机） */
  clients: `${NAMESPACE}.clients`,
  toolSessions: `${NAMESPACE}.toolSessions`,
  journal: `${NAMESPACE}.journal`,
  preferences: `${NAMESPACE}.preferences`,
  /** 第三方沙具包（导入的本地扩展，随备份一起导出） */
  symbolPacks: `${NAMESPACE}.symbolPacks`,
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

function emit(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function subscribeKey(key: string, fn: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
    if (set && set.size === 0) listeners.delete(key);
  };
}

// 跨标签页同步
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    // 关键：**必须先失效缓存再通知**。
    // 历史缺陷：这里只 emit 不 invalidate，而 getSnapshot 会命中 snapshotCache，
    // 于是「另一标签页改了数据」时本页订阅者被唤醒、却仍读到旧快照，
    // 界面永远不更新。invalidate 之后下次 getSnapshot 才会重新读盘。
    if (event.key) {
      invalidate(event.key);
      emit(event.key);
    }
  });
}

export function readJSON<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 只落盘，不发通知。供内部在「先更新缓存再通知」时使用。
 *
 * @returns 是否真的写进去了。配额超限 / 隐私模式下返回 false。
 *   历史缺陷：以前这里吞掉异常只打 warn，调用方无法感知失败，
 *   于是 `add()` 看起来成功、实际没落盘，用户刷新后数据凭空消失。
 */
function persist(key: string, value: unknown): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    // 隐私模式或配额超限
    console.warn('[心屿] 本地存储写入失败，数据不会被保存。', error);
    return false;
  }
}

/**
 * 写入并通知订阅者。
 * @returns 是否落盘成功。false 表示内存与磁盘**不一致**（调用方应回滚或提示用户）。
 */
export function writeJSON(key: string, value: unknown): boolean {
  const ok = persist(key, value);
  // 无论成功与否都要失效缓存：失败时让下次读取回到磁盘上的真实内容，
  // 避免内存快照继续「假装」写入已经成功。
  invalidate(key);
  emit(key);
  return ok;
}

export function removeKey(key: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
  invalidate(key);
  emit(key);
}

/* -------------------------------------------------------------------------- */
/*                                集合操作封装                                 */
/* -------------------------------------------------------------------------- */

/** 通用「按时间倒序」比较器 */
function byTimeDesc(a: BaseRecord, b: BaseRecord): number {
  return b.at.localeCompare(a.at);
}

type CollectionApi<T extends BaseRecord> = {
  getAll: () => T[];
  /** @returns 是否成功落盘。false 时调用方应提示用户「没保存上」。 */
  add: (item: T) => boolean;
  upsert: (item: T) => boolean;
  update: (id: string, patch: Partial<T>) => boolean;
  remove: (id: string) => boolean;
  clear: () => boolean;
};

/**
 * useSyncExternalStore 要求 getSnapshot 在数据未变时返回**同一个引用**，
 * 否则 React 会认为状态一直在变，抛出
 * "The result of getSnapshot should be cached to avoid an infinite loop" 并陷入死循环。
 *
 * 因此这里对每个 key 缓存一份「最近一次解析结果」，仅在写入或跨标签页更新时失效。
 */
const snapshotCache = new Map<string, unknown>();

function getSnapshot<T>(key: string, fallback: T): T {
  if (snapshotCache.has(key)) return snapshotCache.get(key) as T;
  const value = readJSON<T>(key, fallback);
  snapshotCache.set(key, value);
  return value;
}

function invalidate(key: string): void {
  snapshotCache.delete(key);
}

function invalidateAll(): void {
  Object.values(STORAGE_KEYS).forEach(invalidate);
  Object.values(STORAGE_KEYS).forEach(emit);
}

function createCollection<T extends BaseRecord>(key: string, sortDesc = true): CollectionApi<T> {
  const read = (): T[] => {
    const list = getSnapshot<T[]>(key, []);
    return Array.isArray(list) ? [...list] : [];
  };
  const write = (list: T[]): boolean => {
    const ok = writeJSON(key, list);
    if (ok) {
      // 只有真的落盘了才填充缓存，保证内存快照 == 磁盘内容。
      // 写入失败时**不**填充，让下次读取回到磁盘真实状态（避免内存/磁盘分叉）。
      snapshotCache.set(key, list);
    }
    return ok;
  };
  return {
    getAll: () => (sortDesc ? read().sort(byTimeDesc) : read()),
    add: (item) => {
      const list = read();
      list.push(item);
      return write(list);
    },
    upsert: (item) => {
      const list = read();
      const index = list.findIndex((it) => it.id === item.id);
      if (index >= 0) list[index] = item;
      else list.push(item);
      return write(list);
    },
    update: (id, patch) => {
      const list = read();
      const index = list.findIndex((it) => it.id === id);
      if (index < 0) return false;
      list[index] = { ...list[index], ...patch };
      return write(list);
    },
    remove: (id) => write(read().filter((it) => it.id !== id)),
    clear: () => write([]),
  };
}

export const moodStore = createCollection<MoodEntry>(STORAGE_KEYS.moods);
export const scaleResultStore = createCollection<ScaleResult>(STORAGE_KEYS.scaleResults);
export const sandboxStore = createCollection<SandboxSnapshot>(STORAGE_KEYS.sandbox);
export const toolSessionStore = createCollection<ToolSession>(STORAGE_KEYS.toolSessions);
export const journalStore = createCollection<JournalEntry>(STORAGE_KEYS.journal);

/**
 * v2 会话集合。
 *
 * 说明：localStorage 中保留一份完整会话（含事件流）作为**镜像**，
 * 便于「导出全部 / 无 IndexedDB 环境降级 / 跨标签页同步」；
 * IndexedDB 负责承载缩略图与大附件（见 `src/lib/idb.ts`）。
 * 两者由 `src/lib/sessionStore.tsx` 统一读写，业务代码不直接碰。
 */
export const sessionStore = createCollection<SandSession>(STORAGE_KEYS.sessions);
export const clientStore = createCollection<LocalClient>(STORAGE_KEYS.clients);
export const legacySandboxStore = sandboxStore;

/* -------------------------------------------------------------------------- */
/*                                  用户偏好                                   */
/* -------------------------------------------------------------------------- */

/*
 * 默认偏好。
 *
 * ⚠️ 加字段之前先问一句：**谁会读它？**
 *
 * 这里曾经有过三个「死开关」：`acknowledgedDisclaimer`、`acknowledgedAge`、
 * `sandboxUiMode` —— 字段定义、默认值、注释、i18n 文案全都齐备，
 * 但零处代码读它们。比「没做」更糟：读代码的人以为功能存在。
 * 前两个已补齐（年龄门是 CONTRACT §7.7 的要求），`sandboxUiMode` 删掉了 ——
 * 它承诺的「记住上次的沙盘模式」从来没实现，而这个能力的真实需求
 * 由 `useSandboxSession({ initialMode })` 显式传入即可，不需要一个
 * 从不被读的偏好字段。
 *
 * 详见 `docs/TESTING.md §4.10「死开关：字段存在 ≠ 功能存在」`。
 */
export const DEFAULT_PREFERENCES: Preferences = {
  acknowledgedDisclaimer: false,
  reducedMotion: false,
  acknowledgedAge: false,
  soundEnabled: true,
  renderer: 'iso2d',
  retentionDays: 0,
  locale: 'zh-CN',
  outlineMode: false,
  favoriteSymbols: [],
};

/**
 * 读取偏好。**必须返回稳定引用**，否则 useSyncExternalStore 会判定状态持续变化而死循环。
 * 因此合并结果只在缓存未命中时计算一次并写入缓存。
 */
export function getPreferences(): Preferences {
  const cached = snapshotCache.get(STORAGE_KEYS.preferences);
  if (cached) return cached as Preferences;
  const stored = readJSON<Partial<Preferences>>(STORAGE_KEYS.preferences, {});
  const merged: Preferences = { ...DEFAULT_PREFERENCES, ...stored };
  snapshotCache.set(STORAGE_KEYS.preferences, merged);
  return merged;
}

export function setPreferences(patch: Partial<Preferences>): void {
  writeJSON(STORAGE_KEYS.preferences, { ...getPreferences(), ...patch });
}

/* -------------------------------------------------------------------------- */
/*                                React 订阅钩子                               */
/* -------------------------------------------------------------------------- */

function emptySubscribe(): () => void {
  return () => {};
}

/** 订阅一个集合，按时间倒序返回。 */
export function useCollection<T extends BaseRecord>(key: string, fallback: T[] = []): T[] {
  void fallback;
  return useSyncExternalStore(
    (fn) => subscribeKey(key, fn),
    () => getSnapshot<T[]>(key, [] as unknown as T[]),
    () => [] as unknown as T[],
  );
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (fn) => subscribeKey(STORAGE_KEYS.preferences, fn),
    () => getPreferences(),
    () => DEFAULT_PREFERENCES,
  );
}

export { emptySubscribe, invalidateAll };

/* -------------------------------------------------------------------------- */
/*                                 全量导入导出                                */
/* -------------------------------------------------------------------------- */

export interface ExportBundle {
  app: 'xinyu';
  version: number;
  exportedAt: string;
  data: Record<string, unknown>;
}

export function exportAll(): ExportBundle {
  const data: Record<string, unknown> = {};
  Object.entries(STORAGE_KEYS).forEach(([name, key]) => {
    data[name] = readJSON<unknown>(key, null);
  });
  return {
    app: 'xinyu',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function importAll(bundle: unknown): { ok: boolean; message: string } {
  if (!bundle || typeof bundle !== 'object') {
    return { ok: false, message: '文件内容不是有效的 JSON 对象。' };
  }
  const candidate = bundle as Partial<ExportBundle>;
  if (candidate.app !== 'xinyu' || typeof candidate.data !== 'object' || !candidate.data) {
    return { ok: false, message: '这不是心屿导出的数据文件。' };
  }
  Object.entries(STORAGE_KEYS).forEach(([name, key]) => {
    if (candidate.data?.[name] !== undefined) {
      writeJSON(key, candidate.data[name]);
    }
  });
  invalidateAll();
  return { ok: true, message: '数据已导入。' };
}

export function clearAll(): void {
  Object.values(STORAGE_KEYS).forEach(removeKey);
  invalidateAll();
}
