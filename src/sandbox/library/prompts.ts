/**
 * 心屿 · 引导语取用（薄封装，便于测试与 UI 复用）
 *
 * 所有句子都来自 `src/sandbox/symbols.ts` 的 `PROMPT_GROUPS`（公共层，不可修改）。
 * 本文件**不新增任何提示文案**——伦理红线要求每条提示都是开放式的，
 * 由临床审阅过的文案表统一管理（VISION.md §5.3 / 契约 §5.6）。
 */

import type { PromptStage } from '@/sandbox/symbols';
import { PROMPT_GROUPS, promptsForStage } from '@/sandbox/symbols';

export type { PromptStage };

/** 三个阶段的展示顺序（开始前 / 摆放中 / 结束后） */
export const PROMPT_STAGES: PromptStage[] = ['before', 'during', 'after'];

/** 每个阶段的可用条数 */
export function promptPoolSize(stage: PromptStage): number {
  return PROMPT_GROUPS[stage].length;
}

/**
 * 取 n 条引导语。内部走 `promptsForStage`，并按需去重、保持稳定顺序。
 * `seed` 相同 + `stage` 相同 => 结果相同（同一屏内不会跳动）。
 */
export function promptsForView(stage: PromptStage, seed: number, count = 3): string[] {
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0) return [];
  const picked = promptsForStage(stage, seed, safeCount);
  // promptsForStage 内部按固定步长取样，count 大于池大小时会截断，这里补齐到请求数量
  if (picked.length >= safeCount) return picked.slice(0, safeCount);
  const pool = PROMPT_GROUPS[stage];
  const result = [...picked];
  for (let i = 0; i < pool.length && result.length < safeCount; i += 1) {
    const candidate = pool[(seed * 5 + i * 2 + 1) % pool.length];
    if (!result.includes(candidate)) result.push(candidate);
  }
  return result;
}

/** 换一组：seed 递增；阶段池子很小时循环，不会卡住 */
export function nextSeed(seed: number): number {
  return (seed + 1) % 1_000_003;
}
