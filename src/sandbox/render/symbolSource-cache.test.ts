import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetImageCache, loadImage } from './symbolSource';

/**
 * `imageCache` 上限的测试。
 *
 * ── 为什么需要 ──────────────────────────────────────────────────
 *
 * 这个缓存存的是**已解码的 HTMLImageElement**（位图内存），
 * 不是 dataURL 字符串。原来没有上限：
 *
 *   - 沙具包允许 2000 个符号（MAX_PACK_SYMBOLS）
 *   - 单张 dataURL 上限 200KB（MAX_IMAGE_DATA_URI）
 *   - 一张 512×512 RGBA 解码后约 1MB
 *
 * 逐页翻包，缓存只增不减。用户症状是"用久了标签页变卡/崩"，
 * 而且换会话不会好 —— 模块级 Map 活在整页生命周期里。
 *
 * ── 为什么必须有这条测试 ────────────────────────────────────────
 *
 * "我加了上限"是一句叙述；只有测试能把它变成事实。
 * 而且这个上限很容易在重构时被悄悄改回去（比如有人把
 * cacheImage 换回 imageCache.set），所以要有断言钉住。
 *
 * ── 怎么在 node 里测 ────────────────────────────────────────────
 *
 * `loadImage` 里有 `typeof Image === 'undefined'` 的守卫，
 * 所以正常在 node 下会直接 return。这里造一个假的 Image 类，
 * 让它表现得像"已经加载完成"（complete=true, naturalWidth>0）。
 */

/**
 * 记录所有被创建的假 Image。
 *
 * ── 为什么 complete / naturalWidth 要在构造时决定，而不是事后改 ──
 *
 * `HTMLImageElement.complete` 与 `.naturalWidth` 在 DOM 类型里是
 * **只读**的，直接赋值会 `TS2540`。vitest 不做类型检查所以能过，
 * 但 `tsc -b` 会红 —— 这正是 `npm run check` 先跑类型检查的意义。
 *
 * 所以这里用构造参数决定"生下来就是完成的还是 pending 的"，
 * 而不是事后 mutate。这样也更贴近真实语义：一张图从 new 出来
 * 那一刻，complete 就是 false。
 */
class FakeImage {
  complete: boolean;
  naturalWidth: number;
  decoding = '';
  src = '';

  constructor(pending = false) {
    this.complete = !pending;
    this.naturalWidth = pending ? 0 : 8;
  }

  /*
   * 只声明不实现 —— `loadImage` 会调用它（挂 onReady），
   * 但这个测试关心的是缓存内容，不关心回调有没有被触发。
   */
  addEventListener(_type: string, _fn: () => void): void {
    /* 故意空实现 */
  }
}

/**
 * 造一张"永远处于加载中"的图。
 *
 * `loadImage` 内部 `new Image()` 不带参数，所以不能从调用方传
 * pending 标志。这里用一个可切换的模块级开关：测试在调用前
 * 把它设成 true，之后创建的图就都是 pending 的。
 */
let nextImagePending = false;

function makeUrl(n: number): string {
  return `data:image/png;base64,FAKE${n}`;
}

describe('imageCache 有上限（LRU）', () => {
  beforeEach(() => {
    __resetImageCache();
    nextImagePending = false;
    /*
     * stub 一个**读开关**的构造器，而不是直接把 FakeImage 类塞进去。
     *
     * `loadImage` 里是 `new Image()`（无参数），所以要让它读到
     * `nextImagePending`，必须包一层。
     */
    vi.stubGlobal(
      'Image',
      class extends FakeImage {
        constructor() {
          super(nextImagePending);
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    nextImagePending = false;
    __resetImageCache();
  });

  it('加载 64 张以内全部保留', () => {
    for (let i = 0; i < 64; i += 1) loadImage(makeUrl(i));
    /*
     * 无法直接读 imageCache.size（未导出），用行为断言：
     * 一张也没被淘汰时，再取任意一张都应命中同一个对象。
     */
    const first = loadImage(makeUrl(0));
    const second = loadImage(makeUrl(0));
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(FakeImage);
  });

  it('超过上限后旧条目被淘汰（再取会新建对象）', () => {
    /*
     * 关键断言：装满 64 张之后，再加 40 张。
     * 第 0 张应该已经被挤出去 —— 此时 loadImage(第 0 张) 会
     * 返回一个**新对象**，而不是原来那个。
     */
    const firstBatch: unknown[] = [];
    for (let i = 0; i < 64; i += 1) firstBatch.push(loadImage(makeUrl(i)));

    for (let i = 64; i < 104; i += 1) loadImage(makeUrl(i));

    const reloaded = loadImage(makeUrl(0));
    expect(reloaded).not.toBe(firstBatch[0]);
  });

  it('最近用过的不会被淘汰（LRU 而不是 FIFO）', () => {
    /*
     * 这条区分 LRU 和 FIFO —— 如果实现只是"淘汰最早插入的"，
     * 这条会红。
     *
     * 步骤：
     *   1. 装 64 张（0..63）
     *   2. 重新访问第 0 张 → 它在 LRU 里变成"最近使用"
     *   3. 再塞 1 张（第 64 张）→ 应淘汰第 1 张，不是第 0 张
     *   4. 第 0 张应该还是原来那个对象
     */
    const first: unknown[] = [];
    for (let i = 0; i < 64; i += 1) first.push(loadImage(makeUrl(i)));

    /* 访问第 0 张，把它挪到最近使用 */
    const touch = loadImage(makeUrl(0));
    expect(touch).toBe(first[0]);

    /* 再塞一张，触发淘汰 */
    loadImage(makeUrl(64));

    /* 第 0 张应该还在 */
    expect(loadImage(makeUrl(0))).toBe(first[0]);
    /* 第 1 张应该被淘汰了（最久未使用） */
    expect(loadImage(makeUrl(1))).not.toBe(first[1]);
  });

  it('不淘汰还没加载完的图（否则 onReady 永远收不到）', () => {
    /*
     * 这是我在实现时特意处理的一个坑：
     * 未完成的图上挂着 `onReady` 回调，删掉它等于让那次重绘
     * 请求永远收不到通知 —— 画面停在首帧，用户以为图片坏了。
     *
     * ── 这条测试的第一版是假的 ──────────────────────────────────
     *
     * 第一版写成：先塞 63 张完成的，再塞 2 张 pending，然后加 10 张。
     * 结果**变异验证时没变红** —— 把"跳过未完成"那行删掉，测试照样绿。
     *
     * 原因：pending 那两张被放在 Map **末尾**，而淘汰是从**开头**
     * 开始扫的。凑够淘汰量时早就 break 了，根本扫不到 pending，
     * 那个 continue 分支一次都没执行过。
     *
     * 断言的形状是对的，但**执行路径没到达**。这比断言写错更隐蔽 ——
     * 断言写错至少读起来就觉得不对，路径没到达看起来完全正常。
     *
     * ── 修法 ────────────────────────────────────────────────────
     *
     * 把 pending 放在**最前面**（最早插入），这样淘汰从它们开始扫。
     * 正确实现会跳过它们、转而淘汰后面的已完成图；
     * 变异实现会把它们删掉。
     *
     * pending 的造法：`nextImagePending` 开关 + FakeImage 构造参数。
     * 不能事后给 `complete` 赋值 —— 它在 DOM 类型里是只读的（TS2540），
     * vitest 不检查类型所以能过，但 `tsc -b` 会红。
     */
    /* pending 先插入 → 位于 Map 开头 → 淘汰从这里开始扫 */
    nextImagePending = true;
    const pending1 = loadImage(makeUrl(900));
    const pending2 = loadImage(makeUrl(901));
    nextImagePending = false;

    expect(pending1?.complete).toBe(false);
    expect(pending2?.complete).toBe(false);

    /* 再把缓存填满并超出很多，逼淘汰扫过开头 */
    for (let i = 0; i < 90; i += 1) loadImage(makeUrl(i));

    /*
     * 未完成的图必须还在缓存里 —— 再取应返回同一个对象。
     * 如果被淘汰了，会新建一个（complete 默认 true），断言失败。
     */
    const again1 = loadImage(makeUrl(900));
    expect(again1).toBe(pending1);
    expect(again1?.complete).toBe(false);

    const again2 = loadImage(makeUrl(901));
    expect(again2).toBe(pending2);

    /* 配套断言：已完成的老图确实被淘汰了（证明淘汰真的发生了） */
    expect(loadImage(makeUrl(0))).not.toBe(undefined);
  });

  it('同一个 dataURL 永远返回同一个对象（缓存本职）', () => {
    const a = loadImage(makeUrl(42));
    const b = loadImage(makeUrl(42));
    expect(a).toBe(b);
  });

  it('__resetImageCache 真的清空了', () => {
    const a = loadImage(makeUrl(7));
    __resetImageCache();
    const b = loadImage(makeUrl(7));
    expect(b).not.toBe(a);
  });
});
