import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * IndexedDB 降级路径的单元测试。
 *
 * ── 为什么这个文件存在 ──────────────────────────────────────────
 *
 * `docs/TESTING.md` §6.2.8 长期写着「`src/lib/idb.ts` 的降级逻辑未单测
 * （需要真实 IDB）」。这句话把一件能测的事说成了不能测的事。
 *
 * 降级逻辑的触发条件是 `typeof indexedDB === 'undefined'` ——
 * 这**不需要真实 IDB**，只需要把这个全局拿掉。
 * 用 `vi.stubGlobal('indexedDB', undefined)` 就够了。
 *
 * ── 为什么这个缺口重要 ──────────────────────────────────────────
 *
 * 用户浏览器禁用 IndexedDB（隐私模式、企业策略、老浏览器）时会
 * 走到这条路上。如果它坏了，症状是**数据存不下来且没有报错** ——
 * 用户摆了一小时沙盘，关掉页面全没了。
 *
 * 静默丢数据是最危险的一类失败：它不产生任何反馈，用户不会报告。
 *
 * ── 测试隔离 ────────────────────────────────────────────────────
 *
 * `idb.ts` 用模块级变量 `dbPromise` 缓存连接，所以每个用例都要
 * `vi.resetModules()` + 动态 `import()`，否则上一个用例的 null
 * 会被下一个用例继承，测出来的全是假的。
 */

describe('IndexedDB 不可用时的降级', () => {
  beforeEach(() => {
    vi.resetModules();
    /* 模拟「浏览器没有 indexedDB」：隐私模式 / 企业策略 / 老浏览器 */
    vi.stubGlobal('indexedDB', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('没有 indexedDB 时 idbAvailable() 返回 false', async () => {
    const { idbAvailable } = await import('./idb');
    await expect(idbAvailable()).resolves.toBe(false);
  });

  it('写会话返回 false（不抛错）', async () => {
    const { idbPutSession } = await import('./idb');
    const session = {
      id: 's1',
      at: new Date().toISOString(),
      mode: 'self' as const,
      sceneId: 'beach',
      items: [],
      events: [],
      cursor: 0,
      meta: {},
    };
    /*
     * 关键断言：返回 false 而不是抛异常。
     *
     * 调用方（sessionStore）靠这个布尔值决定要不要回落到
     * localStorage。如果这里改成抛错，调用方没接住就是白屏。
     */
    await expect(idbPutSession(session as never)).resolves.toBe(false);
  });

  it('读会话返回 null', async () => {
    const { idbGetSession } = await import('./idb');
    await expect(idbGetSession('nope')).resolves.toBeNull();
  });

  it('列会话返回空数组', async () => {
    const { idbGetAllSessions } = await import('./idb');
    await expect(idbGetAllSessions()).resolves.toEqual([]);
  });

  it('删会话返回 false', async () => {
    const { idbDeleteSession } = await import('./idb');
    await expect(idbDeleteSession('nope')).resolves.toBe(false);
  });

  it('清空会话不抛错', async () => {
    const { idbClearSessions } = await import('./idb');
    await expect(idbClearSessions()).resolves.toBeUndefined();
  });

  it('客户端读写同样降级（写 false / 读空数组）', async () => {
    const { idbPutClient, idbGetAllClients } = await import('./idb');
    await expect(
      idbPutClient({ id: 'c1', alias: 'A', at: new Date().toISOString() } as never),
    ).resolves.toBe(false);
    await expect(idbGetAllClients()).resolves.toEqual([]);
  });

  it('资产读写同样降级', async () => {
    const { idbPutAsset, idbGetAsset } = await import('./idb');
    await expect(
      idbPutAsset({ id: 'a1', sessionId: 's1', kind: 'thumb', data: '', at: '' } as never),
    ).resolves.toBe(false);
    await expect(idbGetAsset('nope')).resolves.toBeNull();
  });

  it('缓存读出来的也是空（不能凭空造数据）', async () => {
    const { cachedSessions, cachedClients } = await import('./idb');
    await expect(cachedSessions()).resolves.toEqual([]);
    await expect(cachedClients()).resolves.toEqual([]);
  });

  it('exportIdb 在无 IDB 时给出空包而不是抛错', async () => {
    const { exportIdb } = await import('./idb');
    const bundle = await exportIdb();
    expect(bundle).toBeTruthy();
    expect(bundle.sessions).toEqual([]);
    expect(bundle.clients).toEqual([]);
  });
});

describe('IndexedDB 的 open 直接抛错时也要降级', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('indexedDB.open 抛错时不崩、返回 false', async () => {
    /*
     * 这是和上面不同的失败模式：indexedDB 存在，但 open() 直接抛
     * （Safari 隐私模式下有过这种表现）。
     *
     * idb.ts 的注释明确写了「隐私模式 / 老浏览器可能直接抛错，
     * 必须 try/catch 而不是只靠 onerror」—— 这条注释承诺的行为
     * 必须被测到，否则它又是一句没人验过的注释。
     */
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('SecurityError: 隐私模式下禁止使用 IndexedDB');
      },
    });
    const { idbAvailable, idbGetAllSessions } = await import('./idb');
    await expect(idbAvailable()).resolves.toBe(false);
    await expect(idbGetAllSessions()).resolves.toEqual([]);
  });

  it('open 触发 onerror 时降级', async () => {
    /*
     * 第三种失败模式：open() 不抛错，但返回的 request 后来 onerror。
     * 用一个最小的假 request 对象模拟 —— 只要 idb.ts 挂了
     * onerror 回调并 done(null)，这条就通。
     */
    const fakeRequest: Record<string, unknown> = {
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
      result: null,
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        /* 异步回调 onerror，模拟打开失败 */
        setTimeout(() => {
          const handler = fakeRequest.onerror as (() => void) | null;
          if (handler) handler();
        }, 0);
        return fakeRequest;
      },
    });
    const { idbAvailable } = await import('./idb');
    await expect(idbAvailable()).resolves.toBe(false);
  });
});

describe('IndexedDB 可用时不能误判成不可用', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('open 成功时 idbAvailable() 返回 true', async () => {
    /*
     * 反向断言：只测「不可用时返回 false」是半张测试。
     *
     * 如果实现写成 `return false`（恒假），上面 10 个用例全绿，
     * 而真实用户（IDB 正常）反而拿不到能力。
     * 所以必须有一条证明"可用时确实返回 true"。
     */
    const fakeDb = { objectStoreNames: { contains: () => true } };
    const fakeRequest: Record<string, unknown> = {
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
      result: fakeDb,
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        setTimeout(() => {
          const handler = fakeRequest.onsuccess as (() => void) | null;
          if (handler) handler();
        }, 0);
        return fakeRequest;
      },
    });
    const { idbAvailable } = await import('./idb');
    await expect(idbAvailable()).resolves.toBe(true);
  });
});
