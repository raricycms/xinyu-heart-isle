import { useCallback, useEffect, useRef, useState } from 'react';

/* ==========================================================================
   心屿 · 计时 hooks
   全部用 Date.now() 时间戳校正，切到后台标签页再回来不会漂移。
   ========================================================================== */

export interface CountdownApi {
  /** 剩余秒数（保留一位小数） */
  remaining: number;
  running: boolean;
  done: boolean;
  /** 总时长（秒） */
  total: number;
  start: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
}

/**
 * 倒计时。
 * 内部只保存「截止时间戳」，每次 tick 用时间差反推剩余量，
 * 因此浏览器节流 setTimeout / 切后台都不会累积误差。
 */
export function useCountdown(totalSeconds: number, onDone?: () => void): CountdownApi {
  const [remaining, setRemaining] = useState(totalSeconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const deadlineRef = useRef(0);
  const remainRef = useRef(totalSeconds);
  remainRef.current = remaining;

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    setRemaining(totalSeconds);
    setDone(false);
    setRunning(false);
  }, [totalSeconds]);

  useEffect(() => {
    if (!running) return;

    deadlineRef.current = Date.now() + remainRef.current * 1000;
    let lastShown = Math.ceil(remainRef.current);

    const id = window.setInterval(() => {
      const left = Math.max(0, (deadlineRef.current - Date.now()) / 1000);
      const shown = Math.ceil(left);
      if (shown !== lastShown) {
        lastShown = shown;
        setRemaining(left);
      }
      if (left <= 0) {
        window.clearInterval(id);
        setRemaining(0);
        setRunning(false);
        setDone(true);
        onDoneRef.current?.();
      }
    }, 100);

    return () => window.clearInterval(id);
  }, [running]);

  const start = useCallback(() => {
    if (remainRef.current <= 0) {
      setRemaining(totalSeconds);
      remainRef.current = totalSeconds;
      setDone(false);
    }
    setRunning(true);
  }, [totalSeconds]);

  const pause = useCallback(() => setRunning(false), []);

  const toggle = useCallback(() => {
    if (running) setRunning(false);
    else start();
  }, [running, start]);

  const reset = useCallback(() => {
    setRunning(false);
    setDone(false);
    setRemaining(totalSeconds);
  }, [totalSeconds]);

  return {
    remaining,
    running,
    done,
    total: totalSeconds,
    start,
    pause,
    toggle,
    reset,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  呼吸循环                                   */
/* -------------------------------------------------------------------------- */

export type BreathPhaseKey = 'inhale' | 'holdIn' | 'exhale' | 'holdOut';

export interface BreathPhase {
  key: BreathPhaseKey;
  label: string;
  seconds: number;
}

export interface BreathCycleApi {
  /** 已进行的总秒数 */
  elapsed: number;
  /** 当前阶段 */
  phase: BreathPhase;
  phaseIndex: number;
  /** 当前阶段内的进度 0~1 */
  phaseProgress: number;
  /** 已完成的完整轮次 */
  cycleCount: number;
  active: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
  /** 目标轮次（0 表示不限） */
  targetCycles: number;
  setTargetCycles: (n: number) => void;
  finished: boolean;
}

const DEFAULT_PHASE: BreathPhase = { key: 'inhale', label: '吸气', seconds: 4 };

/**
 * 呼吸循环：按阶段序列循环推进。
 * 返回当前阶段与阶段内进度，供 UI 渲染动画与文案。
 */
export function useBreathCycle(phases: BreathPhase[], targetCyclesInit = 0): BreathCycleApi {
  const [elapsed, setElapsed] = useState(0);
  const [active, setActive] = useState(false);
  const [targetCycles, setTargetCycles] = useState(targetCyclesInit);
  const [finished, setFinished] = useState(false);

  const startRef = useRef(0);
  const accRef = useRef(0);

  const totalCycle = phases.reduce((sum, phase) => sum + phase.seconds, 0) || 1;

  useEffect(() => {
    if (!active) return;
    startRef.current = Date.now();

    const id = window.setInterval(() => {
      const value = accRef.current + (Date.now() - startRef.current) / 1000;
      setElapsed(value);

      if (targetCycles > 0 && value >= totalCycle * targetCycles) {
        accRef.current = totalCycle * targetCycles;
        setElapsed(accRef.current);
        setActive(false);
        setFinished(true);
      }
    }, 100);

    return () => {
      accRef.current += (Date.now() - startRef.current) / 1000;
      window.clearInterval(id);
    };
  }, [active, totalCycle, targetCycles]);

  const start = useCallback(() => {
    setFinished(false);
    setActive(true);
  }, []);

  const pause = useCallback(() => setActive(false), []);

  const reset = useCallback(() => {
    setActive(false);
    accRef.current = 0;
    setElapsed(0);
    setFinished(false);
  }, []);

  // 推导当前阶段
  const cycleIndex = Math.floor(elapsed / totalCycle);
  let rest = elapsed % totalCycle;
  let phaseIndex = phases.length - 1;
  for (let i = 0; i < phases.length; i += 1) {
    if (rest < phases[i].seconds) {
      phaseIndex = i;
      break;
    }
    rest -= phases[i].seconds;
  }
  const phase = phases[phaseIndex] ?? DEFAULT_PHASE;
  const phaseProgress = phase.seconds > 0 ? Math.min(1, rest / phase.seconds) : 0;

  return {
    elapsed,
    phase,
    phaseIndex,
    phaseProgress,
    cycleCount: finished ? targetCycles : cycleIndex,
    active,
    start,
    pause,
    reset,
    targetCycles,
    setTargetCycles,
    finished,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  工具函数                                   */
/* -------------------------------------------------------------------------- */

/** 秒 -> mm:ss */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
