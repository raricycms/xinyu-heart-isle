/**
 * 心屿 · IndexedDB 持久化层（v2）
 *
 * 为什么还要 IndexedDB：
 * - 会话含事件流（20~60KB）与缩略图（几十 KB），localStorage 5MB 配额很快会满；
 * - 缩略图 / 录音 / 自定义图是二进制，localStorage 只能塞 dataURL，体积翻倍。
 *
 * 设计约束（与 localStorage 层保持同样的语义）：
 * 1. **纯本地**：没有任何网络调用；
 * 2. **可降级**：浏览器不支持 / 隐私模式禁用时，自动回落到 localStorage 兼容路径，
 *    上层代码不需要感知；
 * 3. **稳定引用**：读取结果缓存，仅在写入时失效，配合 useSyncExternalStore 使用。
 */

import type { LocalClient, SandSession } from '@/lib/types';

const DB_NAME = 'xinyu-db';
const DB_VERSION = 2;

/** 对象仓库 */
export const STORES = {
  /** 沙盘会话（keyPath: id） */
  sessions: 'sessions',
  /** 本地档案（keyPath: id） */
  clients: 'clients',
  /** 缩略图与大二进制（keyPath: id） */
  assets: 'assets',
  /** 会话标注（独立存储，便于按 sessionId 索引） */
  annotations: 'annotations',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

export interface IdbAsset {
  id: string;
  sessionId?: string;
  kind: 'thumbnail' | 'audio' | 'image';
  /** Blob 或 dataURL 字符串 */
  data: Blob | string;
  at: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const done = (value: IDBDatabase | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    // 隐私模式 / 老浏览器可能直接抛错，必须 try/catch 而不是只靠 onerror
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      done(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.sessions)) {
        const store = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
        store.createIndex('by_at', 'at');
        store.createIndex('by_client', 'meta.clientRef');
      }
      if (!db.objectStoreNames.contains(STORES.clients)) {
        db.createObjectStore(STORES.clients, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.assets)) {
        const store = db.createObjectStore(STORES.assets, { keyPath: 'id' });
        store.createIndex('by_session', 'sessionId');
        store.createIndex('by_kind', 'kind');
      }
      if (!db.objectStoreNames.contains(STORES.annotations)) {
        const store = db.createObjectStore(STORES.annotations, { keyPath: 'id' });
        store.createIndex('by_session', 'sessionId');
      }
    };

    request.onsuccess = () => done(request.result);
    request.onerror = () => done(null);
    request.onblocked = () => done(null);
    // 某些环境下 open 既不 success 也不 error，加一个超时兜底
    window.setTimeout(() => done(null), 3000);
  });

  return dbPromise;
}

/** 是否可用（异步探测，结果缓存） */
export async function idbAvailable(): Promise<boolean> {
  const db = await openDb();
  return db !== null;
}

function tx<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        let settled = false;
        const done = (value: T | null) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        };
        try {
          const transaction = db.transaction(storeName, mode);
          const store = transaction.objectStore(storeName);
          const request = run(store);
          request.onsuccess = () => done(request.result as T);
          request.onerror = () => done(null);
          transaction.onerror = () => done(null);
          transaction.onabort = () => done(null);
        } catch {
          done(null);
        }
      }),
  );
}

/* -------------------------------------------------------------------------- */
/*                                  会话读写                                   */
/* -------------------------------------------------------------------------- */

export async function idbPutSession(session: SandSession): Promise<boolean> {
  const result = await tx<IDBValidKey>(STORES.sessions, 'readwrite', (store) => store.put(session));
  if (result !== null) invalidateIdbCache();
  return result !== null;
}

export async function idbGetSession(id: string): Promise<SandSession | null> {
  return (await tx<SandSession>(STORES.sessions, 'readonly', (store) => store.get(id))) ?? null;
}

export async function idbGetAllSessions(): Promise<SandSession[]> {
  const list = await tx<SandSession[]>(STORES.sessions, 'readonly', (store) => store.getAll());
  if (!list) return [];
  return [...list].sort((a, b) => b.at.localeCompare(a.at));
}

export async function idbDeleteSession(id: string): Promise<boolean> {
  const result = await tx<undefined>(STORES.sessions, 'readwrite', (store) => store.delete(id));
  invalidateIdbCache();
  // 同时清理关联资源
  await tx<undefined>(STORES.assets, 'readwrite', (store) => store.delete(id));
  return result !== null;
}

export async function idbClearSessions(): Promise<void> {
  await tx<undefined>(STORES.sessions, 'readwrite', (store) => store.clear());
  invalidateIdbCache();
}

/* -------------------------------------------------------------------------- */
/*                                  档案读写                                   */
/* -------------------------------------------------------------------------- */

export async function idbPutClient(client: LocalClient): Promise<boolean> {
  const result = await tx<IDBValidKey>(STORES.clients, 'readwrite', (store) => store.put(client));
  invalidateIdbCache();
  return result !== null;
}

export async function idbGetAllClients(): Promise<LocalClient[]> {
  const list = await tx<LocalClient[]>(STORES.clients, 'readonly', (store) => store.getAll());
  if (!list) return [];
  return [...list].sort((a, b) => b.at.localeCompare(a.at));
}

export async function idbDeleteClient(id: string): Promise<boolean> {
  const result = await tx<undefined>(STORES.clients, 'readwrite', (store) => store.delete(id));
  invalidateIdbCache();
  return result !== null;
}

/* -------------------------------------------------------------------------- */
/*                                  资源读写                                   */
/* -------------------------------------------------------------------------- */

export async function idbPutAsset(asset: IdbAsset): Promise<boolean> {
  const result = await tx<IDBValidKey>(STORES.assets, 'readwrite', (store) => store.put(asset));
  return result !== null;
}

export async function idbGetAsset(id: string): Promise<IdbAsset | null> {
  return (await tx<IdbAsset>(STORES.assets, 'readonly', (store) => store.get(id))) ?? null;
}

export async function idbDeleteAsset(id: string): Promise<void> {
  await tx<undefined>(STORES.assets, 'readwrite', (store) => store.delete(id));
}

/* -------------------------------------------------------------------------- */
/*                               缓存 + 订阅                                   */
/* -------------------------------------------------------------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();
const cache = new Map<string, unknown>();

function invalidateIdbCache(): void {
  cache.clear();
  listeners.forEach((fn) => fn());
}

export function subscribeIdb(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 读取并缓存（供 useSyncExternalStore 使用，保证引用稳定） */
export async function cachedSessions(): Promise<SandSession[]> {
  const key = 'sessions';
  if (cache.has(key)) return cache.get(key) as SandSession[];
  const list = await idbGetAllSessions();
  cache.set(key, list);
  return list;
}

export async function cachedClients(): Promise<LocalClient[]> {
  const key = 'clients';
  if (cache.has(key)) return cache.get(key) as LocalClient[];
  const list = await idbGetAllClients();
  cache.set(key, list);
  return list;
}

/** 强制刷新缓存（导入/清空后调用） */
export function refreshIdbCache(): void {
  invalidateIdbCache();
}

/* -------------------------------------------------------------------------- */
/*                                 全量导出                                    */
/* -------------------------------------------------------------------------- */

export interface IdbExport {
  sessions: SandSession[];
  clients: LocalClient[];
}

export async function exportIdb(): Promise<IdbExport> {
  return {
    sessions: await idbGetAllSessions(),
    clients: await idbGetAllClients(),
  };
}

export async function importIdb(bundle: Partial<IdbExport>): Promise<void> {
  for (const session of bundle.sessions ?? []) {
    await idbPutSession(session);
  }
  for (const client of bundle.clients ?? []) {
    await idbPutClient(client);
  }
  invalidateIdbCache();
}

export async function clearIdb(): Promise<void> {
  await tx<undefined>(STORES.sessions, 'readwrite', (store) => store.clear());
  await tx<undefined>(STORES.clients, 'readwrite', (store) => store.clear());
  await tx<undefined>(STORES.assets, 'readwrite', (store) => store.clear());
  await tx<undefined>(STORES.annotations, 'readwrite', (store) => store.clear());
  invalidateIdbCache();
}
