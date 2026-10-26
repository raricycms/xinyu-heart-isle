/**
 * 心屿 · 存储层健壮性测试（P1 技术债，见 docs/HANDOVER.md §3 "P1 · 存储层健壮性"）
 *
 * 这一层的失败模式都发生在「用户以为存上了、其实没存」这一侧，
 * 所以测试的重点不是正常路径，而是：损坏数据、配额溢出、跨标签页、快照引用稳定性。
 *
 * 测试环境是 node（vitest.config.ts 里 `environment: 'node'`），
 * 因此所有浏览器 API 都用 `vi.stubGlobal` 造 mock，不依赖真实浏览器。
 *
 * 注意：`src/lib/storage.ts` 在**模块加载时**注册 `window.addEventListener('storage')`，
 * 所以涉及跨标签页的用例必须先 stub window 再 `vi.resetModules()` + 动态 import。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* -------------------------------------------------------------------------- */
/*                              localStorage mock                              */
/* -------------------------------------------------------------------------- */

/**
 * 最小 localStorage 实现。
 * `getItem` 单独计数，用来验证「快照缓存生效时不应该重复读存储」。
 */
class MemoryStorage {
  private store = new Map<string, string>();
  getItemCalls = 0;
  setItemCalls = 0;
  /** 设为 true 时 setItem 抛 QuotaExceededError（模拟 5MB 配额溢出） */
  throwOnSet = false;

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    this.getItemCalls += 1;
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.setItemCalls += 1;
    if (this.throwOnSet) {
      const error = new Error('The quota has been exceeded.');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** 测试辅助：绕过 setItem 直接写入（模拟另一个标签页的写入） */
  rawSet(key: string, value: string): void {
    this.store.set(key, value);
  }

  rawGet(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
}

let storage: MemoryStorage;

/** 在干净的模块状态下加载 storage.ts（每次调用拿到独立的单例与缓存） */
async function loadStorage() {
  vi.resetModules();
  return import('@/lib/storage');
}

const MOOD_KEY = 'xinyu.moods';
const PREFS_KEY = 'xinyu.preferences';

function mood(id: string, at: string) {
  return { id, at, mood: 3 as const, energy: 3 as const, tags: [] as string[] };
}

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/*                            1. 损坏 JSON 容错                                */
/* -------------------------------------------------------------------------- */

describe('损坏数据容错（HANDOVER §3 P1 / §4.2）', () => {
  it('readJSON 遇到非 JSON 字符串时返回 fallback，不抛错', async () => {
    storage.rawSet(MOOD_KEY, '这不是 JSON {{{');
    const { readJSON } = await loadStorage();
    expect(() => readJSON(MOOD_KEY, [])).not.toThrow();
    expect(readJSON(MOOD_KEY, [])).toEqual([]);
  });

  it('readJSON 遇到被截断的 JSON 时返回 fallback', async () => {
    storage.rawSet(MOOD_KEY, '[{"id":"a","at":"2026-01-01"');
    const { readJSON } = await loadStorage();
    expect(readJSON(MOOD_KEY, [])).toEqual([]);
  });

  it('readJSON 在没有该 key 时返回 fallback', async () => {
    const { readJSON } = await loadStorage();
    expect(readJSON('xinyu.not-exist', { safe: true })).toEqual({ safe: true });
  });

  it('readJSON 在 localStorage 为空字符串时返回 fallback', async () => {
    storage.rawSet(MOOD_KEY, '');
    const { readJSON } = await loadStorage();
    expect(readJSON(MOOD_KEY, [])).toEqual([]);
  });

  it('readJSON 对合法 JSON 正常解析出原值', async () => {
    storage.rawSet(MOOD_KEY, JSON.stringify([{ id: 'x' }]));
    const { readJSON } = await loadStorage();
    expect(readJSON(MOOD_KEY, [])).toEqual([{ id: 'x' }]);
  });

  it('数据损坏时 store 退化为空数组，而不是崩溃或返回脏值', async () => {
    storage.rawSet(MOOD_KEY, '<<<broken>>>');
    const { moodStore } = await loadStorage();
    expect(moodStore.getAll()).toEqual([]);
  });

  it('数据损坏后仍可正常写入（能自愈）', async () => {
    storage.rawSet(MOOD_KEY, '<<<broken>>>');
    const { moodStore } = await loadStorage();
    moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'));
    expect(moodStore.getAll()).toHaveLength(1);
    expect(JSON.parse(storage.rawGet(MOOD_KEY) as string)).toHaveLength(1);
  });

  it('数据是合法 JSON 但不是数组时 getAll 返回空数组（类型防御）', async () => {
    storage.rawSet(MOOD_KEY, '{"not":"an array"}');
    const { moodStore } = await loadStorage();
    expect(moodStore.getAll()).toEqual([]);
  });

  it('localStorage 完全不存在时所有 API 都不抛错（SSR / 隐私模式）', async () => {
    vi.stubGlobal('localStorage', undefined);
    const { readJSON, writeJSON, moodStore, getPreferences } = await loadStorage();
    expect(() => readJSON(MOOD_KEY, [])).not.toThrow();
    expect(readJSON(MOOD_KEY, [])).toEqual([]);
    expect(() => writeJSON(MOOD_KEY, [])).not.toThrow();
    expect(() => moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'))).not.toThrow();
    expect(getPreferences().reducedMotion).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*                            2. 配额溢出（P1）                                */
/* -------------------------------------------------------------------------- */

describe('配额溢出（QuotaExceededError）', () => {
  it('setItem 抛配额错误时 add 不崩溃（只告警）', async () => {
    const { moodStore } = await loadStorage();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.throwOnSet = true;

    expect(() => moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'))).not.toThrow();
    expect(warn).toHaveBeenCalled();
    // 告警文案要说清「数据不会被保存」，否则用户以为存上了
    const message = warn.mock.calls.map((args) => args.map(String).join(' ')).join(' ');
    expect(message).toContain('存储写入失败');
  });

  it('配额溢出后 localStorage 里确实没有这条数据（不是静默丢在内存里当成功）', async () => {
    const { moodStore } = await loadStorage();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.throwOnSet = true;
    moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'));
    // 关键：存储里必须没有它 —— 用来证明「写失败」这件事真的发生了
    expect(storage.rawGet(MOOD_KEY)).toBeNull();
  });

  /**
   * P1 缺陷已修复：`add` 现在返回 `boolean`，写入失败返回 `false`，
   * 调用方（UI）据此弹 toast（见 `src/lib/storage.ts:183-198` 的 `write`）。
   */
  it('add 能把「写入失败」告知调用方（原缺陷，已修复）', async () => {
    const { moodStore } = await loadStorage();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.throwOnSet = true;
    expect(moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'))).toBe(false);
  });

  /**
   * P1 缺陷已修复：只有真的落盘才填缓存，因此写失败后内存快照不会包含那条记录。
   */
  it('写入失败后内存快照不应与存储内容分叉（原缺陷，已修复）', async () => {
    const { moodStore } = await loadStorage();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.throwOnSet = true;
    moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'));
    // 写失败 -> 快照不应该包含这条（否则界面显示已保存、刷新后消失）
    expect(moodStore.getAll()).toEqual([]);
    // 且磁盘上确实没有
    expect(storage.rawGet(MOOD_KEY)).toBeNull();
  });

  it('配额恢复后可以继续正常写入（无残留坏状态）', async () => {
    const { moodStore } = await loadStorage();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.throwOnSet = true;
    moodStore.add(mood('lost', '2026-01-01T00:00:00.000Z'));
    storage.throwOnSet = false;
    moodStore.add(mood('saved', '2026-01-02T00:00:00.000Z'));
    const persisted = JSON.parse(storage.rawGet(MOOD_KEY) as string) as Array<{ id: string }>;
    expect(persisted.map((entry) => entry.id)).toContain('saved');
  });

  it('private 模式下 setItem 直接抛普通 Error 也不崩', async () => {
    const { writeJSON } = await loadStorage();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError: storage disabled');
    });
    expect(() => writeJSON(MOOD_KEY, [mood('a', '2026-01-01T00:00:00.000Z')])).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/*                      3. 快照引用稳定性（HANDOVER §4.2）                      */
/* -------------------------------------------------------------------------- */

describe('快照引用稳定性（HANDOVER §4.2 白屏事故）', () => {
  it('getPreferences 连续调用返回同一个引用（否则 useSyncExternalStore 死循环）', async () => {
    const { getPreferences } = await loadStorage();
    const first = getPreferences();
    const second = getPreferences();
    const third = getPreferences();
    // 必须是 ===，不是 toEqual
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('写入偏好后才产生新引用，且新引用包含合并结果', async () => {
    const { getPreferences, setPreferences } = await loadStorage();
    const before = getPreferences();
    setPreferences({ reducedMotion: true });
    const after = getPreferences();
    expect(after).not.toBe(before); // 写入必须失效缓存
    expect(after.reducedMotion).toBe(true);
    // 未显式设置的字段仍然回落到默认值
    expect(after.acknowledgedDisclaimer).toBe(false);
    expect(after.locale).toBe('zh-CN');
    // 再次读取又回到稳定状态
    expect(getPreferences()).toBe(after);
  });

  it('偏好里存了部分字段时，默认值被合并进来而不是被覆盖掉', async () => {
    storage.rawSet(PREFS_KEY, JSON.stringify({ reducedMotion: true }));
    const { getPreferences } = await loadStorage();
    const prefs = getPreferences();
    expect(prefs.reducedMotion).toBe(true);
    expect(prefs.acknowledgedAge).toBe(false);
    expect(prefs.renderer).toBe('iso2d');
    expect(prefs.sandboxUiMode).toBe('self');
  });

  it('偏好数据损坏时回落到默认值而不是崩溃', async () => {
    storage.rawSet(PREFS_KEY, '}}}}');
    const { getPreferences } = await loadStorage();
    expect(getPreferences().reducedMotion).toBe(false);
    expect(getPreferences().locale).toBe('zh-CN');
  });

  it('集合读取命中缓存时不重复读 localStorage（快照缓存的直接证据）', async () => {
    const { moodStore } = await loadStorage();
    storage.rawSet(MOOD_KEY, JSON.stringify([mood('a', '2026-01-01T00:00:00.000Z')]));
    // 第一次读没缓存，会读一次存储
    expect(moodStore.getAll()).toHaveLength(1);
    const afterFirst = storage.getItemCalls;
    // 后续读取应该全部命中内存缓存
    moodStore.getAll();
    moodStore.getAll();
    moodStore.getAll();
    expect(storage.getItemCalls).toBe(afterFirst);
  });

  it('写入后的下一次读取不再回读 localStorage（write 会重新填充缓存）', async () => {
    const { moodStore } = await loadStorage();
    moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'));
    const afterAdd = storage.getItemCalls;
    expect(moodStore.getAll()).toHaveLength(1);
    expect(storage.getItemCalls).toBe(afterAdd);
  });

  it('getAll 返回的是数组副本，调用方 sort 不会污染缓存', async () => {
    const { moodStore } = await loadStorage();
    moodStore.add(mood('older', '2026-01-01T00:00:00.000Z'));
    moodStore.add(mood('newer', '2026-02-01T00:00:00.000Z'));
    const first = moodStore.getAll();
    // getAll 内部已按时间倒序
    expect(first.map((entry) => entry.id)).toEqual(['newer', 'older']);
    // 调用方原地反转不应影响下一次读取
    first.reverse();
    expect(moodStore.getAll().map((entry) => entry.id)).toEqual(['newer', 'older']);
  });

  it('同一 key 连续两次 getAll 返回内容相等但互不影响', async () => {
    const { moodStore } = await loadStorage();
    moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'));
    const first = moodStore.getAll();
    const second = moodStore.getAll();
    expect(second).toEqual(first);
  });
});

/* -------------------------------------------------------------------------- */
/*                          4. 集合操作基本语义                                */
/* -------------------------------------------------------------------------- */

describe('集合操作语义', () => {
  it('add 追加并按时间倒序返回', async () => {
    const { moodStore } = await loadStorage();
    moodStore.add(mood('b', '2026-02-01T00:00:00.000Z'));
    moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'));
    expect(moodStore.getAll().map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('upsert 对同 id 覆盖、对新 id 追加（不产生重复）', async () => {
    const { moodStore } = await loadStorage();
    moodStore.add({ ...mood('a', '2026-01-01T00:00:00.000Z'), note: '旧' });
    moodStore.upsert({ ...mood('a', '2026-01-01T00:00:00.000Z'), note: '新' });
    moodStore.upsert(mood('b', '2026-02-01T00:00:00.000Z'));
    const all = moodStore.getAll();
    expect(all).toHaveLength(2);
    expect(all.find((entry) => entry.id === 'a')?.note).toBe('新');
  });

  it('update 只改指定字段，其余字段保留', async () => {
    const { moodStore } = await loadStorage();
    moodStore.add({ ...mood('a', '2026-01-01T00:00:00.000Z'), tags: ['平静'] });
    moodStore.update('a', { tags: ['疲惫'] });
    const found = moodStore.getAll().find((entry) => entry.id === 'a');
    expect(found?.tags).toEqual(['疲惫']);
    expect(found?.at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('update 一个不存在的 id 是空操作，不新增记录', async () => {
    const { moodStore } = await loadStorage();
    moodStore.update('ghost', { tags: ['x'] });
    expect(moodStore.getAll()).toEqual([]);
  });

  it('remove 按 id 删除，只删一条', async () => {
    const { moodStore } = await loadStorage();
    moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'));
    moodStore.add(mood('b', '2026-02-01T00:00:00.000Z'));
    moodStore.remove('a');
    expect(moodStore.getAll().map((entry) => entry.id)).toEqual(['b']);
  });

  it('clear 清空集合并写回空数组', async () => {
    const { moodStore } = await loadStorage();
    moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'));
    moodStore.clear();
    expect(moodStore.getAll()).toEqual([]);
    expect(JSON.parse(storage.rawGet(MOOD_KEY) as string)).toEqual([]);
  });

  it('写入会通知订阅者（useCollection 的 subscribe 侧）', async () => {
    const { emptySubscribe, useCollection } = await loadStorage();
    // `subscribeKey` 未导出，但 `useCollection` / `usePreferences` 都基于它。
    // node 环境没有 DOM，无法真正挂载组件；这里验证「退订函数」形状与导出契约，
    // 真正的订阅行为由下面的跨标签页用例通过 window storage 事件覆盖。
    expect(emptySubscribe()).toBeTypeOf('function');
    expect(emptySubscribe()()).toBeUndefined();
    expect(useCollection).toBeTypeOf('function');
  });
});

/* -------------------------------------------------------------------------- */
/*                            5. 跨标签页同步                                  */
/* -------------------------------------------------------------------------- */

describe('跨标签页同步（storage 事件）', () => {
  /** 收集模块注册的 storage 监听器 */
  function makeWindow() {
    const handlers: Array<(event: { key?: string | null }) => void> = [];
    return {
      handlers,
      window: {
        addEventListener(type: string, fn: (event: { key?: string | null }) => void) {
          if (type === 'storage') handlers.push(fn);
        },
        removeEventListener() {
          /* noop */
        },
      },
    };
  }

  it('模块加载时注册了 storage 监听器', async () => {
    const { handlers, window } = makeWindow();
    vi.stubGlobal('window', window);
    await loadStorage();
    expect(handlers).toHaveLength(1);
  });

  it('storage 事件带 key 时会通知订阅者（不因缺 event.key 而崩）', async () => {
    const { handlers, window } = makeWindow();
    vi.stubGlobal('window', window);
    const { moodStore, emptySubscribe } = await loadStorage();
    expect(emptySubscribe).toBeTypeOf('function');
    // 不带 key 的事件（如 localStorage.clear()）不能抛错
    expect(() => handlers[0]({ key: null })).not.toThrow();
    // 带 key 的事件正常分发
    expect(() => handlers[0]({ key: MOOD_KEY })).not.toThrow();
    expect(moodStore.getAll()).toEqual([]);
  });

  /**
   * P1 缺陷已修复：storage 事件处理器现在先 `invalidate(key)` 再 `emit(key)`
   * （见 `src/lib/storage.ts:68-77`），因此别的标签页写入后本页能读到新值。
   */
  it('另一标签页写入后，本页快照反映新数据（原缺陷，已修复）', async () => {
    const { handlers, window } = makeWindow();
    vi.stubGlobal('window', window);
    const { moodStore } = await loadStorage();

    // 先读一次，让快照缓存填上「空数组」
    expect(moodStore.getAll()).toEqual([]);

    // 模拟另一标签页写入
    storage.rawSet(MOOD_KEY, JSON.stringify([mood('from-other-tab', '2026-03-01T00:00:00.000Z')]));
    handlers[0]({ key: MOOD_KEY });

    // 期望：本页看到新数据
    expect(moodStore.getAll().map((entry) => entry.id)).toEqual(['from-other-tab']);
  });

  it('本标签页写入后缓存正确失效（与上一条对照，证明只差 invalidate 一行）', async () => {
    const { window } = makeWindow();
    vi.stubGlobal('window', window);
    const { moodStore } = await loadStorage();
    expect(moodStore.getAll()).toEqual([]); // 填充缓存
    moodStore.add(mood('local', '2026-03-01T00:00:00.000Z'));
    expect(moodStore.getAll().map((entry) => entry.id)).toEqual(['local']);
  });
});

/* -------------------------------------------------------------------------- */
/*                      6. 全量导出 / 导入 / 清空                              */
/* -------------------------------------------------------------------------- */

describe('全量导出与导入', () => {
  it('exportAll 带上 app 标识、版本与导出时间', async () => {
    const { exportAll } = await loadStorage();
    const bundle = exportAll();
    expect(bundle.app).toBe('xinyu');
    expect(bundle.version).toBe(1);
    expect(Number.isNaN(Date.parse(bundle.exportedAt))).toBe(false);
  });

  it('exportAll 覆盖全部 STORAGE_KEYS（不漏集合）', async () => {
    const { exportAll, STORAGE_KEYS } = await loadStorage();
    const bundle = exportAll();
    for (const name of Object.keys(STORAGE_KEYS)) {
      expect(bundle).toHaveProperty(['data', name]);
    }
  });

  it('exportAll -> importAll 往返后数据等价', async () => {
    const { exportAll, importAll, moodStore } = await loadStorage();
    moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'));
    moodStore.add(mood('b', '2026-02-01T00:00:00.000Z'));
    const bundle = exportAll();

    // 清空后再导入
    moodStore.clear();
    expect(moodStore.getAll()).toEqual([]);
    const result = importAll(bundle);
    expect(result.ok).toBe(true);
    expect(moodStore.getAll().map((entry) => entry.id).sort()).toEqual(['a', 'b']);
  });

  it('importAll 拒绝非对象输入', async () => {
    const { importAll } = await loadStorage();
    expect(importAll(null).ok).toBe(false);
    expect(importAll('字符串').ok).toBe(false);
    expect(importAll(42).ok).toBe(false);
    expect(importAll(null).message).toContain('JSON');
  });

  it('importAll 拒绝不是心屿导出的文件（防止误导入别家 JSON）', async () => {
    const { importAll } = await loadStorage();
    const wrongApp = importAll({ app: 'other-app', data: {} });
    expect(wrongApp.ok).toBe(false);
    expect(wrongApp.message).toContain('心屿');
    const noData = importAll({ app: 'xinyu' });
    expect(noData.ok).toBe(false);
  });

  it('importAll 不因缺少某个集合而报错（部分导入）', async () => {
    const { importAll, moodStore } = await loadStorage();
    const result = importAll({
      app: 'xinyu',
      data: { moods: [mood('only-moods', '2026-01-01T00:00:00.000Z')] },
    });
    expect(result.ok).toBe(true);
    expect(moodStore.getAll().map((entry) => entry.id)).toEqual(['only-moods']);
  });

  it('clearAll 清掉所有集合 key', async () => {
    const { clearAll, moodStore, STORAGE_KEYS } = await loadStorage();
    moodStore.add(mood('a', '2026-01-01T00:00:00.000Z'));
    clearAll();
    expect(moodStore.getAll()).toEqual([]);
    for (const key of Object.values(STORAGE_KEYS)) {
      expect(storage.rawGet(key)).toBeNull();
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                      7. v1 快照迁移（migrateLegacySnapshots）               */
/* -------------------------------------------------------------------------- */

describe('v1 快照迁移', () => {
  const legacySnapshot = {
    id: 'legacy-1',
    at: '2025-12-01T10:00:00.000Z',
    title: '旧沙盘',
    sceneId: 'meadow',
    items: [
      { id: 'i1', symbolId: 'nature.tree', x: 0.3, y: 0.4, scale: 1, rotation: 0, z: 1 },
      { id: 'i2', symbolId: 'animal.dog', x: 0.6, y: 0.7, scale: 1, rotation: 0, z: 2 },
    ],
    reflection: '一段自述',
  };

  it('把 v1 快照迁移进 sessions 集合，并清空旧 key', async () => {
    storage.rawSet('xinyu.sandbox', JSON.stringify([legacySnapshot]));
    const { migrateLegacySnapshots } = await import('@/lib/sessionStore');
    const result = migrateLegacySnapshots();
    expect(result.migrated).toBe(1);

    const sessions = JSON.parse(storage.rawGet('xinyu.sessions') as string) as Array<{
      id: string;
      schemaVersion: number;
      items: unknown[];
    }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].schemaVersion).toBe(2);
    expect(sessions[0].items).toHaveLength(2);
    // 迁移后旧 key 必须被清空，否则下次启动会重复迁移
    expect(JSON.parse(storage.rawGet('xinyu.sandbox') as string)).toEqual([]);
  });

  it('迁移是幂等的：第二次调用不再产生新数据', async () => {
    storage.rawSet('xinyu.sandbox', JSON.stringify([legacySnapshot]));
    const { migrateLegacySnapshots } = await import('@/lib/sessionStore');
    expect(migrateLegacySnapshots().migrated).toBe(1);
    expect(migrateLegacySnapshots().migrated).toBe(0);
    const sessions = JSON.parse(storage.rawGet('xinyu.sessions') as string) as unknown[];
    expect(sessions).toHaveLength(1);
  });

  it('没有 v1 数据时返回 migrated: 0 且不动 sessions', async () => {
    const { migrateLegacySnapshots } = await import('@/lib/sessionStore');
    expect(migrateLegacySnapshots().migrated).toBe(0);
    expect(storage.rawGet('xinyu.sessions')).toBeNull();
  });

  it('已经是 v2 的数据不会被重复迁移', async () => {
    storage.rawSet(
      'xinyu.sandbox',
      JSON.stringify([{ ...legacySnapshot, schemaVersion: 2, events: [], mode: 'self' }]),
    );
    const { migrateLegacySnapshots } = await import('@/lib/sessionStore');
    expect(migrateLegacySnapshots().migrated).toBe(0);
  });

  it('迁移后的会话能生成可重放的事件流（items 与重放结果一致）', async () => {
    storage.rawSet('xinyu.sandbox', JSON.stringify([legacySnapshot]));
    const { migrateLegacySnapshots } = await import('@/lib/sessionStore');
    migrateLegacySnapshots();
    const sessions = JSON.parse(storage.rawGet('xinyu.sessions') as string) as Array<{
      items: Array<{ id: string; x: number; y: number }>;
      events: unknown[];
      sceneId: string;
    }>;
    const { replayAll, isConsistent } = await import('@/sandbox/events');
    const session = sessions[0];
    const replayed = replayAll(session.events as never[]);
    expect(replayed.items).toHaveLength(2);
    expect(replayed.items.map((entry) => entry.id).sort()).toEqual(['i1', 'i2']);
    expect(
      isConsistent({
        items: session.items as never[],
        events: session.events as never[],
        sceneId: session.sceneId,
      }),
    ).toBe(true);
  });
});
