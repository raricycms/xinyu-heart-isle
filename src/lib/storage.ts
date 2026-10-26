import { useSyncExternalStore } from 'react';
import type {
  BaseRecord,
  JournalEntry,
  MoodEntry,
  Preferences,
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
  sandbox: `${NAMESPACE}.sandbox`,
  toolSessions: `${NAMESPACE}.toolSessions`,
  journal: `${NAMESPACE}.journal`,
  preferences: `${NAMESPACE}.preferences`,
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
    if (event.key) emit(event.key);
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

/** 只落盘，不发通知。供内部在「先更新缓存再通知」时使用。 */
function persist(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // 隐私模式或配额超限
    console.warn('[心屿] 本地存储写入失败，数据不会被保存。', error);
  }
}

export function writeJSON(key: string, value: unknown): void {
  persist(key, value);
  // 先失效缓存，让订阅者读到新值
  invalidate(key);
  emit(key);
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
  add: (item: T) => void;
  upsert: (item: T) => void;
  update: (id: string, patch: Partial<T>) => void;
  remove: (id: string) => void;
  clear: () => void;
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
  const write = (list: T[]) => {
    writeJSON(key, list);
    // writeJSON 内部会 emit，emit 又清掉缓存；
    // 这里在 emit 之后重新填充，保证下次同步读取拿到的是稳定引用。
    snapshotCache.set(key, list);
  };
  return {
    getAll: () => (sortDesc ? read().sort(byTimeDesc) : read()),
    add: (item) => {
      const list = read();
      list.push(item);
      write(list);
    },
    upsert: (item) => {
      const list = read();
      const index = list.findIndex((it) => it.id === item.id);
      if (index >= 0) list[index] = item;
      else list.push(item);
      write(list);
    },
    update: (id, patch) => {
      const list = read();
      const index = list.findIndex((it) => it.id === id);
      if (index < 0) return;
      list[index] = { ...list[index], ...patch };
      write(list);
    },
    remove: (id) => {
      write(read().filter((it) => it.id !== id));
    },
    clear: () => write([]),
  };
}

export const moodStore = createCollection<MoodEntry>(STORAGE_KEYS.moods);
export const scaleResultStore = createCollection<ScaleResult>(STORAGE_KEYS.scaleResults);
export const sandboxStore = createCollection<SandboxSnapshot>(STORAGE_KEYS.sandbox);
export const toolSessionStore = createCollection<ToolSession>(STORAGE_KEYS.toolSessions);
export const journalStore = createCollection<JournalEntry>(STORAGE_KEYS.journal);

/* -------------------------------------------------------------------------- */
/*                                  用户偏好                                   */
/* -------------------------------------------------------------------------- */

export const DEFAULT_PREFERENCES: Preferences = {
  acknowledgedDisclaimer: false,
  reducedMotion: false,
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
