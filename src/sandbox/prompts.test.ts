/**
 * 引导语选取的回归测试。
 *
 * ── 为什么单独建这个文件 ────────────────────────────────────────
 *
 * `pickPrompts` 从写下那天起就没有直接的单元测试。
 * 它里面藏着一个真实 bug，活了很久没被发现：
 *
 *   原公式 `(seed*7 + i*3 + i) % total` 中 `i*3+i` 就是 `i*4`。
 *   `after` 组 8 条，4 与 8 不互质 → i=0 和 i=2 取到同一下标
 *   → 去重后只剩 2 条。
 *
 * 用户视角：「结束后」这一档点「换一批」，永远只出现 2 句话。
 * 不报错、不是空数组、页面看起来正常，所以只有断言能抓到。
 *
 * 这条 bug 也说明「池子里有 8 条」和「每次能取到 3 条」是两回事 ——
 * 前者是数据，后者是行为，必须分开断言。
 */

import { describe, expect, it } from 'vitest';
import { PROMPT_GROUPS, pickPrompts, promptsForStage, type PromptStage } from './symbols';

const STAGES: PromptStage[] = ['before', 'during', 'after'];

describe('引导语词库', () => {
  it('三档都存在且每档至少 5 条', () => {
    for (const stage of STAGES) {
      expect(Array.isArray(PROMPT_GROUPS[stage])).toBe(true);
      expect(PROMPT_GROUPS[stage].length).toBeGreaterThanOrEqual(5);
    }
  });

  it('词条非空、无重复、无首尾空白', () => {
    for (const stage of STAGES) {
      const pool = PROMPT_GROUPS[stage];
      for (const prompt of pool) {
        expect(prompt.trim()).toBe(prompt);
        expect(prompt.length).toBeGreaterThan(0);
      }
      expect(new Set(pool).size).toBe(pool.length);
    }
  });
});

describe('pickPrompts：数量必须够', () => {
  /*
   * 核心回归：不管池子多长、种子是几，取 3 条就必须真的拿到 3 条。
   *
   * 这条断言在旧实现下对 `after` 组全部种子都失败（只返回 2 条），
   * 是它能暴露那个 bug 的原因。
   */
  it('【回归】任何档位、任何种子都能取满 3 条', () => {
    for (const stage of STAGES) {
      for (let seed = 0; seed < 30; seed += 1) {
        const picked = pickPrompts(seed, 3, stage);
        expect(picked, `stage=${stage} seed=${seed}`).toHaveLength(3);
        expect(new Set(picked).size, `stage=${stage} seed=${seed} 有重复`).toBe(3);
      }
    }
  });

  it('【回归】取满整池时也不丢条目', () => {
    for (const stage of STAGES) {
      const total = PROMPT_GROUPS[stage].length;
      const picked = pickPrompts(0, total, stage);
      expect(picked).toHaveLength(total);
      expect(new Set(picked).size).toBe(total);
    }
  });

  it('请求条数超过池子时，最多给池子那么多', () => {
    for (const stage of STAGES) {
      const total = PROMPT_GROUPS[stage].length;
      const picked = pickPrompts(0, total + 5, stage);
      expect(picked).toHaveLength(total);
    }
  });

  it('count 为 0 或负数时返回空数组', () => {
    expect(pickPrompts(0, 0, 'during')).toHaveLength(0);
    expect(pickPrompts(0, -3, 'during')).toHaveLength(0);
  });

  it('负种子不产生 undefined', () => {
    // 旧实现用 % 直接取模，负种子会得到负数下标 → pool[-1] === undefined
    const picked = pickPrompts(-5, 3, 'during');
    expect(picked).toHaveLength(3);
    for (const prompt of picked) expect(typeof prompt).toBe('string');
  });
});

describe('pickPrompts：稳定与变化', () => {
  it('同一种子结果稳定（重渲染不会跳字）', () => {
    for (const stage of STAGES) {
      expect(pickPrompts(7, 3, stage)).toEqual(pickPrompts(7, 3, stage));
    }
  });

  it('换种子内容会变（「换一批」真的换了）', () => {
    for (const stage of STAGES) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 8; seed += 1) {
        seen.add(pickPrompts(seed, 3, stage).join('|'));
      }
      /* 8 个种子至少产生 2 种不同组合，否则「换一批」是摆设 */
      expect(seen.size).toBeGreaterThan(1);
    }
  });

  it('promptsForStage 与 pickPrompts 一致', () => {
    expect(promptsForStage('after', 3, 3)).toEqual(pickPrompts(3, 3, 'after'));
  });
});

describe('引导语的红线：不做解读', () => {
  /*
   * CONTRACT §5.6：不诊断、不解释。
   * 扫描整池（不抽样）—— 种子只影响取哪几条，全量扫才彻底。
   */
  it('全池不出现解读/诊断/指令性措辞', () => {
    const forbidden = [
      '代表你',
      '说明你',
      '你有抑郁',
      '诊断',
      '应该',
      '治疗',
      '症状',
      '因为你',
      '心理问题',
    ];
    for (const stage of STAGES) {
      for (const prompt of PROMPT_GROUPS[stage]) {
        for (const word of forbidden) {
          expect(prompt.includes(word), `「${prompt}」含「${word}」`).toBe(false);
        }
      }
    }
  });

  it('全部以问句或中性陈述结尾，不带建议式祈使', () => {
    const preachy = ['你必须', '一定要', '建议你', '最好去'];
    for (const stage of STAGES) {
      for (const prompt of PROMPT_GROUPS[stage]) {
        for (const word of preachy) {
          expect(prompt.includes(word), `「${prompt}」含「${word}」`).toBe(false);
        }
      }
    }
  });
});
