/**
 * 心屿 · 量表计分引擎
 *
 * 纯函数实现，不依赖 React，也不读写任何存储。要点：
 * 1. 反向计分统一为 `(选项最小值 + 选项最大值) - 原始分值`，与 types.ts 的注释一致。
 *    因此 PSS-10（0~4）反向题 = 4 - 分值，RSES（1~4）反向题 = 5 - 分值。
 * 2. 分级查找使用闭区间 `min <= total <= max`，并做「区间外兜底」，
 *    避免数据写错时抛异常导致整页白屏。
 * 3. 危机识别独立于分数：PHQ-9 第 9 题（自伤意念）只要 > 0 就必须返回 true，
 *    与总分落在哪个分级无关。
 */

import type { Scale, ScaleLevel, ScaleQuestion } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/*                                  量程工具                                   */
/* -------------------------------------------------------------------------- */

/** 选项分值的最小值 / 最大值（所有题目共用同一套选项）。 */
export function optionRange(scale: Scale): { min: number; max: number } {
  if (scale.options.length === 0) return { min: 0, max: 0 };
  const values = scale.options.map((option) => option.value);
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** 单题取值范围（题干本身不改变量程，只有 reverse 会折叠方向）。 */
export function questionRange(scale: Scale): { min: number; max: number } {
  return optionRange(scale);
}

/** 整份量表的最小 / 最大可能总分。 */
export function totalRange(scale: Scale): { min: number; max: number } {
  const { min, max } = optionRange(scale);
  return {
    min: min * scale.questions.length,
    max: max * scale.questions.length,
  };
}

/**
 * 把某题选择的原始分值折算为实际计分值。
 * 反向题：`(min + max) - value`；正向题：原样返回。
 */
export function scoreQuestion(scale: Scale, question: ScaleQuestion, rawValue: number): number {
  if (!question.reverse) return rawValue;
  const { min, max } = optionRange(scale);
  return min + max - rawValue;
}

/* -------------------------------------------------------------------------- */
/*                                   分级                                      */
/* -------------------------------------------------------------------------- */

/**
 * 找到分数命中的分级。
 *
 * - 优先返回闭区间命中的那一级；
 * - 如果分数落在所有区间之外（数据写错或分数被篡改），
 *   返回距离最近的一级，保证 UI 永远有东西可展示；
 * - levels 为空时返回 undefined。
 */
export function findLevel(scale: Scale, total: number): ScaleLevel | undefined {
  const levels = scale.levels;
  if (levels.length === 0) return undefined;

  const hit = levels.find((level) => total >= level.min && total <= level.max);
  if (hit) return hit;

  // 兜底：按距离最近的区间选取，避免 undefined 造成整页失败
  return levels.reduce<ScaleLevel | undefined>((closest, level) => {
    if (!closest) return level;
    const dist = (l: ScaleLevel) =>
      total < l.min ? l.min - total : total > l.max ? total - l.max : 0;
    return dist(level) < dist(closest) ? level : closest;
  }, undefined);
}

/** 分级 id（找不到时给一个稳定值，方便结果记录落库）。 */
export function findLevelId(scale: Scale, total: number): string {
  return findLevel(scale, total)?.id ?? `unleveled-${total}`;
}

/* -------------------------------------------------------------------------- */
/*                                   计分                                      */
/* -------------------------------------------------------------------------- */

export interface ScoreOutcome {
  /** 总分（已按反向题折算） */
  total: number;
  /** 维度得分（已按反向题折算），量表未定义维度时为 undefined */
  dimensionScores?: Record<string, number>;
  /** 命中的分级 id */
  levelId: string;
}

/**
 * 计算一次作答的结果。
 *
 * `answers` 是 questionId -> 选项原始分值。未作答的题按「0 分」处理（跳过即视为最轻），
 * 因此调用前应尽量保证所有题目都答完；结果页会同时展示已答题数，避免误读。
 */
export function scoreScale(scale: Scale, answers: Record<string, number>): ScoreOutcome {
  let total = 0;
  const scored = new Map<string, number>();

  for (const question of scale.questions) {
    const raw = answers[question.id];
    // 跳过 / 未作答：按最小值计入，不会因为缺题而把分数抬高
    const { min } = optionRange(scale);
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : min;
    const points = scoreQuestion(scale, question, value);
    scored.set(question.id, points);
    total += points;
  }

  let dimensionScores: Record<string, number> | undefined;
  if (scale.dimensions && scale.dimensions.length > 0) {
    dimensionScores = {};
    for (const dimension of scale.dimensions) {
      let sum = 0;
      for (const questionId of dimension.questionIds) {
        sum += scored.get(questionId) ?? 0;
      }
      dimensionScores[dimension.id] = sum;
    }
  }

  return { total, dimensionScores, levelId: findLevelId(scale, total) };
}

/** 已作答题数，用于结果页说明「基于几题计算」。 */
export function countAnswered(scale: Scale, answers: Record<string, number>): number {
  return scale.questions.filter((question) => typeof answers[question.id] === 'number').length;
}

/* -------------------------------------------------------------------------- */
/*                                 危机识别                                   */
/* -------------------------------------------------------------------------- */

/**
 * 各量表里「需要单独盯住」的高危题。
 * 目前只有 PHQ-9 第 9 题（自伤 / 轻生念头），后续量表可在此追加。
 */
const CRISIS_ITEM_IDS: Record<string, string[]> = {
  'phq-9': ['phq9-9'],
};

/**
 * 是否存在需要立即给出求助入口的作答。
 *
 * 判定规则（与总分无关）：
 * - PHQ-9 第 9 题分值 > 0 时返回 true；
 * - 其它量表如未来加入高危题，在 CRISIS_ITEM_IDS 中登记即可。
 *
 * 注意：这里只看「原始分值」，不做反向折算——高危题不可能是反向题。
 */
export function detectCrisis(scale: Scale, answers: Record<string, number>): boolean {
  let crisisIds = CRISIS_ITEM_IDS[scale.id];

  // 防御：若量表 id 是 phq-9 但题号被改过，退回「最后一题」作为自伤意念题
  if (!crisisIds && scale.id.startsWith('phq')) {
    const last = scale.questions[scale.questions.length - 1];
    crisisIds = last ? [last.id] : [];
  }
  if (!crisisIds || crisisIds.length === 0) return false;

  return crisisIds.some((questionId) => {
    const raw = answers[questionId];
    return typeof raw === 'number' && raw > 0;
  });
}

/** 结果页用的分级色调 -> 可读文案，独立于 UI 层，便于记录页复用。 */
export const LEVEL_TONE_TEXT: Record<ScaleLevel['tone'], string> = {
  good: '状态平稳',
  watch: '值得留意',
  warn: '需要关注',
  alert: '建议尽快求助',
};
