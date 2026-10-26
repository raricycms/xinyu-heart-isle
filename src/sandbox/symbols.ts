/**
 * 心屿 · 赛博沙盘象征物素材库
 *
 * 设计原则：
 * 1. 用 emoji / 单字符绘制，不引入任何图片依赖（离线可用、零体积）。
 * 2. 只提供"素材"，不提供"解读"。一个象征物意味着什么，由摆它的人自己决定。
 * 3. 分类保持中性：不预设"好/坏"象征，蛇、刀、墙都在库里。
 */

export type SymbolCategory =
  | 'nature'
  | 'creature'
  | 'person'
  | 'building'
  | 'object'
  | 'abstract';

export interface SandboxSymbol {
  id: string;
  label: string;
  category: SymbolCategory;
  glyph: string;
}

export const categoryLabels: Record<SymbolCategory, string> = {
  nature: '自然',
  creature: '生灵',
  person: '人物',
  building: '建筑',
  object: '物件',
  abstract: '抽象',
};

/** 分类展示顺序 */
export const categoryOrder: SymbolCategory[] = [
  'nature',
  'creature',
  'person',
  'building',
  'object',
  'abstract',
];

export const SYMBOLS: SandboxSymbol[] = [
  // -------------------------------- 自然 --------------------------------
  { id: 'tree', label: '树', category: 'nature', glyph: '🌳' },
  { id: 'mountain', label: '山', category: 'nature', glyph: '⛰️' },
  { id: 'sea', label: '海', category: 'nature', glyph: '🌊' },
  { id: 'moon', label: '月亮', category: 'nature', glyph: '🌙' },
  { id: 'star', label: '星星', category: 'nature', glyph: '⭐' },
  { id: 'cloud', label: '云', category: 'nature', glyph: '☁️' },
  { id: 'rain', label: '雨', category: 'nature', glyph: '🌧️' },
  { id: 'flower', label: '花', category: 'nature', glyph: '🌸' },
  { id: 'stone', label: '石头', category: 'nature', glyph: '🪨' },
  { id: 'fire', label: '火', category: 'nature', glyph: '🔥' },
  { id: 'sun', label: '太阳', category: 'nature', glyph: '☀️' },
  { id: 'seedling', label: '幼苗', category: 'nature', glyph: '🌱' },

  // -------------------------------- 生灵 --------------------------------
  { id: 'cat', label: '猫', category: 'creature', glyph: '🐈' },
  { id: 'dog', label: '狗', category: 'creature', glyph: '🐕' },
  { id: 'bird', label: '鸟', category: 'creature', glyph: '🕊️' },
  { id: 'fish', label: '鱼', category: 'creature', glyph: '🐟' },
  { id: 'butterfly', label: '蝴蝶', category: 'creature', glyph: '🦋' },
  { id: 'snake', label: '蛇', category: 'creature', glyph: '🐍' },
  { id: 'horse', label: '马', category: 'creature', glyph: '🐎' },
  { id: 'deer', label: '鹿', category: 'creature', glyph: '🦌' },
  { id: 'spider', label: '蜘蛛', category: 'creature', glyph: '🕷️' },
  { id: 'wolf', label: '狼', category: 'creature', glyph: '🐺' },

  // -------------------------------- 人物 --------------------------------
  { id: 'me', label: '我', category: 'person', glyph: '🧍' },
  { id: 'family', label: '家人', category: 'person', glyph: '👨‍👩‍👧' },
  { id: 'friend', label: '朋友', category: 'person', glyph: '🧑‍🤝‍🧑' },
  { id: 'stranger', label: '陌生人', category: 'person', glyph: '🧑' },
  { id: 'child', label: '孩子', category: 'person', glyph: '🧒' },
  { id: 'elder', label: '老人', category: 'person', glyph: '🧓' },
  { id: 'crowd', label: '一群人', category: 'person', glyph: '👥' },
  { id: 'myself-small', label: '小小的我', category: 'person', glyph: '🧸' },

  // -------------------------------- 建筑 --------------------------------
  { id: 'house', label: '房子', category: 'building', glyph: '🏠' },
  { id: 'door', label: '门', category: 'building', glyph: '🚪' },
  { id: 'window', label: '窗', category: 'building', glyph: '🪟' },
  { id: 'bridge', label: '桥', category: 'building', glyph: '🌉' },
  { id: 'wall', label: '墙', category: 'building', glyph: '🧱' },
  { id: 'tower', label: '塔', category: 'building', glyph: '🗼' },
  { id: 'school', label: '学校', category: 'building', glyph: '🏫' },
  { id: 'hospital', label: '医院', category: 'building', glyph: '🏥' },
  { id: 'stairs', label: '楼梯', category: 'building', glyph: '🪜' },

  // -------------------------------- 物件 --------------------------------
  { id: 'mirror', label: '镜子', category: 'object', glyph: '🪞' },
  { id: 'clock', label: '钟表', category: 'object', glyph: '⏰' },
  { id: 'key', label: '钥匙', category: 'object', glyph: '🔑' },
  { id: 'lock', label: '锁', category: 'object', glyph: '🔒' },
  { id: 'rope', label: '绳子', category: 'object', glyph: '🪢' },
  { id: 'box', label: '箱子', category: 'object', glyph: '📦' },
  { id: 'knife', label: '刀', category: 'object', glyph: '🔪' },
  { id: 'gift', label: '礼物', category: 'object', glyph: '🎁' },
  { id: 'letter', label: '信', category: 'object', glyph: '✉️' },
  { id: 'lamp', label: '灯', category: 'object', glyph: '🕯️' },

  // -------------------------------- 抽象 --------------------------------
  { id: 'light', label: '光', category: 'abstract', glyph: '✨' },
  { id: 'shadow', label: '影子', category: 'abstract', glyph: '🌑' },
  { id: 'vortex', label: '漩涡', category: 'abstract', glyph: '🌀' },
  { id: 'fog', label: '雾', category: 'abstract', glyph: '🌫️' },
  { id: 'gap', label: '门缝', category: 'abstract', glyph: '▮' },
  { id: 'question', label: '问号', category: 'abstract', glyph: '❓' },
  { id: 'heart', label: '心', category: 'abstract', glyph: '❤️' },
  { id: 'void', label: '空', category: 'abstract', glyph: '◯' },
  { id: 'knot', label: '结', category: 'abstract', glyph: '➰' },
  { id: 'bubble', label: '气泡', category: 'abstract', glyph: '🫧' },
];

const symbolMap = new Map(SYMBOLS.map((symbol) => [symbol.id, symbol]));

export function getSymbolById(id: string): SandboxSymbol | undefined {
  return symbolMap.get(id);
}

/** 取 glyph，找不到时返回一个中性占位符（避免历史数据里出现未知 id 时白屏） */
export function symbolGlyph(id: string): string {
  return symbolMap.get(id)?.glyph ?? '◌';
}

export function symbolLabel(id: string): string {
  return symbolMap.get(id)?.label ?? '未知';
}

export function symbolsByCategory(): Array<{ category: SymbolCategory; label: string; items: SandboxSymbol[] }> {
  return categoryOrder.map((category) => ({
    category,
    label: categoryLabels[category],
    items: SYMBOLS.filter((symbol) => symbol.category === category),
  }));
}

/** 自我探索引导问题：不解释、只提问，解释权留给用户 */
export const EXPLORATION_PROMPTS: string[] = [
  '这个摆件离你最近，它代表什么？',
  '哪个摆件离你最远？为什么把它放那么远？',
  '如果能在沙盘里再加一样东西，你会加什么？',
  '如果这些摆件会说话，最沉默的那个会说什么？',
  '有哪个摆件是你想拿掉，却还留着的？',
  '把"你"放在这里的那一刻，你在想什么？',
  '如果这个画面是一周后的样子，哪里会变？',
  '画面里有没有一个位置，是让你觉得安全一点的？',
  '你给某个摆件写了注释吗？那句话是对谁说的？',
  '如果这个沙盘有一个标题，你会叫它什么？',
];

/** 取 3 个提示，基于种子保证同一次渲染内稳定 */
export function pickPrompts(seed: number, count = 3): string[] {
  const total = EXPLORATION_PROMPTS.length;
  const picked: string[] = [];
  for (let i = 0; i < count; i += 1) {
    picked.push(EXPLORATION_PROMPTS[(seed * 7 + i * 3 + i) % total]);
  }
  return [...new Set(picked)];
}
