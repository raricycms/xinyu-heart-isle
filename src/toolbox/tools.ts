import { toolSessionStore } from '@/lib/storage';
import { createId } from '@/lib/id';
import { nowISO } from '@/lib/date';
import type { ToolSession } from '@/lib/types';

/* ==========================================================================
   心屿 · 情绪工具箱元数据
   ========================================================================== */

export type ToolCategory = '立即安抚' | '认知梳理' | '日常记录';

export interface ToolMeta {
  id: string;
  label: string;
  description: string;
  category: ToolCategory;
  durationMin: number;
  glyph: string;
  /** 一句话说明适合什么状态 */
  whenToUse: string;
}

export const TOOLS: ToolMeta[] = [
  {
    id: 'breathing-478',
    label: '4-7-8 呼吸',
    description: '吸气 4 秒、屏息 7 秒、呼气 8 秒。呼气比吸气长，是最快把身体从"警报状态"拉回来的方法之一。',
    category: '立即安抚',
    durationMin: 1,
    glyph: '◎',
    whenToUse: '心跳很快、睡不着、脑子停不下来',
  },
  {
    id: 'box-breathing',
    label: '方块呼吸',
    description: '吸 4、屏 4、呼 4、停 4，四步一样长。节奏方正、容易记住，适合在人多的地方偷偷做。',
    category: '立即安抚',
    durationMin: 2,
    glyph: '▢',
    whenToUse: '紧张、想吐、控制不住发抖',
  },
  {
    id: 'grounding-54321',
    label: '5-4-3-2-1 着陆练习',
    description: '用五感把自己从回忆和担忧里拽回"现在"。数出看见的、摸到的、听见的、闻到的、尝到的。',
    category: '立即安抚',
    durationMin: 3,
    glyph: '✋',
    whenToUse: '喘不上气、感觉不真实、像在做梦',
  },
  {
    id: 'body-scan',
    label: '身体扫描',
    description: '从头顶到脚趾，一段一段把注意力放回身体。不要求放松，只要求"发现那里有什么"。',
    category: '立即安抚',
    durationMin: 8,
    glyph: '◍',
    whenToUse: '麻木、和身体断联、躺下也睡不着',
  },
  {
    id: 'thought-record',
    label: '思维记录表',
    description: '四步把一个反复咬住你的念头拆开：发生了什么、我想到了什么、证据是什么、还有别的可能吗。',
    category: '认知梳理',
    durationMin: 10,
    glyph: '▦',
    whenToUse: '钻牛角尖、反复想同一件事',
  },
  {
    id: 'worry-time',
    label: '担忧时间',
    description: '把担忧集中到一个固定时段来担心。听起来反直觉，但它能把"全天候焦虑"缩成一段有限的时间。',
    category: '日常记录',
    durationMin: 10,
    glyph: '⧗',
    whenToUse: '一整天都在焦虑，什么都做不好',
  },
  {
    id: 'three-good-things',
    label: '三件好事',
    description: '每天写下三件还行的小事，以及"它为什么发生"。不是强行乐观，是练习注意到好东西的存在。',
    category: '日常记录',
    durationMin: 3,
    glyph: '☘',
    whenToUse: '状态还行，想让自己更稳一点',
  },
];

export const TOOL_CATEGORIES: ToolCategory[] = ['立即安抚', '认知梳理', '日常记录'];

export const TOOL_CATEGORY_HINTS: Record<ToolCategory, string> = {
  立即安抚: '情绪正在上头时先做这个。不需要想清楚，先让身体降下来。',
  认知梳理: '身体稍微稳一点之后，再来整理脑子里反复播放的那句话。',
  日常记录: '状态平稳时使用，积累一点对自己的了解。',
};

const toolMap = new Map(TOOLS.map((tool) => [tool.id, tool]));

export function getToolById(id: string): ToolMeta | undefined {
  return toolMap.get(id);
}

export function toolsByCategory(): Array<{ category: ToolCategory; hint: string; items: ToolMeta[] }> {
  return TOOL_CATEGORIES.map((category) => ({
    category,
    hint: TOOL_CATEGORY_HINTS[category],
    items: TOOLS.filter((tool) => tool.category === category),
  }));
}

/* -------------------------------------------------------------------------- */
/*                                 记录一次练习                                 */
/* -------------------------------------------------------------------------- */

/**
 * 写入一次练习记录。失败（例如隐私模式）不应打断练习体验，
 * 所以这里吞掉异常，只做 console 提示。
 */
export function recordToolSession(
  toolId: string,
  durationSec?: number,
  payload?: Record<string, unknown>,
): ToolSession | null {
  try {
    const session: ToolSession = {
      id: createId('session'),
      at: nowISO(),
      toolId,
      durationSec: typeof durationSec === 'number' ? Math.max(0, Math.round(durationSec)) : undefined,
      payload,
    };
    toolSessionStore.add(session);
    return session;
  } catch (error) {
    console.warn('[心屿] 练习记录未能保存。', error);
    return null;
  }
}
