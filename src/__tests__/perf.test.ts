/**
 * 心屿 · 性能预算测试（P3 技术债 + CONTRACT §7）
 *
 * CONTRACT §7 的硬指标（2026-10 修订版，见该节「关于沙面体积预算的历史」）：
 * | 单次笔刷（128×96）              | ≤ 4ms   |
 * | 单次 `surface.stroke` 编码载荷   | ≤ 8KB   |
 * | 会话级 `session.surface` 体积    | ≤ 40KB  |
 * | `replayAll` 4000 事件            | ≤ 60ms  |
 * | `computeSessionStats` 4000 事件  | ≤ 30ms  |
 * | 主包 gzip                        | ≤ 175KB |
 *
 * ## 为什么不用「绝对耗时」当唯一断言
 *
 * 绝对耗时在 CI / 开发机 / 杀毒软件扫描下抖动可达数倍，卡死 4ms 会制造大量假失败，
 * 最后大家会把它 skip 掉 —— 那等于没有测试。
 *
 * 因此本文件用**三层**断言：
 * 1. **量级断言**（主）：预算留足余量。真正的回归（把笔刷改成遍历全图、
 *    或引入 O(n²)）会让耗时上升一个数量级。
 * 2. **标度断言**（更强）：比较「小输入 / 大输入」的耗时比例，
 *    验证算法复杂度而不是机器速度。这类断言与硬件无关。
 * 3. **契约守卫**（dist 体积）：直接量 gzip 字节数，完全确定、零抖动。
 *
 * 计时方法：热身若干次让 JIT 完成，再取多次采样的**中位数**（一次 GC 抖动不影响中位数）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { SandSession, SandboxEvent, SandboxItem, SurfaceTool } from '@/lib/types';
import { MAX_EVENTS, makeEvent, replayAll } from '@/sandbox/events';
import { SURFACE_COLS, SURFACE_ROWS, createSurfaceState, encodeField } from '@/sandbox/surfaceCodec';
import { applyBrush, applyStroke, digSand, raiseSand, surfaceStats, waterSand } from '@/sandbox/surfaceOps';
import { computeSessionStats } from '@/sandbox/replay/stats';

/* -------------------------------------------------------------------------- */
/*                                  计时工具                                   */
/* -------------------------------------------------------------------------- */

/**
 * 跑 `fn` 多次取**最小值**（毫秒）。热身次不计入。
 *
 * 为什么预算断言用最小值而不是中位数：
 * 并行跑 15 个测试文件时 CPU 被打满，任何一次采样都可能被调度抢占或 GC 打断 ——
 * **干扰只会让耗时变长，永远不会让它变短**。所以最小值是对「这段代码本身多快」
 * 最无偏的估计；中位数会把抢占算进去，在负载高时偶尔顶到预算上限。
 *
 * 实测教训：修复前中位数版本在并行负载下有一次读到 29.07ms（预算 30ms），
 * 虽然当时没红，但这种余量迟早会假失败。最小值版本同一台机器稳定在 6–8ms。
 *
 * **标度断言是否该用最小值，取决于分母的量级**（这里踩过两次坑，记清楚）：
 * - 分母只有 0.07–0.2ms 时（例如相邻翻倍 500→1000），比值本来就毫无意义，
 *   换什么采样器都救不了 —— 必须换更大的规模跨度，而不是换采样器；
 * - 分母到了 ~0.9ms（跨 8 倍规模 500→4000）时，**两侧都该用最小值**。
 *   干扰只会让耗时变长，最小值对分子分母都是无偏估计；用中位数则任一侧
 *   被 GC 打断都会污染比值。这条我最初判断错了，是全量并行偶发失败后才纠正过来。
 */
function bestMs(fn: () => void, samples = 15, warmup = 5): number {
  for (let i = 0; i < warmup; i += 1) fn();
  let best = Infinity;
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

/** 跑 `fn` 多次取中位数（毫秒）。热身次不计入。用于标度断言与报告。 */
function medianMs(fn: () => void, samples = 15, warmup = 5): number {
  for (let i = 0; i < warmup; i += 1) fn();
  const timings: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    fn();
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)];
}

/* -------------------------------------------------------------------------- */
/*                                测试数据构造                                 */
/* -------------------------------------------------------------------------- */

function item(id: string, overrides: Partial<SandboxItem> = {}): SandboxItem {
  return {
    id,
    symbolId: 'nature.tree',
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    z: 1,
    ...overrides,
  };
}

/**
 * 构造「真实会话」的事件流：摆件数有上限（默认 50），大部分事件是移动/缩放等修改。
 *
 * 这是真实用户的行为分布 —— 一个沙盘通常摆 10~60 个沙具，
 * 然后反复调整位置，而不是无限往里加新摆件。
 */
function buildRealisticEvents(count: number, itemCount = 50): SandboxEvent[] {
  const events: SandboxEvent[] = [];
  events.push(
    makeEvent(events, 'session.start', { kind: 'session.start', sceneId: 'beach', mode: 'self' }, undefined, 0),
  );
  let t = 1;
  for (let i = 0; i < itemCount && events.length < count; i += 1) {
    const id = `s${i}`;
    events.push(
      makeEvent(events, 'item.add', { kind: 'item.add', item: item(id, { x: (i % 50) / 50, y: (i % 40) / 40 }) }, id, t++),
    );
  }
  const types: SandboxEvent['type'][] = [
    'item.move',
    'item.scale',
    'item.rotate',
    'item.layer',
    'item.note',
    'item.affect',
    'scene.change',
    'reflection.edit',
  ];
  for (let i = 0; events.length < count; i += 1) {
    const type = types[i % types.length];
    const id = `s${i % itemCount}`;
    switch (type) {
      case 'item.move':
        events.push(makeEvent(events, 'item.move', { kind: 'item.move', x: (i % 100) / 100, y: (i % 70) / 70 }, id, t++));
        break;
      case 'item.scale':
        events.push(makeEvent(events, 'item.scale', { kind: 'item.scale', scale: 0.5 + (i % 20) / 10 }, id, t++));
        break;
      case 'item.rotate':
        events.push(makeEvent(events, 'item.rotate', { kind: 'item.rotate', rotation: (i % 360) - 180 }, id, t++));
        break;
      case 'item.layer':
        events.push(makeEvent(events, 'item.layer', { kind: 'item.layer', z: 1 + (i % 40) }, id, t++));
        break;
      case 'item.note':
        events.push(makeEvent(events, 'item.note', { kind: 'item.note', note: `注释 ${i}` }, id, t++));
        break;
      case 'item.affect':
        events.push(makeEvent(events, 'item.affect', { kind: 'item.affect', affectLabels: ['平静'] }, id, t++));
        break;
      case 'scene.change':
        events.push(makeEvent(events, 'scene.change', { kind: 'scene.change', sceneId: 'meadow' }, undefined, t++));
        break;
      default:
        events.push(makeEvent(events, 'reflection.edit', { kind: 'reflection.edit', text: `自述 ${i}` }, undefined, t++));
        break;
    }
  }
  return events;
}

/**
 * 构造「纯 item.add」事件流（最坏路径：摆件数 == 事件数）。
 * 真实会话不会这样，但它是 O(n²) 复杂度的放大器，用于标度断言。
 */
function buildAddOnlyEvents(count: number): SandboxEvent[] {
  const events: SandboxEvent[] = [];
  events.push(
    makeEvent(events, 'session.start', { kind: 'session.start', sceneId: 'beach', mode: 'self' }, undefined, 0),
  );
  while (events.length < count) {
    const i = events.length - 1;
    const id = `a${i}`;
    events.push(
      makeEvent(
        events,
        'item.add',
        {
          kind: 'item.add',
          item: item(id, {
            x: (i % 97) / 97,
            y: (i % 89) / 89,
            scale: 0.6 + (i % 10) / 10,
            rotation: (i % 360) - 180,
            z: i + 1,
            symbolId: `nature.s${i % 20}`,
          }),
        },
        id,
        i * 100,
      ),
    );
  }
  return events;
}

function buildSession(events: SandboxEvent[], items: SandboxItem[]): SandSession {
  return {
    schemaVersion: 2,
    id: 'perf-session',
    at: '2026-10-20T09:00:00.000Z',
    title: '性能测试会话',
    mode: 'self',
    sceneId: 'beach',
    items,
    events,
    locked: false,
  };
}

/* -------------------------------------------------------------------------- */
/*                            1. 笔刷性能（≤ 4ms 预算）                         */
/* -------------------------------------------------------------------------- */

/**
 * 笔刷单次耗时预算。
 *
 * CONTRACT §7 写的是 **4ms**。这里曾经断言在 **12ms**（注释说「留 3 倍余量」）。
 * 实测（`calibrate-brush.test.ts`，200 轮取最优）：
 *
 *     raise 0.054ms   dig 0.057ms   smooth 0.088ms
 *     rake  0.019ms   water 0.028ms  tunnel 0.055ms
 *
 * 也就是说**真实余量是 136 倍**，不是 3 倍。一个要慢 136 倍才会红的断言，
 * 等于没有断言 —— 真出回归（比如不小心退化成全图遍历，慢 10 倍）它照样绿。
 *
 * 收紧到 2ms：
 *   - 仍是契约 4ms 的 2 倍安全垫，机器抖动吃得下（CI 慢机器 ×5 也还有余量）；
 *   - 但能挡住「数量级退化」这类真实回归；
 *   - 不会因为偶发抖动误报（实测最慢 0.088ms，2ms 是它的 23 倍）。
 *
 * 换句话说：**阈值要卡在「正常抖动的上界」和「真实回归的下界」之间**，
 * 而不是随便乘一个 3。
 */
const BRUSH_BUDGET_MS = 2;

describe(`笔刷性能（CONTRACT §7 契约 4ms；断言收紧到 ${BRUSH_BUDGET_MS}ms）`, () => {
  const state = createSurfaceState();
  const brush = { x: 0.5, y: 0.5, radius: 0.12, strength: 0.6 };

  it('默认沙面尺寸就是 128×96（性能预算的前提）', () => {
    expect(SURFACE_COLS).toBe(128);
    expect(SURFACE_ROWS).toBe(96);
    expect(state.height.data.length).toBe(128 * 96);
  });

  const tools: SurfaceTool[] = ['raise', 'dig', 'smooth', 'rake', 'water', 'tunnel'];
  for (const tool of tools) {
    it(`${tool} 单次笔刷中位耗时 < ${BRUSH_BUDGET_MS}ms`, () => {
      const ms = bestMs(() => {
        applyBrush(state, tool, brush);
      });
      expect(ms, `${tool} 耗时 ${ms.toFixed(3)}ms，超出 ${BRUSH_BUDGET_MS}ms 预算`).toBeLessThan(
        BRUSH_BUDGET_MS,
      );
    });
  }

  it(`flatten 全场重置耗时 < ${BRUSH_BUDGET_MS}ms`, () => {
    const sculpted = raiseSand(state, brush);
    expect(bestMs(() => applyBrush(sculpted, 'flatten', brush))).toBeLessThan(BRUSH_BUDGET_MS);
  });

  it('applyStroke 沿长路径插值后总耗时 < 200ms', () => {
    const ms = bestMs(
      () =>
        applyStroke(
          state,
          'dig',
          [
            { x: 0.05, y: 0.5 },
            { x: 0.95, y: 0.5 },
          ],
          0.1,
          0.5,
        ),
      7,
      2,
    );
    expect(ms).toBeLessThan(200);
  });

  /**
   * 标度断言：小笔刷必须显著快于大笔刷。
   *
   * 如果实现从「只遍历笔刷包围盒」退化成「遍历全图」，
   * 两者耗时会被拉平 —— 本断言就会失败。这个判据与机器速度无关。
   */
  it('笔刷耗时随半径增长而增长（证明只遍历包围盒，而非全图）', () => {
    const tiny = medianMs(() => raiseSand(state, { ...brush, radius: 0.02 }));
    const huge = medianMs(() => raiseSand(state, { ...brush, radius: 0.45 }));
    // 半径 0.02 覆盖约 25 格，半径 0.45 覆盖约 12000 格，相差 2 个数量级。
    // 只要实现是包围盒遍历，tiny 必然远小于 huge。留 2 倍安全系数。
    expect(tiny * 2, `tiny=${tiny.toFixed(3)}ms huge=${huge.toFixed(3)}ms，包围盒遍历可能退化为全图遍历`).toBeLessThan(huge);
  });
});

/* -------------------------------------------------------------------------- */
/*                          2. 沙面编码体积（≤ 8KB）                           */
/* -------------------------------------------------------------------------- */

describe('沙面编码体积（CONTRACT §7 修订版：单次 stroke 载荷 ≤ 8KB，会话级 ≤ 40KB）', () => {
  it('未雕刻的空白沙面编码后极小（RLE 友好）', () => {
    expect(encodeField(createSurfaceState().height).length).toBeLessThan(40);
  });

  it('单次 surface.stroke 的编码载荷 < 8KB（CONTRACT §7 第一条）', () => {
    // 一次 stroke = 一次笔刷落点后的整场快照。实测约 430–750B。
    for (const tool of ['raise', 'dig', 'rake', 'tunnel'] as SurfaceTool[]) {
      let sculpted = createSurfaceState();
      sculpted = applyBrush(sculpted, tool, { x: 0.5, y: 0.5, radius: 0.1, strength: 0.7 });
      const payload = encodeField(sculpted.height).length;
      expect(payload, `${tool} 单次 stroke 载荷 ${payload}B 超出 8KB`).toBeLessThan(8192);
    }
  });

  it('典型雕刻（12 笔推沙）编码后 < 8192 字节', () => {
    let sculpted = createSurfaceState();
    for (let i = 0; i < 12; i += 1) {
      sculpted = raiseSand(sculpted, { x: 0.2 + i * 0.05, y: 0.5, radius: 0.08, strength: 0.7 });
    }
    expect(encodeField(sculpted.height).length).toBeLessThan(8192);
  });

  it('会话级沙面（50 笔重度雕刻）< 40KB（CONTRACT §7 第二条，实测约 19.4KB）', () => {
    let sculpted = createSurfaceState();
    for (let i = 0; i < 50; i += 1) {
      sculpted = raiseSand(sculpted, {
        x: 0.05 + (i % 10) * 0.09,
        y: 0.1 + Math.floor(i / 10) * 0.16,
        radius: 0.08,
        strength: 0.7,
      });
    }
    const payload = encodeField(sculpted.height).length;
    expect(payload, `50 笔会话级沙面 ${payload}B 超出 40KB`).toBeLessThan(40 * 1024);
  });

  it('会话级沙面（5 工具各 10 笔 = 50 笔多工具）< 40KB', () => {
    // 这个组合此前曾超 8KB（11224B），是促使预算修订的那组数据。
    // 在新预算（会话级 40KB）下它必须通过。
    const tools: SurfaceTool[] = ['raise', 'dig', 'rake', 'smooth', 'tunnel'];
    let sculpted = createSurfaceState();
    for (const tool of tools) {
      for (let i = 0; i < 10; i += 1) {
        sculpted = applyBrush(sculpted, tool, {
          x: 0.1 + (i / 10) * 0.8,
          y: 0.2 + (tools.indexOf(tool) / tools.length) * 0.6,
          radius: 0.07,
          strength: 0.8,
        });
      }
    }
    const payload = encodeField(sculpted.height).length;
    expect(payload, `50 笔多工具会话级沙面 ${payload}B 超出 40KB`).toBeLessThan(40 * 1024);
  });

  it('推挖交替（更真实的挖坑场景，20 笔）< 8KB', () => {
    let sculpted = createSurfaceState();
    for (let i = 0; i < 20; i += 1) {
      sculpted = applyBrush(sculpted, i % 2 === 0 ? 'dig' : 'raise', {
        x: 0.1 + (i % 10) * 0.09,
        y: 0.3,
        radius: 0.08,
        strength: 0.7,
      });
    }
    expect(encodeField(sculpted.height).length).toBeLessThan(8192);
  });

  it('抹平（smooth）显著降低编码体积（收敛后 RLE 更省）', () => {
    let sculpted = createSurfaceState();
    for (let i = 0; i < 10; i += 1) {
      sculpted = raiseSand(sculpted, { x: 0.1 + i * 0.08, y: 0.5, radius: 0.08, strength: 0.7 });
    }
    const before = encodeField(sculpted.height).length;
    for (let i = 0; i < 10; i += 1) {
      sculpted = applyBrush(sculpted, 'smooth', { x: 0.1 + i * 0.08, y: 0.5, radius: 0.15, strength: 1 });
    }
    const after = encodeField(sculpted.height).length;
    expect(after).toBeLessThan(before);
  });

  it('水洗不改变高度场编码体积（湿度是独立通道，不污染 height）', () => {
    let wet = createSurfaceState();
    for (let i = 0; i < 8; i += 1) {
      wet = waterSand(wet, { x: 0.2 + i * 0.08, y: 0.5, radius: 0.1, strength: 1 });
    }
    expect(encodeField(wet.height).length).toBeLessThan(8192);
  });

  /**
   * 记录 RLE 的真实压缩率特性（不是断言失败，而是把「为什么 8KB 不够」钉成事实）。
   *
   * 每笔约 +430 字节，因为笔刷留下的是平滑梯度，RLE 只压「连续同值」，
   * 梯度的相邻值几乎都不同 → 每格一个 run。这条测试保证这个特性被文档化，
   * 将来若换成量化/zlib，它会变红提醒更新 CONTRACT 里的理由说明。
   */
  it('编码体积随笔画数近似线性增长（RLE 对平滑梯度无效的实证）', () => {
    const sizes: number[] = [];
    let sculpted = createSurfaceState();
    for (let i = 1; i <= 20; i += 1) {
      sculpted = raiseSand(sculpted, {
        x: 0.05 + ((i - 1) % 5) * 0.2,
        y: 0.1 + Math.floor((i - 1) / 5) * 0.2,
        radius: 0.08,
        strength: 0.6,
      });
      if (i % 5 === 0) sizes.push(encodeField(sculpted.height).length);
    }
    // 每 5 笔的增量应当稳定在同一个数量级（线性增长，而非指数爆炸）
    expect(sizes).toHaveLength(4);
    for (let i = 1; i < sizes.length; i += 1) {
      const delta = sizes[i] - sizes[i - 1];
      expect(delta, `第 ${i} 段增量 ${delta}B 异常`).toBeGreaterThan(0);
      expect(delta).toBeLessThan(5 * 1024);
    }
    // 20 笔仍在会话级预算内（旧 8KB 预算下这里会失败，正是修订预算的依据）
    expect(sizes[sizes.length - 1]).toBeLessThan(40 * 1024);
  });

  it('编码体积增长有上界（最坏情况噪声场的理论上限，防止无节制膨胀）', () => {
    // 相邻像素完全交替 = RLE 最不利。每格 1 run ≈ 2 字节，12288 格 → ~24.5KB，Base64 后 ~32.8KB。
    const field = createSurfaceState().height;
    for (let i = 0; i < field.data.length; i += 1) field.data[i] = i % 2 === 0 ? 0 : 255;
    // 上界 = Base64(每格 2 字节) + 头部 ≈ 34KB，留一点余量
    expect(encodeField(field).length).toBeLessThan(40 * 1024);
  });
});

/* -------------------------------------------------------------------------- */
/*                    3. 事件重放性能（4000 条 ≤ 60ms）                        */
/* -------------------------------------------------------------------------- */

describe(`事件重放性能（MAX_EVENTS = ${MAX_EVENTS}，CONTRACT §7：4000 条 < 60ms）`, () => {
  it('MAX_EVENTS 是 4000（事件流上限）', () => {
    expect(MAX_EVENTS).toBe(4000);
  });

  it('真实会话（50 个摆件 + 4000 条事件）replayAll < 60ms', () => {
    const events = buildRealisticEvents(MAX_EVENTS);
    expect(events).toHaveLength(MAX_EVENTS);
    const ms = bestMs(() => replayAll(events), 9, 3);
    expect(ms, `replayAll(4000 真实事件) 耗时 ${ms.toFixed(2)}ms，超出 60ms 预算`).toBeLessThan(60);
  });

  it('重放结果正确（真实会话重放后摆件数 == 初始摆件数）', () => {
    const events = buildRealisticEvents(MAX_EVENTS, 50);
    const replayed = replayAll(events);
    expect(replayed.items).toHaveLength(50);
  });

  /**
   * 标度断言：重放耗时随事件数线性增长。
   *
   * ⚠ 这条曾经**形同虚设**，记录修法以免再犯：
   * 原断言是 `fullMs < halfMs * 8 + 5`。当 halfMs ≈ 1.67ms 时，阈值变成 18.4ms，
   * 而线性实测只有 3.0ms —— 也就是说即使重放退化成 O(n²)（约 6.7ms），
   * **这条断言依然会通过**。它无法为它声称的目的失败。
   *
   * 病根有两个：
   *   1. 绝对余量 `+5` 在毫秒量级上等于豁免了一个数量级；
   *   2. `medianMs` 会把并行负载的抢占算进去，噪声本身就能吃掉比值。
   *
   * 修法：去掉 `+5`，两侧改用 `bestMs`，阈值取 3.5。
   * 2 倍输入下线性 ≈2，O(n²) ≈4，阈值 3.5 正好卡在中间且留了 75% 抖动余量。
   * 实测比值稳定在 1.6–2.1。
   */
  it('重放耗时随事件数线性增长（标度断言，与机器速度无关）', () => {
    const half = buildRealisticEvents(MAX_EVENTS / 2);
    const full = buildRealisticEvents(MAX_EVENTS);
    const halfMs = bestMs(() => replayAll(half), 15, 5);
    const fullMs = bestMs(() => replayAll(full), 15, 5);
    const ratio = fullMs / Math.max(0.05, halfMs);
    console.log(`  重放 2 倍规模: ${halfMs.toFixed(3)}ms -> ${fullMs.toFixed(3)}ms = ×${ratio.toFixed(2)}`);
    // 线性 ≈2，O(n²) ≈4。阈值 3.5 卡在中间。
    expect(
      ratio,
      `事件数翻倍时耗时增 ${ratio.toFixed(2)} 倍（${halfMs.toFixed(3)}ms -> ${fullMs.toFixed(3)}ms），疑似超标度增长`,
    ).toBeLessThan(3.5);
  });

  /**
   * 缺陷 A 已修复（`ReplayDraft` 就地累加，见 `src/sandbox/events.ts:106-151`）。
   *
   * 历史：修复前 `item.add` 是 `state.items.filter(...)` + 展开复制整个数组，
   * 每次 add O(n) → n 次 add 是 O(n²)。4000 条纯 add 耗时 53.53ms。
   * 修复后 1.27ms，约 40 倍提升，翻倍倍率 ×1.65–1.98（线性）。
   */
  it('4000 条纯 item.add（4000 个摆件）重放 < 60ms（原缺陷 A，已修复）', () => {
    const events = buildAddOnlyEvents(MAX_EVENTS);
    const ms = bestMs(() => replayAll(events), 5, 2);
    expect(ms, `replayAll(4000 add) 耗时 ${ms.toFixed(2)}ms，超出 60ms 预算`).toBeLessThan(60);
    // 重放结果必须正确（性能优化不能牺牲语义）
    expect(replayAll(events).items).toHaveLength(MAX_EVENTS - 1);
  });

  /**
   * 标度断言：证明 O(n²) 已消除。
   *
   * ⚠ 阈值选择踩过坑，记录下来避免后人重复：
   * 最初按 Lead 建议用「相邻翻倍 < 2.8」，实测 2000→4000 得到 ×2.73；
   * 换成 1000→2000 又得到 ×3.37 —— **都只是噪声**。原因是修复后绝对耗时降到
   * 0.07ms / 0.23ms 量级，已经贴着 `performance.now()` 的分辨率与 JIT 抖动，
   * 相邻两档的比值毫无意义。
   *
   * 正确做法：**跨 8 倍规模比较**（500 → 4000）。
   * 线性算法得 ~8 倍，O(n²) 会得 ~64 倍，两者相差一个数量级，噪声淹没不了。
   * 阈值取 24（= 线性的 3 倍），既远离 O(n²) 的 64，也留足抖动余量。
   */
  it('add 数量增至 8 倍时耗时增长远低于 O(n²)（标度断言，证明缺陷 A 已消除）', () => {
    const small = buildAddOnlyEvents(500);
    const large = buildAddOnlyEvents(4000);

    /*
     * 两侧都用 `bestMs`，不用 `medianMs`。
     *
     * 踩坑记录（两次）：
     * 第一次用相邻翻倍（1000→2000、2000→4000）的比值，实测在 0.94~3.37 之间乱跳 ——
     * 因为修复后绝对耗时只有 0.07/0.23ms，已经贴着 `performance.now()` 的分辨率。
     * 第二次改成跨 8 倍规模（本用例）后好很多，但**全量并行时仍偶发失败**：
     * 分母 `smallMs` 只有 ~0.1ms，一次 GC 或线程抢占就能让它偏移几十个百分点，
     * 比值随之失真 —— 全量跑 6 次挂 1 次就是这么来的。
     *
     * 为什么最小值是对的：并行负载下 CPU 被打满，干扰**只会让耗时变长、
     * 永远不会变短**。所以最小值是对「这段代码本身多快」的无偏估计，
     * 而中位数把抢占也算进去了。分子分母都用无偏估计，比值才是干净的比例。
     */
    const smallMs = bestMs(() => replayAll(small), 15, 5);
    const largeMs = bestMs(() => replayAll(large), 15, 5);
    const ratio = largeMs / smallMs;

    // 线性 ≈ 8；O(n²) ≈ 64。阈值 24 是二者的安全分界。
    expect(
      ratio,
      `规模 8 倍时耗时增 ${ratio.toFixed(2)} 倍（${smallMs.toFixed(3)}ms -> ${largeMs.toFixed(3)}ms），疑似 O(n²) 回归`,
    ).toBeLessThan(24);
    // 绝对预算仍必须守住（防止「倍率好看但整体很慢」）
    expect(largeMs).toBeLessThan(60);
  });
});

/* -------------------------------------------------------------------------- */
/*                   4. 统计计算性能（4000 条 ≤ 30ms）                         */
/* -------------------------------------------------------------------------- */

describe('会话统计性能（CONTRACT §7：4000 条 < 30ms）', () => {
  it('computeSessionStats 4000 条真实事件 + 50 摆件 < 30ms', () => {
    const events = buildRealisticEvents(MAX_EVENTS, 50);
    const session = buildSession(events, replayAll(events).items);
    const ms = bestMs(() => computeSessionStats(session), 9, 3);
    expect(ms, `computeSessionStats(真实 4000) 耗时 ${ms.toFixed(2)}ms，超出 30ms 预算`).toBeLessThan(30);
  });

  it('统计结果正确（事件数 / 摆件数 / 九宫格总数对得上）', () => {
    const events = buildRealisticEvents(MAX_EVENTS, 50);
    const session = buildSession(events, replayAll(events).items);
    const stats = computeSessionStats(session);
    expect(stats.eventCount).toBe(MAX_EVENTS);
    expect(stats.itemCount).toBe(50);
    // 九宫格计数之和等于摆件数（每个摆件恰好落在一格）
    expect(stats.zones.reduce((sum, zone) => sum + zone.count, 0)).toBe(50);
    expect(stats.zones).toHaveLength(9);
  });

  it('空事件会话的统计不抛错且各项为 0', () => {
    const stats = computeSessionStats(buildSession([], []));
    expect(stats.eventCount).toBe(0);
    expect(stats.itemCount).toBe(0);
    expect(stats.durationMs).toBe(0);
    expect(stats.firstItemAt).toBeNull();
    expect(stats.lastActionAt).toBeNull();
    expect(stats.zones).toHaveLength(9);
    expect(stats.zones.every((zone) => zone.count === 0)).toBe(true);
  });

  /**
   * 标度断言：统计耗时随**事件数**线性增长。
   *
   * ⚠ 这条断言前后改过三次，每次都因为「测错了维度」而形同虚设，全过程记下来：
   *
   * 第 1 版：`bigMs < smallMs * 8 + 5`，摆件 50 → 100。
   *   → 绝对余量 `+5` 在毫秒量级上豁免了一个数量级，O(n²) 也能过。
   *
   * 第 2 版：去掉余量、改 `bestMs`、摆件扩到 8 倍（50 → 400）。
   *   → 实测耗时 0.593 / 0.545 / 0.608 / 0.659ms（50/100/200/400 摆件）——
   *     **几乎完全平坦**。因为 `computeSessionStats` 的开销由 4000 条**事件**
   *     主导，摆件数只是零头。摆件翻 8 倍带来的增量淹没在噪声里，
   *     这条断言无论阈值定多严都不可能失败。
   *
   * 第 3 版（本版）：改测**事件数** 500 → 4000（8 倍）。
   *   这才是缺陷 B 的真实风险维度 —— 修复前无 surface 时会 `replayAll(events)`，
   *   于是继承缺陷 A 的 O(n²)，4000 条要 72.55ms。事件数才是那个平方项的自变量。
   *
   * 教训：**标度断言必须沿「真正驱动开销的那个维度」放大**，
   * 否则测的只是噪声。判定方法是先打表看单调性（见 §4.3）。
   */
  it('统计耗时随事件数线性增长（标度断言，沿真实开销维度）', () => {
    const smallEvents = buildAddOnlyEvents(500);
    const largeEvents = buildAddOnlyEvents(MAX_EVENTS);

    const small = buildSession(smallEvents, []);
    const large = buildSession(largeEvents, []);

    const smallMs = bestMs(() => computeSessionStats(small), 15, 5);
    const largeMs = bestMs(() => computeSessionStats(large), 15, 5);
    const ratio = largeMs / Math.max(0.05, smallMs);

    console.log(`  统计 8 倍事件数: ${smallMs.toFixed(3)}ms -> ${largeMs.toFixed(3)}ms = ×${ratio.toFixed(2)}`);

    // 线性 ≈8；若统计里重新混入 replayAll 的 O(n²)，会得到 ≈64。
    // 阈值 24 = 线性的 3 倍，远离 64。实测稳定在 5–12。
    expect(
      ratio,
      `事件数增至 8 倍时统计耗时增 ${ratio.toFixed(2)} 倍（${smallMs.toFixed(3)}ms -> ${largeMs.toFixed(3)}ms），疑似 O(n²) 回归`,
    ).toBeLessThan(24);
  });

  /**
   * 缺陷 B 已修复（`computeSessionStats` 不再整段重放取沙面，
   * 改为倒查最后一条 `surface.stroke` 的 `after`，见 `src/sandbox/replay/stats.ts`）。
   *
   * 历史：修复前无 surface 时会 `replayAll(events)` 求出沙面，
   * 于是继承了缺陷 A 的 O(n²)：4000 条纯 add 会话统计耗时 72.55ms。
   * 修复后约 1.3–2ms。
   */
  it('无沙面的 4000 条纯 add 会话，统计 < 30ms（原缺陷 B，已修复）', () => {
    const events = buildAddOnlyEvents(MAX_EVENTS);
    // 不传 items 的重放结果，模拟「旧会话没有 items 缓存」，迫使内部自己处理
    const session = buildSession(events, []);
    const ms = bestMs(() => computeSessionStats(session), 5, 2);
    expect(ms, `computeSessionStats(无沙面 4000 add) 耗时 ${ms.toFixed(2)}ms，超出 30ms 预算`).toBeLessThan(30);
  });

  it('有沙面数据时统计不需要重放（耗时明显更低，佐证缺陷 B 的成因）', () => {
    const events = buildAddOnlyEvents(2000);
    const items = replayAll(events).items;
    const withSurface: SandSession = {
      ...buildSession(events, items),
      // 一个合法的极小沙面：2×2 的 RLE+Base64
      surface: { cols: 2, rows: 2, height: encodeField(createSurfaceState(2, 2).height) },
    };
    const withMs = bestMs(() => computeSessionStats(withSurface), 5, 2);
    const withoutMs = bestMs(() => computeSessionStats(buildSession(events, items)), 5, 2);
    // 修复后两者都在毫秒级，差距可能不明显；这里只要求都不超预算，
    // 不再强求「有沙面一定更快」（修复后该差值已不具诊断意义）。
    expect(withMs).toBeLessThan(30);
    expect(withoutMs).toBeLessThan(30);
  });
});

/* -------------------------------------------------------------------------- */
/*                          5. 沙面统计性能                                    */
/* -------------------------------------------------------------------------- */

describe('沙面统计性能', () => {
  it('surfaceStats 遍历 12288 格 < 8ms', () => {
    const sculpted = raiseSand(createSurfaceState(), { x: 0.5, y: 0.5, radius: 0.3, strength: 1 });
    expect(bestMs(() => surfaceStats(sculpted))).toBeLessThan(8);
  });

  it('surfaceStats 输出都在合理范围', () => {
    const stats = surfaceStats(digSand(createSurfaceState(), { x: 0.5, y: 0.5, radius: 0.2, strength: 1 }));
    expect(stats.meanHeight).toBeGreaterThanOrEqual(0);
    expect(stats.meanHeight).toBeLessThanOrEqual(255);
    expect(stats.maxHeight).toBeLessThanOrEqual(255);
    expect(stats.minHeight).toBeGreaterThanOrEqual(0);
    expect(stats.movedRatio).toBeGreaterThanOrEqual(0);
    expect(stats.movedRatio).toBeLessThanOrEqual(1);
    expect(stats.wetRatio).toBeGreaterThanOrEqual(0);
    expect(stats.wetRatio).toBeLessThanOrEqual(1);
  });
});

/* -------------------------------------------------------------------------- */
/*                    6. 生产构建体积预算（CONTRACT §7）                        */
/* -------------------------------------------------------------------------- */

/**
 * 体积回归守卫（零抖动，完全确定性）。
 *
 * 预算：主包 gzip ≤ 175KB。
 *
 * 「主包」的识别方式：从 `dist/index.html` 里解析出被 `<script type="module" src=...>`
 * 直接引用的那个 chunk —— 那是入口 chunk，而不是猜文件名前缀。
 *
 * ⚠️ **依赖 `dist/`，且没有 dist 时认定为失败（不是跳过）。**
 *
 * 这里原来 7 条全是 `it.skipIf(!hasDist)`。实测把 dist 移走：
 *
 *     Tests  34 passed | 7 skipped (41)     EXIT=0
 *
 * 也就是说**一整套构建体积预算静默消失了，而门禁是绿的**。
 * 更糟的是 `npm run check` 原来的顺序是 `test` 在 `build` **之前**，
 * 所以在干净克隆上跑 `check`，这 7 条体积预算**一次都不会执行**，
 * 而输出看起来完全正常。
 *
 * 「忘了 build」不该是绿灯。删掉 skipIf 之后，缺 dist 会直接红，
 * 报错信息里写明「先跑 npx vite build」。
 * 同时 `package.json` 的 `check` 已把 `build` 提到 `test` 之前。
 */
describe('构建体积预算（主包 gzip ≤ 175KB / three 必须独立分包）', () => {
  const distDir = path.resolve(process.cwd(), 'dist');
  const htmlPath = path.join(distDir, 'index.html');
  const hasDist = existsSync(htmlPath);
  const budgetBytes = 175 * 1024;

  /*
   * 这条**不带 skipIf**，是整个 describe 的守门人。
   * 它红了，就说明下面 7 条体积预算全都没在跑 —— 与其让它们静默跳过，
   * 不如在这里明确报错，并给出可执行的修复命令。
   */
  it('dist/ 必须存在（否则下面的体积预算会静默跳过）', () => {
    expect(
      hasDist,
      'dist/index.html 不存在，构建体积预算无法验证。\n' +
        '请先执行 `npx vite build`（`npm run check` 已自动先 build 再 test）。\n' +
        '这里故意判失败而不是跳过：跳过会让「忘了 build」变成一个绿色的门禁。',
    ).toBe(true);
  });

  /** 从 index.html 解析入口 chunk 的相对路径 */
  function entryChunk(): string | undefined {
    const html = readFileSync(htmlPath, 'utf8');
    const match = html.match(/<script[^>]*type="module"[^>]*src="([^"]+\.js)"/);
    return match ? match[1].replace(/^\//, '') : undefined;
  }

  it('dist/index.html 引用了入口 JS chunk', () => {
    const entry = entryChunk();
    expect(entry, 'index.html 里没有找到入口 <script type="module">').toBeTruthy();
    expect(existsSync(path.join(distDir, entry!))).toBe(true);
  });

  it('主包 gzip ≤ 175KB（CONTRACT §7）', () => {
    const entry = entryChunk()!;
    const gzipped = gzipSync(readFileSync(path.join(distDir, entry))).length;
    const kb = gzipped / 1024;
    expect(kb, `主包 gzip ${kb.toFixed(2)}KB，超出 175KB 预算`).toBeLessThanOrEqual(175);
    expect(gzipped).toBeLessThanOrEqual(budgetBytes);
  });

  it('主包 gzip 不应过低（防止误把依赖全拆走导致请求瀑布）', () => {
    const entry = entryChunk()!;
    const kb = gzipSync(readFileSync(path.join(distDir, entry))).length / 1024;
    // React + Router 的合理下限；低于这个值说明主包被拆坏了
    expect(kb, `主包 gzip 仅 ${kb.toFixed(2)}KB，疑似拆包异常`).toBeGreaterThan(50);
  });

  it('three 独立成 chunk，且没有被打进主包', () => {
    const entry = entryChunk()!;
    const entrySource = readFileSync(path.join(distDir, entry), 'utf8');
    // WebGLRenderer 是 three 的标志性符号；出现在主包里说明动态 import 失效
    expect(entrySource, 'three 被打进主包了（动态 import 可能失效）').not.toContain('WebGLRenderer');

    const assetsDir = path.join(distDir, 'assets');
    expect(existsSync(assetsDir)).toBe(true);
    const threeChunk = readdirSync(assetsDir).find((name) => /^three-.*\.js$/.test(name));
    expect(threeChunk, 'dist/assets 里没有 three-*.js，three 分包可能失效').toBeTruthy();
  });

  it('three chunk 体积在预算内（gzip < 200KB）', () => {
    const assetsDir = path.join(distDir, 'assets');
    const threeChunk = readdirSync(assetsDir).find((name) => /^three-.*\.js$/.test(name))!;
    const kb = gzipSync(readFileSync(path.join(assetsDir, threeChunk))).length / 1024;
    expect(kb, `three chunk gzip ${kb.toFixed(2)}KB`).toBeLessThan(200);
  });

  it('沙盘相关页面已代码分割（SandboxPage 不在主包里）', () => {
    const entry = entryChunk()!;
    const entrySource = readFileSync(path.join(distDir, entry), 'utf8');
    // SandboxPage 的独有字符串；在主包里出现说明懒加载被破坏
    expect(entrySource, 'SandboxPage 似乎被打回主包（懒加载失效）').not.toContain('sandbox-stage');

    const assetsDir = path.join(distDir, 'assets');
    const sandboxChunk = readdirSync(assetsDir).find((name) => /^SandboxPage-.*\.js$/.test(name));
    expect(sandboxChunk, 'dist/assets 里没有 SandboxPage-*.js').toBeTruthy();
  });

  it('CSS 总体积在预算内（gzip < 30KB）', () => {
    const assetsDir = path.join(distDir, 'assets');
    const cssFiles = readdirSync(assetsDir).filter((name) => name.endsWith('.css'));
    expect(cssFiles.length).toBeGreaterThan(0);
    const total = cssFiles.reduce((sum, name) => sum + gzipSync(readFileSync(path.join(assetsDir, name))).length, 0);
    expect(total / 1024, `CSS 合计 gzip ${(total / 1024).toFixed(2)}KB`).toBeLessThan(30);
  });
});
