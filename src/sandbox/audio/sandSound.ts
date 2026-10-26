/**
 * 心屿 · 沙声（程序化合成，零音频资产）
 *
 * `docs/VISION.md` §5.1 把「放置/移动/落沙音效」列为 **P0**：
 * 「声音是触觉缺失的主要补偿；需可关闭（`reducedMotion` 同级偏好）」。
 *
 * v2.0 交付时这一项**没有实现**：`Preferences.soundEnabled` 字段存在、
 * 默认 `true`、两套 i18n 文案都有，但**没有任何代码读过它** ——
 * 一个死开关。比没有更糟：看代码的人以为有声音。
 *
 * ## 为什么是合成而不是音频文件
 *
 * 1. 沙声的本质是**宽带噪声 + 随时间变化的滤波**，不需要采样。
 *    真实灌录的沙声文件动辄几百 KB，会挤爆 gzip 175KB 的主包预算；
 * 2. 音频资产要进 `THIRD_PARTY_NOTICES.md` 资产台账（授权、来源、可再分发）。
 *    本仓库对所有沙具都用 Unicode emoji 正是为了绕开这件事，这里保持一致；
 * 3. 合成噪声可以**按参数连续变化**（推沙越深，高频越多），
 *    采样只能做音量淡入淡出。
 *
 * ## 设计约束（都是硬要求）
 *
 * - **不自动播放**：必须在用户手势里调用（浏览器的 autoplay 策略），
 *   且首次要在「用户真的开始拖」之后才建立 AudioContext；
 * - **可关闭**：`soundEnabled === false` 时**连 AudioContext 都不建**
 *   （建了就会占一个音频线程，且 iOS 上有额外开销）；
 * - **尊重 `prefers-reduced-motion`**：动效偏好不直接等于静音（这是两件事），
 *   但系统级 reduced-motion 的用户往往也偏好更少感官刺激，
 *   所以默认情况下**不**因此静音 —— 只在用户显式关开关时才静音。
 *   这个取舍写在这里，免得后人以为漏了；
 * - **不抛错**：AudioContext 失败（无音频设备、被策略拦、SSR）时静默降级，
 *   绝不能因为放不出声就让沙盘用不了。
 *
 * ## 已验证的失败路径
 *
 * `src/sandbox/audio/sandSound.test.ts` 覆盖：开关关闭时不建 context、
 * context 构造抛错时不崩、参数越界时被钳制。
 */

/** 可复现的伪随机：避免 `Math.random()` 让「同一笔」每次噪声不同（也便于测试） */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32，够快且周期足够长
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

/** 一次发声的时长（毫秒）。太长会糊成一团，太短听不出「沙」 */
const GRAIN_MS = 220;

/**
 * 沙具落下的声音：短促、低频偏多。
 *
 * @param ctx 已激活的 AudioContext
 * @param seed 决定噪声细节，同一个摆件每次落下的声音一致
 */
function playDrop(ctx: AudioContext, seed: number): void {
  const now = ctx.currentTime;
  const duration = 0.18;

  // 用一段 BufferSource 噪声 + 低通，模拟「沙具压进沙里」的闷响
  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = createRandom(seed);

  for (let i = 0; i < frames; i += 1) {
    // 指数衰减包络：落地瞬间最响，然后迅速收敛
    const progress = i / frames;
    const envelope = Math.exp(-progress * 7);
    // 低频偏多的噪声（相邻样本相关 → 听起来更闷）
    const previous = i > 0 ? data[i - 1] : 0;
    data[i] = (random() * 2 - 1) * 0.55 * envelope + previous * 0.35;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, now);
  filter.frequency.exponentialRampToValueAtTime(220, now + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.5, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + duration);
}

/**
 * 推/挖沙的声音：连续、带通偏中高频，强度随笔刷力度变化。
 *
 * `intensity` 0~1：推得越深，高频成分越多（真实沙面就是这样）。
 */
function playStroke(ctx: AudioContext, seed: number, intensity: number): void {
  const now = ctx.currentTime;
  const duration = GRAIN_MS / 1000;
  const clamped = Math.min(1, Math.max(0, intensity));

  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = createRandom(seed);

  for (let i = 0; i < frames; i += 1) {
    const progress = i / frames;
    // 两头淡入淡出，避免爆音（click）
    const envelope = Math.sin(progress * Math.PI);
    data[i] = (random() * 2 - 1) * 0.35 * envelope;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  // 力度越大，中心频率越高（800Hz → 2600Hz）
  filter.frequency.setValueAtTime(800 + clamped * 1800, now);
  filter.Q.setValueAtTime(0.8, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  // 整体音量偏轻：沙声是背景，不该盖过环境
  gain.gain.exponentialRampToValueAtTime(0.06 + clamped * 0.1, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + duration);
}

/** 沙声控制器。所有方法都不会抛错 —— 放不出声不能影响沙盘可用性。 */
export interface SandSound {
  /** 摆件落下 */
  drop(seed?: number): void;
  /**
   * 推/挖沙
   *
   * @param intensity 0~1，力度或笔刷半径归一化后的值
   */
  stroke(intensity?: number, seed?: number): void;
  /** 释放 AudioContext。切页、关闭开关时必须调用，否则音频线程会一直挂着 */
  dispose(): void;
  /** 当前是否已建立可用的音频上下文 */
  readonly active: boolean;
}

/** 什么也不做的实现：没有音频能力时用它，调用方不用到处判空 */
export const SILENT_SAND_SOUND: SandSound = {
  drop: () => undefined,
  stroke: () => undefined,
  dispose: () => undefined,
  active: false,
};

/**
 * 创建沙声控制器。
 *
 * @param enabled 来自 `Preferences.soundEnabled`。为 `false` 时**不建
 *   AudioContext**（建了会占音频线程）
 */
export function createSandSound(enabled: boolean): SandSound {
  if (!enabled) return SILENT_SAND_SOUND;

  // 浏览器环境判断：单测跑在 node，没有 AudioContext
  const Ctor =
    typeof globalThis !== 'undefined'
      ? (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      : {};
  const AudioContextCtor = Ctor.AudioContext ?? Ctor.webkitAudioContext;
  if (!AudioContextCtor) return SILENT_SAND_SOUND;

  let ctx: AudioContext | null = null;
  let disposed = false;

  /**
   * 懒建 + 激活。
   *
   * 必须在**用户手势的调用栈里**建立/恢复，否则 Chrome 会把它留在
   * `suspended` 状态。这个函数只在 drop/stroke 里调用，而它们都由
   * pointerdown 触发 —— 天然满足手势要求。
   */
  const ensure = (): AudioContext | null => {
    if (disposed) return null;
    try {
      if (!ctx) ctx = new AudioContextCtor();
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    } catch {
      // 没有音频设备 / 被策略拦 / 隐私模式：静默降级
      return null;
    }
  };

  return {
    get active() {
      return ctx !== null && ctx.state === 'running';
    },
    drop(seed = 1) {
      const audio = ensure();
      if (!audio) return;
      try {
        playDrop(audio, seed);
      } catch {
        // 合成失败不影响使用
      }
    },
    stroke(intensity = 0.5, seed = 1) {
      const audio = ensure();
      if (!audio) return;
      try {
        playStroke(audio, seed, intensity);
      } catch {
        // 同上
      }
    },
    dispose() {
      disposed = true;
      if (!ctx) return;
      const closing = ctx;
      ctx = null;
      try {
        void closing.close();
      } catch {
        // 已经关了或环境不支持
      }
    },
  };
}
