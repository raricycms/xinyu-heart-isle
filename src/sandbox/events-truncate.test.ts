/**
 * 事件流截断（`MAX_EVENTS`）的行为测试。
 *
 * ── 为什么这组测试值得单独写 ────────────────────────────────────
 *
 * `MAX_EVENTS = 4000` 这个上限存在很久了，`perf.test.ts` 里也有
 * 一堆围绕它的**性能**测试（4000 条回放 < 60ms 之类）。
 * 但"超过上限之后**行为**怎样"从来没被断言过：
 *
 *   - 丢的是早期事件还是近期事件？
 *   - 丢掉的那段里如果有 `item.add`（沙具摆放），重放结果还一致吗？
 *   - 折叠出来的那条合成事件是什么？
 *   - `cursor` 会不会错位，导致撤销/重做崩掉？
 *
 * 这些问题不影响性能，但会影响**正确性** —— 而且是那种
 * 「用了很久、堆了 4000 条之后才出现」的错误，最难在开发时发现。
 *
 * ── 判据的写法 ──────────────────────────────────────────────────
 *
 * 不用 `expect(events.length).toBe(4000)` 这种"数量对"就完事的断言。
 * 数量对但丢错了东西，是最典型的假绿。所以每条都断言**内容**：
 * 最新的事件在、最旧的事件不在、被折叠的 item.add 体现在重放结果里。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_EVENTS,
  createStack,
  pushEvent,
  replayAll,
  canUndo,
  canRedo,
} from '@/sandbox/events';
import type { SandboxEvent, SandboxItem } from '@/lib/types';

/* ── 构造事件的辅助 ────────────────────────────────────────────── */

let seq = 0;
function nextId(): string {
  seq += 1;
  return `item-${seq}`;
}

function makeItem(index: number): SandboxItem {
  return {
    id: nextId(),
    symbolId: `sym-${index}`,
    x: (index % 60) / 60,
    y: (Math.floor(index / 60) % 40) / 40,
    scale: 1,
    rotation: 0,
    z: index,
  };
}

/** 一条 item.add（payload 是扁平对象，`t` 递增便于判断先后） */
function addEvent(index: number): SandboxEvent {
  return {
    t: index,
    type: 'item.add',
    payload: { item: makeItem(index) },
  };
}

/** 一条 item.move（不影响重放出的 item 集合，只是动作） */
function moveEvent(index: number): SandboxEvent {
  return {
    t: index,
    type: 'item.move',
    itemId: `moved-${index}`,
    payload: { x: index / 1000, y: index / 1000 },
  };
}

/** 从空栈开始连续压入 n 条 move 事件 */
function pushManyMove(n: number) {
  let stack = createStack();
  for (let i = 0; i < n; i += 1) {
    stack = pushEvent(stack, moveEvent(i));
  }
  return stack;
}

/** 判断某条事件是不是截断产生的合成事件 */
function isCompacted(event: SandboxEvent): boolean {
  return event.type === 'session.import' && event.payload?.from === 'compacted';
}

describe('事件流截断（MAX_EVENTS）', () => {
  it('上限是 4000（与 perf.test.ts 的假设一致）', () => {
    expect(MAX_EVENTS).toBe(4000);
  });

  it('刚好 4000 条时不截断', () => {
    const stack = pushManyMove(MAX_EVENTS);
    expect(stack.events).toHaveLength(MAX_EVENTS);
    expect(stack.cursor).toBe(MAX_EVENTS);
    /* 第一条还是原来那条，没被加合成事件 */
    expect(stack.events[0]!.itemId).toBe('moved-0');
    expect(stack.events.some(isCompacted)).toBe(false);
  });

  it('超过 4000 条时丢的是**最早**的，不是最新的', () => {
    const overflow = 5;
    const stack = pushManyMove(MAX_EVENTS + overflow);

    /*
     * 全是 move → 没有 item.add 可折叠，总长度就是 MAX_EVENTS。
     * 关键不是"长度对了"，而是**内容对不对**。
     */
    expect(stack.events).toHaveLength(MAX_EVENTS);

    const last = stack.events[stack.events.length - 1]!;
    expect(last.itemId).toBe(`moved-${MAX_EVENTS + overflow - 1}`);

    /* 最早那几条必须已不在 */
    const keptIds = new Set(stack.events.map((e) => e.itemId));
    for (let i = 0; i < overflow; i += 1) {
      expect(keptIds.has(`moved-${i}`)).toBe(false);
    }
    /* 窗口的第一条应当是 moved-overflow */
    expect(stack.events[0]!.itemId).toBe(`moved-${overflow}`);
  });

  it('cursor 与 events.length 始终对齐（否则撤销会崩）', () => {
    const stack = pushManyMove(MAX_EVENTS + 3);
    expect(stack.cursor).toBe(stack.events.length);
    expect(canUndo(stack)).toBe(true);
    expect(canRedo(stack)).toBe(false);
  });

  it('被丢弃的 item.add 会折叠成一条合成事件，重放结果仍包含这些沙具', () => {
    /*
     * 这是整个截断逻辑里最关键、也最容易被写错的一条。
     *
     * 写这个测试时，它**一开始是红的**，并因此挖出三个真实缺陷：
     *
     *   1. 折叠事件只插一次。第 2 次截断时 head 里是上个折叠事件
     *      而不是 item.add，于是不再插入，旧的折叠事件被推出窗口后
     *      就彻底没了 —— 重放后 items = 0。
     *   2. 折叠事件插入后总长变成 4001，上限形同虚设。
     *   3. 为腾位置削掉的 tail[0] 可能是 item.add，却没被收集 ——
     *      那个沙具既不进折叠事件也不在后续流里，直接蒸发。
     *
     * 原代码的注释写着「折叠进一条合成事件，保证重放一致」，
     * 而 `applyEvent` 对 session.import 直接 `return state`。
     * 也就是说这个承诺从来没兑现过，也没有任何测试发现。
     */
    let stack = createStack();

    /* 先摆 10 个沙具，再用大量 move 把它们挤出窗口 */
    const placedIds: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const event = addEvent(i);
      placedIds.push((event.payload!.item as SandboxItem).id);
      stack = pushEvent(stack, event);
    }

    for (let i = 0; i < MAX_EVENTS + 5; i += 1) stack = pushEvent(stack, moveEvent(i));

    /* 1. 长度永不超限 */
    expect(stack.events).toHaveLength(MAX_EVENTS);

    /* 2. 只允许有一条折叠事件，且在第一位 */
    const compacted = stack.events.filter(isCompacted);
    expect(compacted).toHaveLength(1);
    expect(stack.events[0]!.type).toBe('session.import');

    /* 3. 折叠事件必须**携带**沙具，光有个 from 标记等于没折叠 */
    const carried = stack.events[0]!.payload?.items;
    expect(Array.isArray(carried)).toBe(true);
    expect((carried as SandboxItem[]).length).toBe(10);

    /* 4. 重放后 10 个沙具**一个都不能少** */
    const state = replayAll(stack.events);
    expect(state.items).toHaveLength(10);

    /* 5. 少的是同一个都不能冤枉：id 要逐一对上 */
    const restoredIds = new Set(state.items.map((item) => item.id));
    for (const id of placedIds) {
      expect(restoredIds.has(id)).toBe(true);
    }
  });

  it('连续多次截断后仍然不丢沙具（累积链条不能断）', () => {
    /*
     * 上面那条只走"挤出窗口"一次。但真实使用是**持续**截断：
     * 每来一条新事件就丢一条旧的。折叠事件自己也会逐个滑到窗口边缘，
     * 如果它的携带信息没被一代代继承下去，沙具还是会慢慢漏掉。
     *
     * 所以这里多跑 500 次截断，确认累积链条不断。
     */
    let stack = createStack();
    for (let i = 0; i < 5; i += 1) stack = pushEvent(stack, addEvent(i));
    for (let i = 0; i < MAX_EVENTS + 500; i += 1) stack = pushEvent(stack, moveEvent(i));

    expect(stack.events).toHaveLength(MAX_EVENTS);
    expect(stack.events.filter(isCompacted)).toHaveLength(1);
    expect(replayAll(stack.events).items).toHaveLength(5);
  });

  it('折叠事件里没有物品时不插入（纯 move 场景）', () => {
    /*
     * 折叠只对被丢弃的 item.add 有意义。如果被丢的全是 move，
     * 插入一条空的 session.import 就是噪音 ——
     * 它会让重放多做一次无意义的导入，也让事件流里多一条
     * 谁都解释不清的记录。
     */
    const stack = pushManyMove(MAX_EVENTS + 10);
    expect(stack.events.some(isCompacted)).toBe(false);
  });

  it('截断后继续操作，仍然是最新的在末尾', () => {
    let stack = pushManyMove(MAX_EVENTS + 10);
    stack = pushEvent(stack, moveEvent(99999));

    expect(stack.events).toHaveLength(MAX_EVENTS);
    const last = stack.events[stack.events.length - 1]!;
    expect(last.itemId).toBe('moved-99999');
    expect(stack.cursor).toBe(stack.events.length);
  });

  it('在撤销状态（cursor < length）下压入新事件，先分叉再判断截断', () => {
    /*
     * 分叉语义：撤销到中间时做新操作，应当丢弃 cursor 之后的未来。
     * 分叉之后就没超限了，所以不该触发截断。
     *
     * 这条钉住「分叉」和「截断」的**顺序**：
     * 反过来的话（先截断再分叉），分叉会作用在已被削掉头部的事件流上，
     * 丢掉的事件数对不上，cursor 也会错位。
     */
    let stack = pushManyMove(MAX_EVENTS);
    stack = { events: stack.events, cursor: stack.cursor - 100 };

    stack = pushEvent(stack, moveEvent(88888));

    /* 分叉后：(MAX_EVENTS - 100) 条 + 新的 1 条，没超限 */
    expect(stack.events).toHaveLength(MAX_EVENTS - 100 + 1);
    expect(stack.cursor).toBe(stack.events.length);
    expect(stack.events[stack.events.length - 1]!.itemId).toBe('moved-88888');
    expect(canRedo(stack)).toBe(false);
    /* 没触发截断，所以不该有合成事件 */
    expect(stack.events.some(isCompacted)).toBe(false);
  });

  it('未超限时不做任何改写（反向断言）', () => {
    /*
     * 如果 pushEvent 在未超限时也动了事件（插合成事件、改时间戳），
     * 上面那些"超限"测试可能依然全绿，但正常使用就会出问题。
     */
    const first = moveEvent(0);
    const second = moveEvent(1);
    let stack = createStack([first, second]);
    stack = pushEvent(stack, moveEvent(3));

    expect(stack.events).toHaveLength(3);
    expect(stack.events[0]).toEqual(first);
    expect(stack.events[1]).toEqual(second);
    expect(stack.events.some(isCompacted)).toBe(false);
  });
});
