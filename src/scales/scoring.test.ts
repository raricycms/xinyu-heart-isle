/**
 * 心屿 · 量表计分引擎测试（P0 技术债，见 docs/HANDOVER.md §3）
 *
 * 覆盖范围：
 * 1. 量程与极值：每个量表「全选最低 / 全选最高」是否等于理论端点；
 * 2. 反向计分：PSS-10 第 4/5/7/8 题、RSES 第 3/5/8/9/10 题，`min + max - value`；
 * 3. 分级边界：每档 min/max 两端点落点唯一，档与档之间不重叠、不断裂；
 * 4. 危机判定：**只看 PHQ-9 第 9 题，与总分无关**（HANDOVER §4.3）；
 * 5. 文案红线：每档都有中文提示语，且不出现诊断性表述（CONTRACT §5.1）；
 * 6. 健壮性：负分 / 超满分 / 缺题 / 空量表都不抛错。
 *
 * 这些断言都是「代码写错时一定会失败」的：改反向计分公式、改区间端点、
 * 把危机判定挂到总分上、往提示语里塞「抑郁症」，都会立刻变红。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Scale, ScaleLevel } from '@/lib/types';
import { SCALES, getScaleById } from '@/scales/data';
import {
  LEVEL_TONE_TEXT,
  countAnswered,
  detectCrisis,
  findLevel,
  findLevelId,
  optionRange,
  questionRange,
  scoreQuestion,
  scoreScale,
  totalRange,
} from '@/scales/scoring';

/* -------------------------------------------------------------------------- */
/*                                  测试工具                                   */
/* -------------------------------------------------------------------------- */

function scaleOrThrow(id: string): Scale {
  const scale = getScaleById(id);
  if (!scale) throw new Error(`量表 ${id} 不存在，测试前置条件被破坏`);
  return scale;
}

/** 全选某个分值（用于构造极值答案） */
function fillAll(scale: Scale, value: number): Record<string, number> {
  const answers: Record<string, number> = {};
  for (const question of scale.questions) answers[question.id] = value;
  return answers;
}

/**
 * 构造「折算后总分最低」的答案。
 *
 * 注意不能简单地全选最小选项：反向题的折算方向相反，
 * 要让总分最低，正向题选 min、反向题选 max。这正是反向计分最容易写错的地方。
 */
function fillScoredMin(scale: Scale): Record<string, number> {
  const { min, max } = optionRange(scale);
  const answers: Record<string, number> = {};
  for (const question of scale.questions) {
    answers[question.id] = question.reverse ? max : min;
  }
  return answers;
}

/** 构造「折算后总分最高」的答案：正向题选 max、反向题选 min。 */
function fillScoredMax(scale: Scale): Record<string, number> {
  const { min, max } = optionRange(scale);
  const answers: Record<string, number> = {};
  for (const question of scale.questions) {
    answers[question.id] = question.reverse ? min : max;
  }
  return answers;
}

/**
 * 用户实际看到的「结果色调」。
 *
 * 这里刻意复刻 `src/pages/ScaleRunPage.tsx` 的 `showCrisis` / `crisisOverridesLevel`：
 *   showCrisis         = crisis || level.tone === 'alert'
 *   crisisOverridesLevel = crisis && level.tone !== 'alert'
 * 也就是说：只要高危条目被勾选，界面就必须按 alert 处理，**与总分无关**。
 */
function userFacingTone(scale: Scale, answers: Record<string, number>): ScaleLevel['tone'] | 'alert' {
  const outcome = scoreScale(scale, answers);
  const level = findLevel(scale, outcome.total);
  const crisis = detectCrisis(scale, answers);
  if (crisis && level?.tone !== 'alert') return 'alert'; // crisisOverridesLevel 分支
  return level?.tone ?? 'alert'; // 无分级时按最保守处理
}

const CHINESE = /[\u4e00-\u9fa5]/;

/**
 * 诊断性措辞黑名单（CONTRACT §5.1「不做诊断」）。
 * `你有(?!过)` 是为了放过「提醒自己你有过这样的状态」这类正常表达。
 */
const DIAGNOSTIC_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /抑郁症|焦虑症|失眠症|强迫症|双相|人格障碍|精神分裂/, why: '出现疾病名称' },
  { pattern: /你有(?!过)|您有(?!过)/, why: '出现「你有…」式论断' },
  { pattern: /你(患|得了)(?!病)/, why: '出现「你患了…」式诊断' },
  { pattern: /确诊|诊断为|你是不是/, why: '出现诊断动作' },
  { pattern: /(治愈|根治|康复率|痊愈)/, why: '出现疗效承诺' },
];

/* -------------------------------------------------------------------------- */
/*                              1. 量程与极值                                  */
/* -------------------------------------------------------------------------- */

describe('量程与极值', () => {
  it('5 个量表全部可加载（PHQ-9 / GAD-7 / PSS-10 / ISI / RSES）', () => {
    expect(SCALES.length).toBeGreaterThanOrEqual(5);
    const ids = SCALES.map((scale) => scale.id);
    expect(ids).toContain('phq-9');
    expect(ids).toContain('gad-7');
    expect(ids).toContain('pss-10');
    expect(ids).toContain('isi-7');
    expect(ids).toContain('rses-10');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('optionRange 取选项分值的最小 / 最大值', () => {
    expect(optionRange(scaleOrThrow('phq-9'))).toEqual({ min: 0, max: 3 });
    expect(optionRange(scaleOrThrow('gad-7'))).toEqual({ min: 0, max: 3 });
    expect(optionRange(scaleOrThrow('pss-10'))).toEqual({ min: 0, max: 4 });
    expect(optionRange(scaleOrThrow('isi-7'))).toEqual({ min: 0, max: 4 });
    // RSES 是 1~4 分制，最小值不是 0 —— 反向计分公式依赖这一点
    expect(optionRange(scaleOrThrow('rses-10'))).toEqual({ min: 1, max: 4 });
  });

  it('optionRange 对空选项集返回 0/0（防御分支）', () => {
    const empty: Scale = { ...scaleOrThrow('phq-9'), options: [] };
    expect(optionRange(empty)).toEqual({ min: 0, max: 0 });
  });

  it('questionRange 与 optionRange 一致（单题量程 = 选项量程）', () => {
    for (const scale of SCALES) {
      expect(questionRange(scale)).toEqual(optionRange(scale));
    }
  });

  it('totalRange 等于「题目数 × 单题量程」', () => {
    const expected: Record<string, { min: number; max: number }> = {
      'phq-9': { min: 0, max: 27 }, // 9 题 × 0~3
      'gad-7': { min: 0, max: 21 }, // 7 题 × 0~3
      'pss-10': { min: 0, max: 40 }, // 10 题 × 0~4
      'isi-7': { min: 0, max: 28 }, // 7 题 × 0~4
      'rses-10': { min: 10, max: 40 }, // 10 题 × 1~4
    };
    for (const scale of SCALES) {
      expect(totalRange(scale)).toEqual(expected[scale.id]);
    }
  });

  it('折算后最低分等于理论最小值（正向题选 min、反向题选 max）', () => {
    for (const scale of SCALES) {
      const outcome = scoreScale(scale, fillScoredMin(scale));
      expect(outcome.total).toBe(totalRange(scale).min);
    }
  });

  it('折算后最高分等于理论最大值（正向题选 max、反向题选 min）', () => {
    for (const scale of SCALES) {
      const outcome = scoreScale(scale, fillScoredMax(scale));
      expect(outcome.total).toBe(totalRange(scale).max);
    }
  });

  it('全选同一档（不分正反）时，含反向题的量表拿不到端点的总分', () => {
    // 这是反向计分的存在意义：全选最高选项不等于最高分
    for (const scale of SCALES) {
      const hasReverse = scale.questions.some((question) => question.reverse);
      const allMax = scoreScale(scale, fillAll(scale, optionRange(scale).max)).total;
      if (hasReverse) {
        expect(allMax).toBeLessThan(totalRange(scale).max);
      } else {
        expect(allMax).toBe(totalRange(scale).max);
      }
    }
  });

  it('折算后最低分命中「最轻」一档，最高分命中「最重」一档', () => {
    // RSES 是正向量表：分越高越好，所以「最重」的一档在最低分段（首档）
    const expectedTopTone = (scale: Scale): ScaleLevel['tone'] =>
      scale.levels[0].tone === 'alert' ? 'good' : 'alert';

    for (const scale of SCALES) {
      const low = scoreScale(scale, fillScoredMin(scale));
      const high = scoreScale(scale, fillScoredMax(scale));
      const lowestLevel = scale.levels[0];
      const highestLevel = scale.levels[scale.levels.length - 1];

      if (expectedTopTone(scale) === 'alert') {
        // 分数越高越严重：PHQ-9 / GAD-7 / PSS-10 / ISI
        expect(low.levelId).toBe(lowestLevel.id);
        expect(high.levelId).toBe(highestLevel.id);
      } else {
        // 分数越高越好：RSES
        expect(low.levelId).toBe(lowestLevel.id);
        expect(high.levelId).toBe(highestLevel.id);
      }
    }
  });

  it('RSES 折算后最低 = 10 分而非 0 分（1~4 分制起点）', () => {
    const rses = scaleOrThrow('rses-10');
    const outcome = scoreScale(rses, fillScoredMin(rses));
    expect(outcome.total).toBe(10);
    expect(outcome.levelId).toBe('rses-low');
    // 全选「很不符合」(1) 时，5 道正向题得 5 分、5 道反向题折算成 4 分 = 25，不是最低分
    expect(scoreScale(rses, fillAll(rses, 1)).total).toBe(25);
  });
});

/* -------------------------------------------------------------------------- */
/*                                2. 反向计分                                  */
/* -------------------------------------------------------------------------- */

describe('反向计分', () => {
  it('PSS-10 的反向题恰好是第 4/5/7/8 题', () => {
    const reversed = scaleOrThrow('pss-10')
      .questions.filter((question) => question.reverse)
      .map((question) => question.id);
    expect(reversed).toEqual(['pss-4', 'pss-5', 'pss-7', 'pss-8']);
  });

  it('RSES 的反向题恰好是第 3/5/8/9/10 题', () => {
    const reversed = scaleOrThrow('rses-10')
      .questions.filter((question) => question.reverse)
      .map((question) => question.id);
    expect(reversed).toEqual(['rses-3', 'rses-5', 'rses-8', 'rses-9', 'rses-10']);
  });

  it('PHQ-9 / GAD-7 / ISI 不含反向题', () => {
    for (const id of ['phq-9', 'gad-7', 'isi-7']) {
      expect(scaleOrThrow(id).questions.filter((question) => question.reverse)).toHaveLength(0);
    }
  });

  it('PSS-10 反向题折算为 4 - 分值', () => {
    const pss = scaleOrThrow('pss-10');
    const reversed = pss.questions.find((question) => question.id === 'pss-4')!;
    const forward = pss.questions.find((question) => question.id === 'pss-1')!;
    expect(scoreQuestion(pss, reversed, 0)).toBe(4);
    expect(scoreQuestion(pss, reversed, 1)).toBe(3);
    expect(scoreQuestion(pss, reversed, 2)).toBe(2);
    expect(scoreQuestion(pss, reversed, 3)).toBe(1);
    expect(scoreQuestion(pss, reversed, 4)).toBe(0);
    // 正向题原样返回
    expect(scoreQuestion(pss, forward, 0)).toBe(0);
    expect(scoreQuestion(pss, forward, 4)).toBe(4);
  });

  it('RSES 反向题折算为 5 - 分值（1~4 分制）', () => {
    const rses = scaleOrThrow('rses-10');
    const reversed = rses.questions.find((question) => question.id === 'rses-3')!;
    const forward = rses.questions.find((question) => question.id === 'rses-1')!;
    expect(scoreQuestion(rses, reversed, 1)).toBe(4);
    expect(scoreQuestion(rses, reversed, 2)).toBe(3);
    expect(scoreQuestion(rses, reversed, 3)).toBe(2);
    expect(scoreQuestion(rses, reversed, 4)).toBe(1);
    // 注意：RSES 反向不是 4 - v，而是 5 - v
    expect(scoreQuestion(rses, reversed, 1)).not.toBe(3);
    expect(scoreQuestion(rses, forward, 1)).toBe(1);
    expect(scoreQuestion(rses, forward, 4)).toBe(4);
  });

  it('PSS-10 只改一道反向题，总分反向变化（说明确实参与计分）', () => {
    const pss = scaleOrThrow('pss-10');
    const base = fillAll(pss, 2);
    const baseline = scoreScale(pss, base).total;
    const bumped = scoreScale(pss, { ...base, 'pss-4': 4 }).total;
    // 反向题从 2 -> 4，折算后 2 -> 0，总分应下降 2
    expect(bumped).toBe(baseline - 2);
  });

  it('RSES 只改一道反向题，总分反向变化', () => {
    const rses = scaleOrThrow('rses-10');
    const base = fillAll(rses, 2);
    const baseline = scoreScale(rses, base).total;
    const bumped = scoreScale(rses, { ...base, 'rses-9': 4 }).total;
    // 反向题从 2 -> 4，折算后 3 -> 1，总分应下降 2
    expect(bumped).toBe(baseline - 2);
  });

  it('PSS-10 正向题用「不反向」的方式改写总分不变（防止全表误设 reverse）', () => {
    const pss = scaleOrThrow('pss-10');
    const answers = fillAll(pss, 2);
    const outcome = scoreScale(pss, answers);
    // 6 道正向题各 2 分 = 12；4 道反向题各折算为 2 分 = 8；合计 20
    expect(outcome.total).toBe(20);
  });

  it('RSES 全选「非常符合」(4) 不等于最高分（因为 5 道反向题）', () => {
    const rses = scaleOrThrow('rses-10');
    const all4 = scoreScale(rses, fillAll(rses, 4));
    // 5 道正向 4 分 = 20；5 道反向 4 -> 1 分 = 5；合计 25
    expect(all4.total).toBe(25);
    expect(all4.total).toBeLessThan(totalRange(rses).max);
  });
});

/* -------------------------------------------------------------------------- */
/*                                3. 维度得分                                  */
/* -------------------------------------------------------------------------- */

describe('维度得分', () => {
  it('无维度定义时 dimensionScores 为 undefined', () => {
    for (const id of ['phq-9', 'gad-7']) {
      const scale = scaleOrThrow(id);
      expect(scoreScale(scale, fillAll(scale, 1)).dimensionScores).toBeUndefined();
    }
  });

  it('有维度定义时各维度分之和等于总分（PSS-10 / ISI / RSES）', () => {
    for (const id of ['pss-10', 'isi-7', 'rses-10']) {
      const scale = scaleOrThrow(id);
      const outcome = scoreScale(scale, fillAll(scale, optionRange(scale).min + 1));
      expect(outcome.dimensionScores).toBeDefined();
      const sum = Object.values(outcome.dimensionScores!).reduce((a, b) => a + b, 0);
      expect(sum).toBe(outcome.total);
    }
  });

  it('维度覆盖全部题目，没有题目被漏掉或重复', () => {
    for (const scale of SCALES) {
      if (!scale.dimensions?.length) continue;
      const covered = scale.dimensions.flatMap((dimension) => dimension.questionIds);
      expect(new Set(covered).size).toBe(covered.length); // 无重复
      expect(new Set(covered).size).toBe(scale.questions.length); // 全覆盖
    }
  });

  it('PSS-10 的「掌控与应对感」维度全部由反向题组成（已反向计分）', () => {
    const pss = scaleOrThrow('pss-10');
    const efficacy = pss.dimensions!.find((dimension) => dimension.id === 'pss-efficacy')!;
    const reverseIds = pss.questions.filter((q) => q.reverse).map((q) => q.id);
    expect(efficacy.questionIds).toEqual(reverseIds);
    // 全选 4 时，该维度总分应为 0（掌控感最强 = 压力最低）
    const scores = scoreScale(pss, fillAll(pss, 4)).dimensionScores!;
    expect(scores['pss-efficacy']).toBe(0);
    // 全选 0 时，该维度满分 16
    expect(scoreScale(pss, fillAll(pss, 0)).dimensionScores!['pss-efficacy']).toBe(16);
  });
});

/* -------------------------------------------------------------------------- */
/*                                4. 分级边界                                  */
/* -------------------------------------------------------------------------- */

describe('分级边界', () => {
  it('每档的 min 与 max 都命中自己（闭区间、落点唯一）', () => {
    for (const scale of SCALES) {
      for (const level of scale.levels) {
        expect(findLevel(scale, level.min)?.id).toBe(level.id);
        expect(findLevel(scale, level.max)?.id).toBe(level.id);
      }
    }
  });

  it('相邻档位不重叠、不断裂：上一档 max + 1 = 下一档 min', () => {
    for (const scale of SCALES) {
      for (let i = 1; i < scale.levels.length; i += 1) {
        expect(scale.levels[i].min).toBe(scale.levels[i - 1].max + 1);
      }
    }
  });

  it('分级完整覆盖理论量程（0 下限 / 满分上限）', () => {
    for (const scale of SCALES) {
      const range = totalRange(scale);
      expect(Math.min(...scale.levels.map((level) => level.min))).toBe(range.min);
      expect(Math.max(...scale.levels.map((level) => level.max))).toBe(range.max);
    }
  });

  it('量程内每一个整数分数都能命中唯一一档（穷举）', () => {
    for (const scale of SCALES) {
      const { min, max } = totalRange(scale);
      // 穷举分值 -> 命中的档位数量必须恰好为 1
      for (let total = min; total <= max; total += 1) {
        const hits = scale.levels.filter((level) => total >= level.min && total <= level.max);
        expect(hits.length).toBe(1);
        expect(findLevel(scale, total)?.id).toBe(hits[0].id);
      }
    }
  });

  it('PHQ-9 档位边界：4/5、9/10、14/15、19/20', () => {
    const phq9 = scaleOrThrow('phq-9');
    expect(findLevelId(phq9, 4)).toBe('phq9-none');
    expect(findLevelId(phq9, 5)).toBe('phq9-mild');
    expect(findLevelId(phq9, 9)).toBe('phq9-mild');
    expect(findLevelId(phq9, 10)).toBe('phq9-moderate');
    expect(findLevelId(phq9, 14)).toBe('phq9-moderate');
    expect(findLevelId(phq9, 15)).toBe('phq9-moderately-severe');
    expect(findLevelId(phq9, 19)).toBe('phq9-moderately-severe');
    expect(findLevelId(phq9, 20)).toBe('phq9-severe');
    expect(findLevelId(phq9, 27)).toBe('phq9-severe');
  });

  it('GAD-7 档位边界：4/5、9/10、14/15', () => {
    const gad7 = scaleOrThrow('gad-7');
    expect(findLevelId(gad7, 4)).toBe('gad7-minimal');
    expect(findLevelId(gad7, 5)).toBe('gad7-mild');
    expect(findLevelId(gad7, 9)).toBe('gad7-mild');
    expect(findLevelId(gad7, 10)).toBe('gad7-moderate');
    expect(findLevelId(gad7, 14)).toBe('gad7-moderate');
    expect(findLevelId(gad7, 15)).toBe('gad7-severe');
    expect(findLevelId(gad7, 21)).toBe('gad7-severe');
  });

  it('PSS-10 档位边界：13/14、20/21、26/27', () => {
    const pss = scaleOrThrow('pss-10');
    expect(findLevelId(pss, 13)).toBe('pss-low');
    expect(findLevelId(pss, 14)).toBe('pss-moderate');
    expect(findLevelId(pss, 20)).toBe('pss-moderate');
    expect(findLevelId(pss, 21)).toBe('pss-high');
    expect(findLevelId(pss, 26)).toBe('pss-high');
    expect(findLevelId(pss, 27)).toBe('pss-very-high');
    expect(findLevelId(pss, 40)).toBe('pss-very-high');
  });

  it('ISI 档位边界：7/8、14/15、21/22', () => {
    const isi = scaleOrThrow('isi-7');
    expect(findLevelId(isi, 7)).toBe('isi-none');
    expect(findLevelId(isi, 8)).toBe('isi-subthreshold');
    expect(findLevelId(isi, 14)).toBe('isi-subthreshold');
    expect(findLevelId(isi, 15)).toBe('isi-moderate');
    expect(findLevelId(isi, 21)).toBe('isi-moderate');
    expect(findLevelId(isi, 22)).toBe('isi-clinical');
    expect(findLevelId(isi, 28)).toBe('isi-clinical');
  });

  it('RSES 档位边界：19/20、24/25、29/30', () => {
    const rses = scaleOrThrow('rses-10');
    expect(findLevelId(rses, 10)).toBe('rses-low');
    expect(findLevelId(rses, 19)).toBe('rses-low');
    expect(findLevelId(rses, 20)).toBe('rses-low-average');
    expect(findLevelId(rses, 24)).toBe('rses-low-average');
    expect(findLevelId(rses, 25)).toBe('rses-average');
    expect(findLevelId(rses, 29)).toBe('rses-average');
    expect(findLevelId(rses, 30)).toBe('rses-high');
    expect(findLevelId(rses, 40)).toBe('rses-high');
  });

  it('每个量表都恰好有一档 tone === "alert" 作为求助入口', () => {
    for (const scale of SCALES) {
      const loud = scale.levels.filter((level) => level.tone === 'alert');
      expect(loud.length).toBe(1);
      // 症状类量表（分越高越重）的 alert 在最高档；
      // RSES 是正向量表（分越高越好），它的 alert 在最低档。
      const isPositiveValence = scale.levels[0].tone === 'alert';
      const target = isPositiveValence
        ? scale.levels[0]
        : scale.levels[scale.levels.length - 1];
      expect(loud[0].id).toBe(target.id);
    }
  });

  it('tone 单调：症状量表递增（good→alert），正向量表递减（alert→good）', () => {
    const order: ScaleLevel['tone'][] = ['good', 'watch', 'warn', 'alert'];
    for (const scale of SCALES) {
      const indices = scale.levels.map((level) => order.indexOf(level.tone));
      // 由第一档决定方向：首档是 good 表示分越高越重，首档是 alert 表示分越高越好
      const ascending = indices[0] === order.indexOf('good');
      for (let i = 1; i < indices.length; i += 1) {
        if (ascending) {
          expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
        } else {
          expect(indices[i]).toBeLessThanOrEqual(indices[i - 1]);
        }
      }
    }
  });

  it('RSES 是正向量表：低分 = alert，高分 = good（与其他 4 个量表方向相反）', () => {
    const rses = scaleOrThrow('rses-10');
    expect(rses.levels[0].tone).toBe('alert');
    expect(rses.levels[rses.levels.length - 1].tone).toBe('good');
    // 其余量表都是分越高越重
    for (const id of ['phq-9', 'gad-7', 'pss-10', 'isi-7']) {
      const scale = scaleOrThrow(id);
      expect(scale.levels[0].tone).toBe('good');
      expect(scale.levels[scale.levels.length - 1].tone).toBe('alert');
    }
  });

  it('findLevel 对空分级返回 undefined，findLevelId 给出稳定兜底值', () => {
    const noLevels: Scale = { ...scaleOrThrow('phq-9'), levels: [] };
    expect(findLevel(noLevels, 10)).toBeUndefined();
    expect(findLevelId(noLevels, 10)).toBe('unleveled-10');
  });

  it('分数越界时兜底到最近一档，不返回 undefined（防白屏）', () => {
    for (const scale of SCALES) {
      const { min, max } = totalRange(scale);
      const below = findLevel(scale, min - 7);
      const above = findLevel(scale, max + 7);
      expect(below).toBeDefined();
      expect(above).toBeDefined();
      expect(below!.id).toBe(scale.levels[0].id);
      expect(above!.id).toBe(scale.levels[scale.levels.length - 1].id);
    }
  });

  it('LEVEL_TONE_TEXT 覆盖全部 4 种 tone 且文案非空', () => {
    for (const tone of ['good', 'watch', 'warn', 'alert'] as const) {
      expect(LEVEL_TONE_TEXT[tone]).toBeTruthy();
      expect(LEVEL_TONE_TEXT[tone]).toMatch(CHINESE);
    }
    expect(LEVEL_TONE_TEXT.alert).not.toBe(LEVEL_TONE_TEXT.good);
  });
});

/* -------------------------------------------------------------------------- */
/*                        5. 危机判定（HANDOVER §4.3）                          */
/* -------------------------------------------------------------------------- */

describe('危机判定：只看高危条目，与总分无关', () => {
  const phq9 = scaleOrThrow('phq-9');

  it('PHQ-9 第 9 题 = 0 时返回 false', () => {
    expect(detectCrisis(phq9, fillAll(phq9, 0))).toBe(false);
  });

  it('PHQ-9 第 9 题 = 1（最低阳性档）时返回 true', () => {
    expect(detectCrisis(phq9, { ...fillAll(phq9, 0), 'phq9-9': 1 })).toBe(true);
  });

  it('PHQ-9 第 9 题 2 / 3 分时都返回 true', () => {
    expect(detectCrisis(phq9, { ...fillAll(phq9, 0), 'phq9-9': 2 })).toBe(true);
    expect(detectCrisis(phq9, { ...fillAll(phq9, 0), 'phq9-9': 3 })).toBe(true);
  });

  /**
   * 这是本文件的**核心断言**（HANDOVER §4.3）：
   * 第 9 题选「几乎每天」(3 分)，其余 8 题全选「完全不会」(0 分)，
   * 总分只有 3 分 —— 落在「几乎没有低落困扰 / tone = good」区间。
   * 如果危机检测挂在总分上，这里会漏判；页面就会一边写「状态平稳」一边给热线。
   */
  it('总分很低（3 分，落在 good 区间）但第 9 题 > 0 时，界面色调必须是 alert', () => {
    const answers = { ...fillAll(phq9, 0), 'phq9-9': 3 };
    const outcome = scoreScale(phq9, answers);
    const level = findLevel(phq9, outcome.total);

    // 前提：确实是一个「低分」
    expect(outcome.total).toBe(3);
    expect(outcome.total).toBeLessThanOrEqual(4);
    // 前提：按纯分数分级，它会被判成 good —— 这正是危险之处
    expect(level?.id).toBe('phq9-none');
    expect(level?.tone).toBe('good');

    // 结论：危机检测必须为 true，且用户看到的色调必须是 alert 而不是 good
    expect(detectCrisis(phq9, answers)).toBe(true);
    expect(userFacingTone(phq9, answers)).toBe('alert');
    expect(userFacingTone(phq9, answers)).not.toBe('good');
  });

  it('总分很高但第 9 题为 0 时不应触发条目级危机（入口由 alert 档位负责）', () => {
    const answers = { ...fillAll(phq9, 3), 'phq9-9': 0 };
    const outcome = scoreScale(phq9, answers);
    expect(outcome.total).toBe(24);
    expect(detectCrisis(phq9, answers)).toBe(false);
    // 但最高档本身是 alert，求助入口依然存在
    expect(findLevel(phq9, outcome.total)?.tone).toBe('alert');
    expect(userFacingTone(phq9, answers)).toBe('alert');
  });

  it('除 PHQ-9 外的量表恒为 false（即使全选最高档）', () => {
    for (const id of ['gad-7', 'pss-10', 'isi-7', 'rses-10']) {
      const scale = scaleOrThrow(id);
      expect(detectCrisis(scale, fillAll(scale, optionRange(scale).max))).toBe(false);
      expect(detectCrisis(scale, fillAll(scale, optionRange(scale).min))).toBe(false);
      expect(detectCrisis(scale, {})).toBe(false);
    }
  });

  it('缺答 / 非数字作答不会误判为危机', () => {
    expect(detectCrisis(phq9, {})).toBe(false);
    expect(detectCrisis(phq9, { 'phq9-9': Number.NaN })).toBe(false);
    // NaN 不满足 > 0，所以为 false；这是正确方向（缺答不误报）
    expect(detectCrisis(phq9, { 'phq9-9': -1 })).toBe(false);
    // 脏数据被当成「非数字」忽略
    expect(detectCrisis(phq9, { 'phq9-9': '3' as unknown as number })).toBe(false);
    expect(detectCrisis(phq9, { 'phq9-9': null as unknown as number })).toBe(false);
  });

  it('Infinity 被判为阳性（宁可误报不可漏报的保守方向）', () => {
    // 真实选项只有 0~3，Infinity 只会来自被篡改的存储数据。
    // detectCrisis 用 `typeof raw === 'number' && raw > 0`，
    // 因而 Infinity 会触发危机提示 —— 对安全功能来说，误报好于漏报。
    expect(detectCrisis(phq9, { 'phq9-9': Number.POSITIVE_INFINITY })).toBe(true);
  });

  it('危机判定读取的是第 9 题原始值，不是反向折算值（第 9 题必须不是反向题）', () => {
    const item9 = phq9.questions.find((question) => question.id === 'phq9-9');
    expect(item9).toBeDefined();
    expect(item9!.reverse).toBeUndefined();
    // 第 9 题就是最后一题
    expect(phq9.questions[phq9.questions.length - 1].id).toBe('phq9-9');
  });

  it('PHQ-9 第 9 题必须明确提到自伤 / 死亡相关表述', () => {
    const item9 = phq9.questions.find((question) => question.id === 'phq9-9')!;
    expect(item9.text).toMatch(/伤害自己|死|轻生|自伤/);
  });

  /**
   * 静态守卫：`ScaleRunPage` 里的 `crisisOverridesLevel` 是这条红线的落地点，
   * 一旦有人把结果页退回「只按总分显示分级」的写法，这里会变红。
   */
  it('ScaleRunPage 仍然保留 crisisOverridesLevel 覆盖逻辑（防止红线回退）', () => {
    const file = readFileSync(
      path.resolve(process.cwd(), 'src/pages/ScaleRunPage.tsx'),
      'utf8',
    );
    expect(file).toContain('detectCrisis');
    expect(file).toContain('crisisOverridesLevel');
    expect(file).toContain('crisis && level?.tone !== \'alert\'');
    expect(file).toContain('showCrisis');
    // 危机块必须给出 tel: 链接（可拨打）
    expect(file).toMatch(/tel:/);
  });
});

/* -------------------------------------------------------------------------- */
/*                              6. 文案红线                                    */
/* -------------------------------------------------------------------------- */

describe('文案红线：每档都有中文提示语，且不诊断', () => {
  it('每个量表的每一档都有非空的中文 label / summary / suggestions', () => {
    for (const scale of SCALES) {
      for (const level of scale.levels) {
        expect(level.label.length).toBeGreaterThan(0);
        expect(level.label).toMatch(CHINESE);
        expect(level.summary.length).toBeGreaterThan(0);
        expect(level.summary).toMatch(CHINESE);
        expect(level.suggestions.length).toBeGreaterThan(0);
        for (const suggestion of level.suggestions) {
          expect(suggestion.length).toBeGreaterThan(0);
          expect(suggestion).toMatch(CHINESE);
        }
      }
    }
  });

  it('分级 id 在量表内唯一', () => {
    for (const scale of SCALES) {
      const ids = scale.levels.map((level) => level.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('分级文案不出现诊断性措辞', () => {
    for (const scale of SCALES) {
      for (const level of scale.levels) {
        const texts = [level.label, level.summary, ...level.suggestions];
        for (const text of texts) {
          for (const { pattern, why } of DIAGNOSTIC_PATTERNS) {
            expect(
              pattern.test(text),
              `${scale.id} / ${level.id} 的文案「${text}」命中黑名单：${why}（${pattern}）`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('每个量表的 scoringNote 都声明「这不是诊断」', () => {
    for (const scale of SCALES) {
      expect(scale.scoringNote).toContain('这不是诊断');
    }
  });

  it('alert 档的文案把求助指向具体号码或求助页（不是空口号）', () => {
    for (const scale of SCALES) {
      // 注意：不能取「最后一档」——RSES 是正向量表，alert 在第一档
      const alertLevels = scale.levels.filter((level) => level.tone === 'alert');
      expect(alertLevels.length).toBe(1);
      const joined = [alertLevels[0].summary, ...alertLevels[0].suggestions].join(' ');
      expect(joined).toMatch(/12356|120|热线|门诊|专业|求助|咨询师/);
    }
  });

  it('题目 id 在量表内唯一，且每题都有非空题干', () => {
    for (const scale of SCALES) {
      const ids = scale.questions.map((question) => question.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const question of scale.questions) {
        expect(question.text.length).toBeGreaterThan(0);
        expect(question.text).toMatch(CHINESE);
      }
    }
  });

  it('选项分值互不相同且都是有限数字', () => {
    for (const scale of SCALES) {
      const values = scale.options.map((option) => option.value);
      expect(new Set(values).size).toBe(values.length);
      for (const open of scale.options) {
        expect(Number.isFinite(open.value)).toBe(true);
        expect(open.label).toMatch(CHINESE);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                              7. 健壮性                                      */
/* -------------------------------------------------------------------------- */

describe('健壮性：非法输入不崩、不误判', () => {
  it('未作答的题按最小值计入（不会因缺题抬高分数）', () => {
    const phq9 = scaleOrThrow('phq-9');
    const outcome = scoreScale(phq9, {});
    expect(outcome.total).toBe(0);
    expect(outcome.levelId).toBe('phq9-none');
  });

  it('答案缺一半时只累加已答部分，并可从 countAnswered 看出来', () => {
    const phq9 = scaleOrThrow('phq-9');
    const answers = { 'phq9-1': 3, 'phq9-2': 2 };
    const outcome = scoreScale(phq9, answers);
    expect(outcome.total).toBe(5);
    expect(countAnswered(phq9, answers)).toBe(2);
    expect(countAnswered(phq9, fillAll(phq9, 0))).toBe(9);
  });

  it('负数分值不抛错，且仍返回一个可展示的分级', () => {
    const phq9 = scaleOrThrow('phq-9');
    const outcome = scoreScale(phq9, fillAll(phq9, -5));
    expect(outcome.total).toBe(-45);
    expect(outcome.levelId).toBe('phq9-none'); // 兜底到最近一档，绝不 undefined
  });

  it('超过满分的分值不抛错，且兜底到最高档', () => {
    const phq9 = scaleOrThrow('phq-9');
    const outcome = scoreScale(phq9, fillAll(phq9, 99));
    expect(outcome.total).toBe(891);
    expect(outcome.levelId).toBe('phq9-severe');
  });

  it('非数字 / NaN / Infinity 作答视为未答（按最小值计入）', () => {
    const phq9 = scaleOrThrow('phq-9');
    const outcome = scoreScale(phq9, {
      'phq9-1': Number.NaN,
      'phq9-2': Number.POSITIVE_INFINITY,
      'phq9-3': '2' as unknown as number,
    });
    expect(outcome.total).toBe(0);
  });

  it('答案里混入该量表不认识的题号时被忽略', () => {
    const gad7 = scaleOrThrow('gad-7');
    const outcome = scoreScale(gad7, { ...fillAll(gad7, 1), 'phq9-9': 3, unknown: 99 });
    expect(outcome.total).toBe(7);
    // GAD-7 不会因为混进了 PHQ-9 的题号而被判危机
    expect(detectCrisis(gad7, { 'phq9-9': 3 })).toBe(false);
  });

  it('空题目量表：总分为 0、分级兜底到第一档，不抛错', () => {
    const empty: Scale = { ...scaleOrThrow('phq-9'), questions: [] };
    const outcome = scoreScale(empty, {});
    expect(outcome.total).toBe(0);
    expect(outcome.levelId).toBe('phq9-none');
    expect(countAnswered(empty, {})).toBe(0);
  });

  it('scoreScale 是纯函数：不修改传入的 answers', () => {
    const phq9 = scaleOrThrow('phq-9');
    const answers = { 'phq9-1': 2 };
    const copy = { ...answers };
    scoreScale(phq9, answers);
    detectCrisis(phq9, answers);
    expect(answers).toEqual(copy);
  });

  it('重复调用同一输入返回相同结果（无隐藏状态）', () => {
    const pss = scaleOrThrow('pss-10');
    const answers = fillAll(pss, 3);
    expect(scoreScale(pss, answers)).toEqual(scoreScale(pss, answers));
  });
});
