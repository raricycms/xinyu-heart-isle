/**
 * `sessionStore` 的写入返回值语义。
 *
 * 回归背景（真实缺陷，v2.0 验收时发现）：
 * `saveSession()` 曾经**无条件 `return true`**，把 `sessionStore.upsert()`
 * 的结果丢掉。于是浏览器存储配额满 / 隐私模式 / 被禁用时：
 *
 *   1. 数据没写进去；
 *   2. 页面照样弹「沙盘已保存在这台设备上」；
 *   3. 用户关掉页面，数据永久丢失，而且他以为存好了。
 *
 * 这比「保存失败并报错」糟糕得多 —— 用户不会去重试，因为他不知道要重试。
 * 同源缺陷：`saveClient()` 返回 `void`，导致导入备份时
 * 「导入 50 个档案」结果为 0 条却报成功。
 *
 * 测试环境是 node（`vitest.config.ts` 的 `environment: 'node'`），
 * 所以用 `vi.stubGlobal` 造 localStorage，并在每次用例前 `resetModules`
 * 拿到全新的模块单例与缓存 —— 与 `storage.test.ts` 的做法一致。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* -------------------------------------------------------------------------- */
/*                              localStorage mock                              */
/* -------------------------------------------------------------------------- */

class MemoryStorage {
  private store = new Map<string, string>();
  /** 设为 true 时 setItem 抛 QuotaExceededError（模拟 5MB 配额溢出） */
  throwOnSet = false;

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
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

  rawGet(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
}

let storage: MemoryStorage;

/** 在干净的模块状态下加载 sessionStore（每次拿到独立单例与缓存） */
async function loadStore() {
  vi.resetModules();
  return import('@/lib/sessionStore');
}

function makeSession(id: string) {
  return {
    id,
    schemaVersion: 2 as const,
    at: '2026-10-27T00:00:00.000Z',
    mode: 'self' as const,
    sceneId: 'beach',
    items: [],
    events: [],
  };
}

/**
 * 一份**能通过 `validateSandplayFile` 的**最小会话。
 *
 * 校验器要求至少一个摆件 + 至少一条 `session.start` 事件；
 * 用 `makeSession` 那种空壳会在导入时被判不合法，
 * 那样测出来的是「校验失败」而不是「写失败」，会掩盖真正要测的东西。
 */
function makeValidSession(id: string) {
  const item = {
    id: 'i1',
    symbolId: 'tree',
    x: 0.5,
    y: 0.5,
    z: 1,
    scale: 1,
    rotation: 0,
    tone: 'neutral' as const,
  };
  return {
    id,
    schemaVersion: 2 as const,
    at: '2026-10-27T00:00:00.000Z',
    title: '导入测试',
    mode: 'self' as const,
    sceneId: 'beach',
    items: [item],
    events: [
      { t: 0, type: 'session.start' as const, payload: { sceneId: 'beach' } },
      { t: 1000, type: 'item.add' as const, itemId: 'i1', payload: { item } },
    ],
    locked: true,
    lockedAt: '2026-10-27T00:10:00.000Z',
  };
}

function makeClient(id: string) {
  return { id, alias: '小舟', at: '2026-10-27T00:00:00.000Z' };
}

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  // storage.ts 在模块加载时读 window；不 stub 会在 import 阶段抛错
  vi.stubGlobal('window', {
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: storage,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/*                          A. saveSession 不再撒谎                            */
/* -------------------------------------------------------------------------- */

describe('saveSession 的返回值必须真实', () => {
  it('正常写入返回 true', async () => {
    const { saveSession, getSession } = await loadStore();
    expect(saveSession(makeSession('s-ok') as never)).toBe(true);
    expect(getSession('s-ok')).not.toBeNull();
  });

  it('配额溢出时返回 false —— 绝不能假装成功', async () => {
    storage.throwOnSet = true;
    const { saveSession } = await loadStore();
    expect(saveSession(makeSession('s-fail') as never)).toBe(false);
  });

  it('写失败后不产生内存快照（读到的必须和磁盘一致）', async () => {
    storage.throwOnSet = true;
    const { saveSession, getSession } = await loadStore();
    saveSession(makeSession('s-ghost') as never);
    // 如果这里能拿到对象，说明内存里有一个磁盘上并不存在的「幽灵会话」：
    // 用户在当前页看得到，一刷新就没了。
    expect(getSession('s-ghost')).toBeNull();
  });

  it('写失败后磁盘上确实没有该键', async () => {
    storage.throwOnSet = true;
    const { saveSession } = await loadStore();
    saveSession(makeSession('s-ghost2') as never);
    expect(storage.rawGet('xinyu.sessions')).toBeNull();
  });

  it('恢复写入能力后能正常保存（失败不粘滞）', async () => {
    storage.throwOnSet = true;
    const { saveSession, getSession } = await loadStore();
    expect(saveSession(makeSession('s-retry') as never)).toBe(false);

    storage.throwOnSet = false;
    expect(saveSession(makeSession('s-retry') as never)).toBe(true);
    expect(getSession('s-retry')).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*                          B. saveClient 同样要真实                            */
/* -------------------------------------------------------------------------- */

describe('saveClient 的返回值必须真实', () => {
  it('正常写入返回 true', async () => {
    const { saveClient, listClients } = await loadStore();
    expect(saveClient(makeClient('c-ok') as never)).toBe(true);
    expect(listClients().some((entry) => entry.id === 'c-ok')).toBe(true);
  });

  it('配额溢出时返回 false', async () => {
    storage.throwOnSet = true;
    const { saveClient } = await loadStore();
    expect(saveClient(makeClient('c-fail') as never)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*              C. 导入备份时，写失败必须计进 failed 而不是 imported            */
/* -------------------------------------------------------------------------- */

describe('导入备份时的失败必须被计数', () => {
  /**
   * 端到端版本：走真实的 `importArchiveEnvelope` + 真实的 `defaultImportDeps`，
   * 只把底层 localStorage 弄坏。这样测的是「接线对不对」，
   * 而不是「某个 mock 返回了什么」。
   */
  it('写失败的会话计入 failed，imported 为 0', async () => {
    const { saveSession } = await loadStore();
    const { importArchiveEnvelope, buildArchiveEnvelope } = await import(
      '@/sandbox/archive/archive'
    );

    const envelope = buildArchiveEnvelope([makeValidSession('s-import') as never], []);

    storage.throwOnSet = true;
    const result = importArchiveEnvelope(envelope, {
      existingSessionIds: new Set<string>(),
      existingClientIds: new Set<string>(),
      saveSession: (s) => saveSession(s),
      saveClient: () => true,
    });

    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('写成功时计入 imported，failed 为 0', async () => {
    const { saveSession } = await loadStore();
    const { importArchiveEnvelope, buildArchiveEnvelope } = await import(
      '@/sandbox/archive/archive'
    );

    const envelope = buildArchiveEnvelope([makeValidSession('s-import2') as never], []);

    const result = importArchiveEnvelope(envelope, {
      existingSessionIds: new Set<string>(),
      existingClientIds: new Set<string>(),
      saveSession: (s) => saveSession(s),
      saveClient: () => true,
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
  });
});
