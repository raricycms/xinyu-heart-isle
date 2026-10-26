import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createSandSound } from './sandSound';

/**
 * 沙声的测试重点不是「声音好不好听」（那测不了），而是三条**可证伪的契约**：
 *
 * 1. 开关关闭时**连 AudioContext 都不许建** —— 这是资源契约，
 *    建了会占音频线程，iOS 上还有额外开销；
 * 2. AudioContext 构造抛错时**不能把异常抛给调用方** ——
 *    放不出声绝不能让沙盘用不了；
 * 3. `dispose()` 之后不能再发声，且不会因为重复 dispose 抛错。
 *
 * 为什么这些断言值得写：最初的实现里 `soundEnabled` 是个**死开关** ——
 * 字段存在、默认 true、两套 i18n 文案齐备，但没有任何代码读过它。
 * 上面第 1 条正是用来钉死「开关必须真的有作用」的。
 */

/** 记录所有被创建的假 AudioContext，用于断言「建了几次」 */
let created: FakeAudioContext[] = [];

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
}

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  close = vi.fn(() => Promise.resolve());
  resume = vi.fn(() => Promise.resolve());

  constructor() {
    created.push(this);
    if (shouldThrowOnConstruct) throw new Error('没有音频设备');
  }

  createBuffer = (_channels: number, frames: number, _rate: number) => ({
    getChannelData: () => new Float32Array(frames),
  });
  createBufferSource = () => new FakeSource();
  createGain = () => new FakeGain();
  createBiquadFilter = () => new FakeFilter();
}

let shouldThrowOnConstruct = false;

beforeEach(() => {
  created = [];
  shouldThrowOnConstruct = false;
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('沙声：开关关闭时不许建 AudioContext', () => {
  it('enabled=false 时 active 为 false，且一次都不建 context', () => {
    const sound = createSandSound(false);

    expect(sound.active).toBe(false);

    // 即使调用发声，也不该建
    sound.drop();
    sound.stroke(0.5);

    expect(created).toHaveLength(0);
  });

  it('enabled=false 时 dispose 不抛错（SILENT 实现也要安全）', () => {
    const sound = createSandSound(false);
    expect(() => sound.dispose()).not.toThrow();
  });

  it('enabled=true 时确实是懒建：没调用发声前不建 context', () => {
    const sound = createSandSound(true);

    // 只是构造控制器，不应该建 —— 建了就等于页面一打开就占音频线程
    expect(created).toHaveLength(0);
    expect(sound.active).toBe(false);

    sound.drop();
    expect(created).toHaveLength(1);
  });
});

describe('沙声：放不出声也不能崩', () => {
  it('AudioContext 构造抛错时，drop/stroke 都不抛错', () => {
    shouldThrowOnConstruct = true;
    const sound = createSandSound(true);

    expect(() => sound.drop()).not.toThrow();
    expect(() => sound.stroke(0.8)).not.toThrow();
    expect(sound.active).toBe(false);
  });

  it('没有 AudioContext 的环境（node/SSR）直接降级为静音', () => {
    vi.stubGlobal('AudioContext', undefined);
    const sound = createSandSound(true);

    expect(sound.active).toBe(false);
    expect(() => sound.drop()).not.toThrow();
  });

  it('合成过程中抛错被吞掉（filter 类型不支持等）', () => {
    const sound = createSandSound(true);
    sound.drop(); // 先建好 context

    // 让下一次合成失败
    const ctx = created[0] as FakeAudioContext;
    ctx.createBufferSource = () => {
      throw new Error('合成失败');
    };

    expect(() => sound.drop()).not.toThrow();
  });
});

describe('沙声：资源释放', () => {
  it('dispose 关闭 context 并置 active=false', () => {
    const sound = createSandSound(true);
    sound.drop();

    expect(created).toHaveLength(1);
    const ctx = created[0] as FakeAudioContext;

    sound.dispose();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(sound.active).toBe(false);
  });

  it('dispose 之后不再发声，也不会重新建 context', () => {
    const sound = createSandSound(true);
    sound.drop();
    sound.dispose();

    sound.drop();
    sound.stroke(0.3);

    // 依然是 1 个 —— 没有因为 dispose 后又发声而复活
    expect(created).toHaveLength(1);
  });

  it('重复 dispose 不抛错', () => {
    const sound = createSandSound(true);
    sound.drop();
    sound.dispose();

    expect(() => sound.dispose()).not.toThrow();
  });
});

describe('沙声：参数被钳制', () => {
  it('stroke 的 intensity 越界不抛错（负值、超 1）', () => {
    const sound = createSandSound(true);
    sound.drop(); // 建 context

    expect(() => sound.stroke(-5)).not.toThrow();
    expect(() => sound.stroke(99)).not.toThrow();
  });

  it('drop 用同一个 seed 产生确定的噪声（不依赖 Math.random）', () => {
    /*
     * 这条断言的是「可复现性」：同一个 seed 必须画出同一段噪声。
     * 如果实现里用了 Math.random()，同一个摆件每次落下的声音都不一样，
     * 回放时的听觉体验会漂移，而且这里也测不了。
     */
    const randomSpy = vi.spyOn(Math, 'random');
    const sound = createSandSound(true);
    sound.drop(42);
    sound.drop(42);

    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});
