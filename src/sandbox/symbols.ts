/**
 * 心屿 · 赛博沙盘象征物素材库（v2）
 *
 * 设计原则（VISION.md §5.2）：
 * 1. **只提供素材，不提供解读**。一个象征物意味着什么，由摆它的人自己决定；
 * 2. **分类保持中性**。不预设"好/坏"象征：蛇、刀、墙、废墟、坟墓都在库里；
 * 3. **可检索**：6 大类 + 24 子类 + 中英标签 + 关键词，300+ 条目；
 * 4. **零体积**：用 emoji / 单字符绘制，不引入图片依赖，离线可用。
 *
 * 分类本体说明：国内培训常用 13 类分类，本库用 6 大类 + 24 子类，
 * 便于检索且不做诊断映射（见 VISION.md §5.2）。
 */

import type { SandboxSymbolEntry, SymbolSubcategory } from '@/lib/types';

/** 大类（兼容 v1 的 6 类） */
export type SymbolCategory =
  | 'nature'
  | 'creature'
  | 'person'
  | 'building'
  | 'object'
  | 'abstract';

export type SandboxSymbol = SandboxSymbolEntry;

/** 大类标签 */
export const categoryLabels: Record<SymbolCategory, string> = {
  nature: '自然',
  creature: '生灵',
  person: '人物',
  building: '建筑',
  object: '物件',
  abstract: '抽象',
};

export const categoryLabelsEn: Record<SymbolCategory, string> = {
  nature: 'Nature',
  creature: 'Creatures',
  person: 'People',
  building: 'Buildings',
  object: 'Objects',
  abstract: 'Abstract',
};

/** 大类展示顺序 */
export const categoryOrder: SymbolCategory[] = [
  'nature',
  'creature',
  'person',
  'building',
  'object',
  'abstract',
];

/** 子类标签（18+ 子类，见 VISION.md §5.2） */
export const subcategoryLabels: Record<SymbolSubcategory, string> = {
  'nature-land': '地貌',
  'nature-water': '水',
  'nature-sky': '天空',
  'nature-plant': '植物',
  'animal-wild': '野生动物',
  'animal-farm': '家畜',
  'animal-water': '水族',
  'animal-insect': '昆虫',
  'person-adult': '成人',
  'person-child': '儿童',
  'person-family': '家庭',
  'person-role': '职业',
  'person-myth': '神话',
  'building-home': '家居',
  'building-public': '公共',
  'building-religious': '宗教',
  'building-ruin': '废墟',
  'object-daily': '日常',
  'object-tool': '工具',
  'object-food': '食物',
  'object-vehicle': '交通',
  'object-treasure': '宝物',
  'abstract-symbol': '符号',
  'abstract-element': '元素',
};

/** 子类 -> 大类映射 */
export const subcategoryCategory: Record<SymbolSubcategory, SymbolCategory> = {
  'nature-land': 'nature',
  'nature-water': 'nature',
  'nature-sky': 'nature',
  'nature-plant': 'nature',
  'animal-wild': 'creature',
  'animal-farm': 'creature',
  'animal-water': 'creature',
  'animal-insect': 'creature',
  'person-adult': 'person',
  'person-child': 'person',
  'person-family': 'person',
  'person-role': 'person',
  'person-myth': 'person',
  'building-home': 'building',
  'building-public': 'building',
  'building-religious': 'building',
  'building-ruin': 'building',
  'object-daily': 'object',
  'object-tool': 'object',
  'object-food': 'object',
  'object-vehicle': 'object',
  'object-treasure': 'object',
  'abstract-symbol': 'abstract',
  'abstract-element': 'abstract',
};

/** 生成条目的简写：s(id, label, subcategory, glyph, tags) */
function s(
  id: string,
  label: string,
  subcategory: SymbolSubcategory,
  glyph: string,
  tags: string[] = [],
): SandboxSymbolEntry {
  return {
    id,
    label,
    category: subcategoryCategory[subcategory],
    subcategory,
    glyph,
    tags,
    packId: 'core',
    license: 'emoji (Unicode)',
  };
}

/**
 * 内置素材库。条目按子类分组，顺序即展示顺序。
 *
 * 授权说明：全部使用 Unicode emoji 字符，不涉及第三方图片资产，
 * 可随代码以 Apache-2.0 分发（详见 THIRD_PARTY_NOTICES.md）。
 */
export const SYMBOLS: SandboxSymbolEntry[] = [
  /* ------------------------------ 自然 · 地貌 ------------------------------ */
  s('mountain', '山', 'nature-land', '⛰️', ['mountain', '山', '高峰']),
  s('volcano', '火山', 'nature-land', '🌋', ['volcano', '火山', '爆发']),
  s('desert', '沙漠', 'nature-land', '🏜️', ['desert', '沙漠', '干旱']),
  s('cave', '洞穴', 'nature-land', '🕳️', ['cave', '洞', '黑暗']),
  s('cliff', '悬崖', 'nature-land', '🪨', ['cliff', '悬崖', '边缘']),
  s('island', '岛', 'nature-land', '🏝️', ['island', '岛', '孤立']),
  s('beach', '沙滩', 'nature-land', '🏖️', ['beach', '沙滩', '岸']),
  s('field', '田野', 'nature-land', '🌾', ['field', '田', '稻']),
  s('stone', '石头', 'nature-land', '🪨', ['stone', '石', '坚硬']),
  s('sand-dune', '沙丘', 'nature-land', '🏜️', ['dune', '沙丘', '起伏']),
  s('valley', '山谷', 'nature-land', '🏞️', ['valley', '谷', '低处']),
  s('hill', '小丘', 'nature-land', '⛰️', ['hill', '丘', '缓坡']),

  /* ------------------------------- 自然 · 水 ------------------------------- */
  s('sea', '海', 'nature-water', '🌊', ['sea', '海', '浪']),
  s('river', '河', 'nature-water', '🏞️', ['river', '河', '流动']),
  s('lake', '湖', 'nature-water', '🏞️', ['lake', '湖', '静水']),
  s('waterfall', '瀑布', 'nature-water', '🏞️', ['waterfall', '瀑布', '落差']),
  s('rain', '雨', 'nature-water', '🌧️', ['rain', '雨', '落']),
  s('fog', '雾', 'nature-water', '🌫️', ['fog', '雾', '不清']),
  s('spring', '泉', 'nature-water', '⛲', ['spring', '泉', '源']),
  s('wave', '浪', 'nature-water', '🌊', ['wave', '浪', '起伏']),
  s('pool', '水洼', 'nature-water', '💧', ['pool', '水洼', '积']),
  s('ice', '冰', 'nature-water', '🧊', ['ice', '冰', '冻结']),

  /* ------------------------------ 自然 · 天空 ------------------------------ */
  s('sun', '太阳', 'nature-sky', '☀️', ['sun', '太阳', '光']),
  s('moon', '月亮', 'nature-sky', '🌙', ['moon', '月亮', '夜']),
  s('star', '星星', 'nature-sky', '⭐', ['star', '星', '远']),
  s('cloud', '云', 'nature-sky', '☁️', ['cloud', '云', '飘']),
  s('rainbow', '彩虹', 'nature-sky', '🌈', ['rainbow', '虹', '晴']),
  s('lightning', '闪电', 'nature-sky', '⚡', ['lightning', '雷', '突']),
  s('sky', '天空', 'nature-sky', '🌌', ['sky', '天', '辽阔']),
  s('comet', '流星', 'nature-sky', '☄️', ['comet', '流星', '瞬']),

  /* ------------------------------ 自然 · 植物 ------------------------------ */
  s('tree', '树', 'nature-plant', '🌳', ['tree', '树', '生长']),
  s('pine', '松树', 'nature-plant', '🌲', ['pine', '松', '常绿']),
  s('palm', '棕榈', 'nature-plant', '🌴', ['palm', '棕榈', '南']),
  s('flower', '花', 'nature-plant', '🌸', ['flower', '花', '开']),
  s('rose', '玫瑰', 'nature-plant', '🌹', ['rose', '玫瑰', '刺']),
  s('sunflower', '向日葵', 'nature-plant', '🌻', ['sunflower', '向日', '追光']),
  s('seedling', '幼苗', 'nature-plant', '🌱', ['seedling', '苗', '开始']),
  s('leaf', '叶子', 'nature-plant', '🍃', ['leaf', '叶', '落']),
  s('fallen-leaf', '落叶', 'nature-plant', '🍂', ['fallen leaf', '落叶', '枯']),
  s('cactus', '仙人掌', 'nature-plant', '🌵', ['cactus', '仙人掌', '旱']),
  s('mushroom', '蘑菇', 'nature-plant', '🍄', ['mushroom', '菌', '阴']),
  s('herb', '草', 'nature-plant', '🌿', ['grass', '草', '低']),
  s('bamboo', '竹', 'nature-plant', '🎍', ['bamboo', '竹', '节']),
  s('wheat', '麦子', 'nature-plant', '🌾', ['wheat', '麦', '收']),

  /* ---------------------------- 生灵 · 野生动物 ---------------------------- */
  s('wolf', '狼', 'animal-wild', '🐺', ['wolf', '狼', '群']),
  s('fox', '狐狸', 'animal-wild', '🦊', ['fox', '狐', '灵']),
  s('deer', '鹿', 'animal-wild', '🦌', ['deer', '鹿', '机警']),
  s('bear', '熊', 'animal-wild', '🐻', ['bear', '熊', '重']),
  s('tiger', '老虎', 'animal-wild', '🐯', ['tiger', '虎', '猛']),
  s('lion', '狮子', 'animal-wild', '🦁', ['lion', '狮', '威']),
  s('elephant', '大象', 'animal-wild', '🐘', ['elephant', '象', '稳']),
  s('monkey', '猴子', 'animal-wild', '🐒', ['monkey', '猴', '动']),
  s('rabbit', '兔子', 'animal-wild', '🐇', ['rabbit', '兔', 'soft']),
  s('squirrel', '松鼠', 'animal-wild', '🐿️', ['squirrel', '松鼠', '藏']),
  s('hedgehog', '刺猬', 'animal-wild', '🦔', ['hedgehog', '刺猬', '防']),
  s('owl', '猫头鹰', 'animal-wild', '🦉', ['owl', '猫头鹰', '夜']),
  s('eagle', '鹰', 'animal-wild', '🦅', ['eagle', '鹰', '高']),
  s('swan', '天鹅', 'animal-wild', '🦢', ['swan', '天鹅', '洁']),
  s('penguin', '企鹅', 'animal-wild', '🐧', ['penguin', '企鹅', '寒']),
  s('peacock', '孔雀', 'animal-wild', '🦚', ['peacock', '孔雀', '展']),
  s('parrot', '鹦鹉', 'animal-wild', '🦜', ['parrot', '鹦鹉', 'repeat']),
  s('turtle', '乌龟', 'animal-wild', '🐢', ['turtle', '龟', '慢']),
  s('frog', '青蛙', 'animal-wild', '🐸', ['frog', '蛙', '变']),
  s('lizard', '蜥蜴', 'animal-wild', '🦎', ['lizard', '蜥蜴', 'cold']),
  s('whale', '鲸', 'animal-wild', '🐋', ['whale', '鲸', '深']),
  s('dolphin', '海豚', 'animal-wild', '🐬', ['dolphin', '海豚', 'close']),
  s('seal', '海豹', 'animal-wild', '🦭', ['seal', '海豹', '圆']),
  s('bat', '蝙蝠', 'animal-wild', '🦇', ['bat', '蝙蝠', 'dark']),
  s('crocodile', '鳄鱼', 'animal-wild', '🐊', ['crocodile', '鳄', '危']),
  s('snake', '蛇', 'animal-wild', '🐍', ['snake', '蛇', '蜕']),

  /* ----------------------------- 生灵 · 家畜 ------------------------------ */
  s('dog', '狗', 'animal-farm', '🐕', ['dog', '狗', '伴']),
  s('cat', '猫', 'animal-farm', '🐈', ['cat', '猫', '自由']),
  s('horse', '马', 'animal-farm', '🐎', ['horse', '马', '跑']),
  s('cow', '牛', 'animal-farm', '🐄', ['cow', '牛', '耕']),
  s('pig', '猪', 'animal-farm', '🐖', ['pig', '猪', '足']),
  s('sheep', '羊', 'animal-farm', '🐑', ['sheep', '羊', '顺']),
  s('goat', '山羊', 'animal-farm', '🐐', ['goat', '山羊', '攀']),
  s('chicken', '鸡', 'animal-farm', '🐓', ['chicken', '鸡', '报']),
  s('duck', '鸭', 'animal-farm', '🦆', ['duck', '鸭', '游']),
  s('bee', '蜜蜂', 'animal-farm', '🐝', ['bee', '蜂', '忙']),

  /* ----------------------------- 生灵 · 水族 ------------------------------ */
  s('fish', '鱼', 'animal-water', '🐟', ['fish', '鱼', '游']),
  s('tropical-fish', '热带鱼', 'animal-water', '🐠', ['tropical fish', '彩']),
  s('shark', '鲨鱼', 'animal-water', '🦈', ['shark', '鲨', '险']),
  s('octopus', '章鱼', 'animal-water', '🐙', ['octopus', '章鱼', '缠']),
  s('jellyfish', '水母', 'animal-water', '🪼', ['jellyfish', '水母', '浮']),
  s('crab', '蟹', 'animal-water', '🦀', ['crab', '蟹', '横']),
  s('shell', '贝壳', 'animal-water', '🐚', ['shell', '贝', '藏']),
  s('coral', '珊瑚', 'animal-water', '🪸', ['coral', '珊瑚', '群']),

  /* ----------------------------- 生灵 · 昆虫 ------------------------------ */
  s('butterfly', '蝴蝶', 'animal-insect', '🦋', ['butterfly', '蝶', '变']),
  s('spider', '蜘蛛', 'animal-insect', '🕷️', ['spider', '蜘蛛', '网']),
  s('ant', '蚂蚁', 'animal-insect', '🐜', ['ant', '蚁', '小']),
  s('ladybug', '瓢虫', 'animal-insect', '🐞', ['ladybug', '瓢虫', '点']),
  s('dragonfly', '蜻蜓', 'animal-insect', '🪰', ['dragonfly', '蜻蜓', '轻']),
  s('snail', '蜗牛', 'animal-insect', '🐌', ['snail', '蜗牛', '慢']),
  s('caterpillar', '毛毛虫', 'animal-insect', '🐛', ['caterpillar', '虫', '前']),
  s('scorpion', '蝎子', 'animal-insect', '🦂', ['scorpion', '蝎', '刺']),

  /* ----------------------------- 人物 · 成人 ------------------------------ */
  s('me', '我', 'person-adult', '🧍', ['me', '我', 'self']),
  s('stranger', '陌生人', 'person-adult', '🧑', ['stranger', '陌生', '外']),
  s('elder', '老人', 'person-adult', '🧓', ['elder', '老', '年长']),
  s('woman', '女人', 'person-adult', '👩', ['woman', '女']),
  s('man', '男人', 'person-adult', '👨', ['man', '男']),
  s('pregnant', '孕妇', 'person-adult', '🤰', ['pregnant', '孕', '新生']),
  s('person-sit', '坐着的人', 'person-adult', '🧎', ['sit', '坐', '停']),
  s('person-back', '背影', 'person-adult', '🚶', ['back', '背影', '离']),
  s('person-cry', '哭的人', 'person-adult', '😢', ['cry', '哭', '痛']),
  s('person-angry', '生气的人', 'person-adult', '😠', ['angry', '怒']),
  s('person-afraid', '害怕的人', 'person-adult', '😨', ['afraid', '怕']),
  s('person-calm', '平静的人', 'person-adult', '😌', ['calm', '静']),

  /* ----------------------------- 人物 · 儿童 ------------------------------ */
  s('child', '孩子', 'person-child', '🧒', ['child', '孩子', '小']),
  s('baby', '婴儿', 'person-child', '👶', ['baby', '婴', '初']),
  s('girl', '女孩', 'person-child', '👧', ['girl', '女孩']),
  s('boy', '男孩', 'person-child', '👦', ['boy', '男孩']),
  s('myself-small', '小小的我', 'person-child', '🧸', ['inner child', '小我', '童']),
  s('student', '学生', 'person-child', '🧑‍🎓', ['student', '学生', '学']),

  /* ----------------------------- 人物 · 家庭 ------------------------------ */
  s('family', '家人', 'person-family', '👨‍👩‍👧', ['family', '家', '庭']),
  s('mother', '母亲', 'person-family', '👩‍👦', ['mother', '母']),
  s('father', '父亲', 'person-family', '👨‍👦', ['father', '父']),
  s('couple', '伴侣', 'person-family', '💑', ['couple', '伴', '爱']),
  s('grandparent', '祖辈', 'person-family', '👴', ['grandparent', '祖', '辈']),
  s('siblings', '兄弟姐妹', 'person-family', '👫', ['sibling', '兄弟', '姐妹']),
  s('friend', '朋友', 'person-family', '🧑‍🤝‍🧑', ['friend', '朋友', '近']),
  s('crowd', '一群人', 'person-family', '👥', ['crowd', '群', '多']),

  /* ----------------------------- 人物 · 职业 ------------------------------ */
  s('doctor', '医生', 'person-role', '🧑‍⚕️', ['doctor', '医', '救']),
  s('nurse', '护士', 'person-role', '👩‍⚕️', ['nurse', '护']),
  s('teacher', '老师', 'person-role', '🧑‍🏫', ['teacher', '师', '教']),
  s('police', '警察', 'person-role', '👮', ['police', '警', '护']),
  s('worker', '工人', 'person-role', '👷', ['worker', '工', '建']),
  s('farmer', '农民', 'person-role', '🧑‍🌾', ['farmer', '农', '种']),
  s('chef', '厨师', 'person-role', '🧑‍🍳', ['chef', '厨', '食']),
  s('artist', '艺术家', 'person-role', '🧑‍🎨', ['artist', '画', '创']),
  s('soldier', '军人', 'person-role', '🪖', ['soldier', '军', '战']),
  s('monk', '修行者', 'person-role', '🧘', ['monk', '僧', '静']),

  /* ----------------------------- 人物 · 神话 ------------------------------ */
  s('angel', '天使', 'person-myth', '👼', ['angel', '天使', '护']),
  s('ghost', '幽灵', 'person-myth', '👻', ['ghost', '鬼', '未了']),
  s('fairy', '精灵', 'person-myth', '🧚', ['fairy', '仙', '灵']),
  s('wizard', '巫师', 'person-myth', '🧙', ['wizard', '巫', '力']),
  s('dragon', '龙', 'person-myth', '🐉', ['dragon', '龙', '威']),
  s('unicorn', '独角兽', 'person-myth', '🦄', ['unicorn', '独角', 'rare']),
  s('mermaid', '人鱼', 'person-myth', '🧜', ['mermaid', '人鱼', '半']),
  s('giant', '巨人', 'person-myth', '🗿', ['giant', '巨', '压']),
  s('skeleton', '骷髅', 'person-myth', '💀', ['skeleton', '死', '终']),
  s('demon', '恶魔', 'person-myth', '👹', ['demon', '魔', '暗']),

  /* ---------------------------- 建筑 · 家居 ------------------------------- */
  s('house', '房子', 'building-home', '🏠', ['house', '家', '安']),
  s('door', '门', 'building-home', '🚪', ['door', '门', '出入']),
  s('window', '窗', 'building-home', '🪟', ['window', '窗', '看']),
  s('bed', '床', 'building-home', '🛏️', ['bed', '床', 'rest']),
  s('chair', '椅子', 'building-home', '🪑', ['chair', '椅', '坐']),
  s('sofa', '沙发', 'building-home', '🛋️', ['sofa', '沙发', '放松']),
  s('bath', '浴室', 'building-home', '🛁', ['bath', '浴', '洗']),
  s('kitchen', '厨房', 'building-home', '🍳', ['kitchen', '厨', '烟火']),
  s('stairs', '楼梯', 'building-home', '🪜', ['stairs', '梯', '上下']),
  s('fence', '篱笆', 'building-home', '🏡', ['fence', '篱', '界']),

  /* ---------------------------- 建筑 · 公共 ------------------------------- */
  s('school', '学校', 'building-public', '🏫', ['school', '校', '学']),
  s('hospital', '医院', 'building-public', '🏥', ['hospital', '医院', '救']),
  s('office', '办公楼', 'building-public', '🏢', ['office', '写字楼', '班']),
  s('factory', '工厂', 'building-public', '🏭', ['factory', '厂', '产']),
  s('bank', '银行', 'building-public', '🏦', ['bank', '钱', '存']),
  s('hotel', '旅馆', 'building-public', '🏨', ['hotel', '住', '暂']),
  s('station', '车站', 'building-public', '🚉', ['station', '站', '离']),
  s('bridge', '桥', 'building-public', '🌉', ['bridge', '桥', '连']),
  s('library', '图书馆', 'building-public', '📚', ['library', '书', '藏']),
  s('playground', '操场', 'building-public', '🏟️', ['playground', '操场', '跑']),
  s('tower', '塔', 'building-public', '🗼', ['tower', '塔', '高']),
  s('wall', '墙', 'building-public', '🧱', ['wall', '墙', '隔']),

  /* ---------------------------- 建筑 · 宗教 ------------------------------- */
  s('church', '教堂', 'building-religious', '⛪', ['church', '教', '仰']),
  s('temple', '寺庙', 'building-religious', '🛕', ['temple', '庙', '拜']),
  s('mosque', '清真寺', 'building-religious', '🕌', ['mosque', '礼']),
  s('shrine', '神龛', 'building-religious', '⛩️', ['shrine', '神', '敬']),
  s('altar', '祭坛', 'building-religious', '🕯️', ['altar', '祭', '念']),
  s('grave', '坟墓', 'building-religious', '🪦', ['grave', '墓', '失']),

  /* ---------------------------- 建筑 · 废墟 ------------------------------- */
  s('ruin', '废墟', 'building-ruin', '🏚️', ['ruin', '废', '毁']),
  s('broken-wall', '断墙', 'building-ruin', '🧱', ['broken wall', '断', '残']),
  s('abandoned-house', '空屋', 'building-ruin', '🏚️', ['empty house', '空', '无人']),
  s('labyrinth', '迷宫', 'building-ruin', '🌀', ['maze', '迷', '困']),
  s('pit', '深坑', 'building-ruin', '🕳️', ['pit', '坑', 'fall']),

  /* ---------------------------- 物件 · 日常 ------------------------------- */
  s('mirror', '镜子', 'object-daily', '🪞', ['mirror', '镜', '看自己']),
  s('clock', '钟表', 'object-daily', '⏰', ['clock', '钟', '时间']),
  s('phone', '手机', 'object-daily', '📱', ['phone', '手机', '联系']),
  s('letter', '信', 'object-daily', '✉️', ['letter', '信', '话']),
  s('book', '书', 'object-daily', '📖', ['book', '书', '记']),
  s('photo', '照片', 'object-daily', '🖼️', ['photo', '照片', '旧']),
  s('lamp', '灯', 'object-daily', '🕯️', ['lamp', '灯', '亮']),
  s('umbrella', '伞', 'object-daily', '☂️', ['umbrella', '伞', '遮']),
  s('glasses', '眼镜', 'object-daily', '👓', ['glasses', '眼镜', '看']),
  s('cup', '杯子', 'object-daily', '🥛', ['cup', '杯', '满']),
  s('basket', '篮子', 'object-daily', '🧺', ['basket', '篮', '装']),

  /* ---------------------------- 物件 · 工具 ------------------------------- */
  s('key', '钥匙', 'object-tool', '🔑', ['key', '钥匙', '开']),
  s('lock', '锁', 'object-tool', '🔒', ['lock', '锁', '关']),
  s('rope', '绳子', 'object-tool', '🪢', ['rope', '绳', '绑']),
  s('knife', '刀', 'object-tool', '🔪', ['knife', '刀', '切']),
  s('hammer', '锤子', 'object-tool', '🔨', ['hammer', '锤', '砸']),
  s('scissors', '剪刀', 'object-tool', '✂️', ['scissors', '剪', '断']),
  s('shovel', '铲子', 'object-tool', '🪏', ['shovel', '铲', '挖']),
  s('net', '网', 'object-tool', '🕸️', ['net', '网', '困']),
  s('map', '地图', 'object-tool', '🗺️', ['map', '地图', '路']),
  s('compass', '指南针', 'object-tool', '🧭', ['compass', '罗盘', '方向']),
  s('bandage', '绷带', 'object-tool', '🩹', ['bandage', '绷带', '伤']),
  s('pill', '药', 'object-tool', '💊', ['pill', '药', '治']),

  /* ---------------------------- 物件 · 食物 ------------------------------- */
  s('bread', '面包', 'object-food', '🍞', ['bread', '面包', '饱']),
  s('apple', '苹果', 'object-food', '🍎', ['apple', '苹果', '果']),
  s('cake', '蛋糕', 'object-food', '🍰', ['cake', '蛋糕', '庆']),
  s('tea', '茶', 'object-food', '🍵', ['tea', '茶', '静']),
  s('wine', '酒', 'object-food', '🍷', ['wine', '酒', '麻']),
  s('candy', '糖', 'object-food', '🍬', ['candy', '糖', '甜']),
  s('rice', '饭', 'object-food', '🍚', ['rice', '饭', '常']),

  /* ---------------------------- 物件 · 交通 ------------------------------- */
  s('car', '汽车', 'object-vehicle', '🚗', ['car', '车', '行']),
  s('bus', '公交车', 'object-vehicle', '🚌', ['bus', '公交', '众']),
  s('train', '火车', 'object-vehicle', '🚂', ['train', '火车', '远']),
  s('airplane', '飞机', 'object-vehicle', '✈️', ['airplane', '飞', '离']),
  s('boat', '小船', 'object-vehicle', '⛵', ['boat', '船', '漂']),
  s('bike', '自行车', 'object-vehicle', '🚲', ['bike', '自行车', '自']),
  s('ship', '轮船', 'object-vehicle', '🚢', ['ship', '船', '大']),
  s('rocket', '火箭', 'object-vehicle', '🚀', ['rocket', '火箭', '冲']),

  /* ---------------------------- 物件 · 宝物 ------------------------------- */
  s('gift', '礼物', 'object-treasure', '🎁', ['gift', '礼', '给']),
  s('box', '箱子', 'object-treasure', '📦', ['box', '箱', '藏']),
  s('treasure', '宝藏', 'object-treasure', '💎', ['treasure', '宝', '贵']),
  s('crown', '王冠', 'object-treasure', '👑', ['crown', '王', '权']),
  s('ring', '戒指', 'object-treasure', '💍', ['ring', '戒', '约']),
  s('coin', '硬币', 'object-treasure', '🪙', ['coin', '钱', '值']),
  s('teddy', '玩偶', 'object-treasure', '🧸', ['teddy', '玩偶', '安']),

  /* ---------------------------- 抽象 · 符号 ------------------------------- */
  s('heart', '心', 'abstract-symbol', '❤️', ['heart', '心', '爱']),
  s('broken-heart', '心碎', 'abstract-symbol', '💔', ['broken heart', '碎', '痛']),
  s('question', '问号', 'abstract-symbol', '❓', ['question', '问', '不懂']),
  s('exclamation', '感叹号', 'abstract-symbol', '❗', ['exclamation', '惊', '急']),
  s('infinity', '无限', 'abstract-symbol', '♾️', ['infinity', '无限', '永']),
  s('knot', '结', 'abstract-symbol', '➰', ['knot', '结', '缠']),
  s('arrow', '箭头', 'abstract-symbol', '➡️', ['arrow', '方向', '去']),
  s('circle', '圆', 'abstract-symbol', '◯', ['circle', '圆', '全']),
  s('square', '方', 'abstract-symbol', '▢', ['square', '方', '界']),
  s('cross', '十字', 'abstract-symbol', '✝️', ['cross', '十字', '重']),
  s('spiral', '螺旋', 'abstract-symbol', '🌀', ['spiral', '旋', '绕']),
  s('void', '空', 'abstract-symbol', '◯', ['void', '空', '无']),
  s('bubble', '气泡', 'abstract-symbol', '🫧', ['bubble', '泡', '易碎']),
  s('gap', '门缝', 'abstract-symbol', '▮', ['gap', '缝', '隙']),

  /* ---------------------------- 抽象 · 元素 ------------------------------- */
  s('light', '光', 'abstract-element', '✨', ['light', '光', '亮']),
  s('shadow', '影子', 'abstract-element', '🌑', ['shadow', '影', '暗']),
  s('fire', '火', 'abstract-element', '🔥', ['fire', '火', '燃']),
  s('wind', '风', 'abstract-element', '🌬️', ['wind', '风', '变']),
  s('darkness', '黑暗', 'abstract-element', '🌚', ['dark', '黑', '未知']),
  s('glow', '微光', 'abstract-element', '🔆', ['glow', '微光', 'hope']),
  s('dust', '尘', 'abstract-element', '🌫️', ['dust', '尘', '散']),
  s('snow', '雪', 'abstract-element', '❄️', ['snow', '雪', '静']),
  s('time', '时间', 'abstract-element', '⏳', ['time', '时间', '流']),
  s('chasm', '裂缝', 'abstract-element', '🕳️', ['chasm', '裂', '断']),
  s('thunder', '雷', 'abstract-element', '🌩️', ['thunder', '雷', '巨响']),
  s('smoke', '烟', 'abstract-element', '💨', ['smoke', '烟', '散']),
  s('steam', '雾汽', 'abstract-element', '♨️', ['steam', '汽', '温热']),
  s('echo', '回声', 'abstract-element', '🔊', ['echo', '回声', '余']),
  s('silence', '静默', 'abstract-element', '🔇', ['silence', '静', '无声']),
  s('weight', '重物', 'abstract-element', '⬛', ['weight', '重', '压']),
  s('thread', '细线', 'abstract-element', '🧵', ['thread', '线', '牵']),
  s('mirror-shard', '碎片', 'abstract-element', '🔷', ['shard', '碎片', '裂']),

  /* ------------------------- 补遗：更多自然与器物 ------------------------- */
  s('swamp', '沼泽', 'nature-land', '🪷', ['swamp', '沼泽', '陷']),
  s('glacier', '冰川', 'nature-land', '🏔️', ['glacier', '冰川', '慢']),
  s('forest', '森林', 'nature-land', '🌲', ['forest', '林', '密']),
  s('prairie', '草原', 'nature-land', '🌿', ['prairie', '草原', '阔']),
  s('rain-pool', '积水', 'nature-water', '💧', ['puddle', '积水', '停']),
  s('mud', '泥', 'nature-land', '🟤', ['mud', '泥', '软']),
  s('dawn', '黎明', 'nature-sky', '🌅', ['dawn', '黎明', '始']),
  s('dusk', '黄昏', 'nature-sky', '🌇', ['dusk', '黄昏', '将暗']),
  s('eclipse', '日食', 'nature-sky', '🌑', ['eclipse', '日食', '掩']),
  s('frost', '霜', 'nature-sky', '🌫️', ['frost', '霜', '冷']),
  s('violet', '紫罗兰', 'nature-plant', '🪻', ['violet', '花', '紫']),
  s('lotus', '莲花', 'nature-plant', '🪷', ['lotus', '莲', '出泥']),
  s('thorn', '荆棘', 'nature-plant', '🌵', ['thorn', '刺', '痛']),
  s('ivy', '藤蔓', 'nature-plant', '🌿', ['ivy', '藤', '缠']),
  s('stump', '树桩', 'nature-plant', '🪵', ['stump', '桩', '断']),
  s('fox-cub', '幼兽', 'animal-wild', '🦊', ['cub', '幼', '弱']),
  s('bird', '鸟', 'animal-wild', '🕊️', ['bird', '鸟', '自由']),
  s('crow', '乌鸦', 'animal-wild', '🐦‍⬛', ['crow', '鸦', '报']),
  s('flock', '鸟群', 'animal-wild', '🕊️', ['flock', '群飞', '散']),
  s('mule', '骡', 'animal-farm', '🐴', ['mule', '骡', '苦']),
  s('silkworm', '蚕', 'animal-insect', '🐛', ['silkworm', '蚕', '织']),
  s('moth', '飞蛾', 'animal-insect', '🦋', ['moth', '蛾', '扑']),
  s('clown', '小丑', 'person-role', '🤡', ['clown', '丑', '面具']),
  s('judge', '审判者', 'person-role', '🧑‍⚖️', ['judge', '审', '判']),
  s('guide', '引路人', 'person-role', '🧭', ['guide', '引路', '带']),
  s('listener', '倾听者', 'person-role', '👂', ['listener', '听', '陪']),
  s('guardian', '守护者', 'person-role', '🛡️', ['guardian', '守', '护']),
  s('outsider', '局外人', 'person-adult', '🧑‍🦯', ['outsider', '外', '隔']),
  s('twins', '双胞胎', 'person-family', '👯', ['twins', '双', '同']),
  s('orphan', '孤儿', 'person-child', '🧒', ['orphan', '孤', '独']),
  s('runaway', '出走的人', 'person-adult', '🏃', ['runaway', '逃', '离']),
  s('gate', '大门', 'building-home', '🚧', ['gate', '门', '关']),
  s('balcony', '阳台', 'building-home', '🏠', ['balcony', '台', '望']),
  s('attic', '阁楼', 'building-home', '🏠', ['attic', '顶', '藏']),
  s('basement', '地下室', 'building-home', '🏚️', ['basement', '地', '暗']),
  s('greenhouse', '温室', 'building-public', '🪴', ['greenhouse', '温室', '养']),
  s('prison', '监狱', 'building-public', '🔒', ['prison', '囚', '困']),
  s('theater', '剧场', 'building-public', '🎭', ['theater', '剧场', '演']),
  s('museum', '博物馆', 'building-public', '🏛️', ['museum', '博物', '旧']),
  s('cemetery', '墓地', 'building-religious', '🪦', ['cemetery', '墓', '别']),
  s('well', '井', 'building-ruin', '🪣', ['well', '井', '深']),
  s('wreck', '残骸', 'building-ruin', '🚢', ['wreck', '残', '沉']),
  s('ashes', '灰烬', 'building-ruin', '🌫️', ['ashes', '灰', '余']),
  s('watch', '手表', 'object-daily', '⌚', ['watch', '表', '时']),
  s('diary', '日记', 'object-daily', '📓', ['diary', '日记', '写']),
  s('camera', '相机', 'object-daily', '📷', ['camera', '相机', '记']),
  s('ticket', '车票', 'object-daily', '🎫', ['ticket', '票', '去']),
  s('envelope-open', '拆开的信', 'object-daily', '📨', ['open letter', '拆', '读']),
  s('blanket', '毯子', 'object-daily', '🛌', ['blanket', '毯', '暖']),
  s('pillow', '枕头', 'object-daily', '🛏️', ['pillow', '枕头', '睡']),
  s('paintbrush', '画笔', 'object-tool', '🖌️', ['brush', '画笔', '画']),
  s('torch', '火把', 'object-tool', '🔦', ['torch', '火把', '照']),
  s('ruler', '尺子', 'object-tool', '📏', ['ruler', '尺', '度']),
  s('syringe', '针', 'object-tool', '💉', ['syringe', '针', '刺']),
  s('soup', '汤', 'object-food', '🍲', ['soup', '汤', '暖']),
  s('fruit', '水果', 'object-food', '🍇', ['fruit', '果', '鲜']),
  s('empty-bowl', '空碗', 'object-food', '🥣', ['empty bowl', '空', '缺']),
  s('subway', '地铁', 'object-vehicle', '🚇', ['subway', '地铁', '地下']),
  s('wheel', '车轮', 'object-vehicle', '🛞', ['wheel', '轮', '转']),
  s('ladder', '梯子', 'object-tool', '🪜', ['ladder', '梯', '上']),
  s('anchor', '锚', 'object-treasure', '⚓', ['anchor', '锚', '定']),
  s('bell', '铃', 'object-treasure', '🔔', ['bell', '铃', '醒']),
  s('mask', '面具', 'object-treasure', '🎭', ['mask', '面具', '遮']),
  s('shield', '盾', 'object-treasure', '🛡️', ['shield', '盾', '挡']),
  s('puzzle', '拼图', 'object-treasure', '🧩', ['puzzle', '拼图', '缺块']),
  s('dice', '骰子', 'object-treasure', '🎲', ['dice', '骰', '偶然']),
  s('music-box', '八音盒', 'object-treasure', '🎵', ['music', '音乐', '旧']),
  s('flag', '旗', 'abstract-symbol', '🚩', ['flag', '旗', '标']),
  s('eye', '眼', 'abstract-symbol', '👁️', ['eye', '眼', '被看']),
  s('mouth', '嘴', 'abstract-symbol', '👄', ['mouth', '嘴', '说']),
  s('hand', '手', 'abstract-symbol', '🤲', ['hand', '手', 'give']),
  s('footprint', '脚印', 'abstract-symbol', '👣', ['footprint', '足迹', '走过']),
  s('door-crack', '门缝的光', 'abstract-symbol', '💡', ['crack', '缝', '希望']),
  s('scale-sign', '天平', 'abstract-symbol', '⚖️', ['balance', '天平', '衡']),
  s('hourglass-empty', '流尽的沙', 'abstract-symbol', '⌛', ['hourglass', '沙漏', '尽']),
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

/** 条目总数（用于 UI 展示与验收断言） */
export const SYMBOL_COUNT = SYMBOLS.length;
/** 子类总数 */
export const SUBCATEGORY_COUNT = Object.keys(subcategoryLabels).length;

/** 按大类分组 */
export function symbolsByCategory(): Array<{
  category: SymbolCategory;
  label: string;
  items: SandboxSymbol[];
}> {
  return categoryOrder.map((category) => ({
    category,
    label: categoryLabels[category],
    items: SYMBOLS.filter((symbol) => symbol.category === category),
  }));
}

/** 按大类下的子类分组 */
export function symbolsBySubcategory(category: SymbolCategory): Array<{
  subcategory: SymbolSubcategory;
  label: string;
  items: SandboxSymbol[];
}> {
  const seen = new Set<SymbolSubcategory>();
  const groups: Array<{ subcategory: SymbolSubcategory; label: string; items: SandboxSymbol[] }> = [];
  for (const symbol of SYMBOLS) {
    if (symbol.category !== category || seen.has(symbol.subcategory)) continue;
    seen.add(symbol.subcategory);
    groups.push({
      subcategory: symbol.subcategory,
      label: subcategoryLabels[symbol.subcategory],
      items: SYMBOLS.filter((s2) => s2.subcategory === symbol.subcategory),
    });
  }
  return groups;
}

/**
 * 检索：匹配中英文标签与关键词。
 * 空查询返回全部；匹配为空时返回空数组（调用方负责展示"没有找到"）。
 */
export function searchSymbols(query: string, limit = 120): SandboxSymbol[] {
  const q = query.trim().toLowerCase();
  if (!q) return SYMBOLS.slice(0, limit);
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ symbol: SandboxSymbol; score: number }> = [];

  for (const symbol of SYMBOLS) {
    const haystack = [
      symbol.label,
      symbol.labelEn ?? '',
      symbol.id,
      symbol.subcategory,
      subcategoryLabels[symbol.subcategory],
      ...(symbol.tags ?? []),
    ]
      .join(' ')
      .toLowerCase();

    let score = 0;
    for (const token of tokens) {
      if (symbol.label === token || symbol.id === token) score += 100;
      else if (symbol.label.startsWith(token)) score += 60;
      else if (haystack.includes(token)) score += 20;
    }
    if (score > 0) scored.push({ symbol, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.symbol);
}

/* -------------------------------------------------------------------------- */
/*                              自我探索引导语                                 */
/* -------------------------------------------------------------------------- */

/**
 * 引导语按临床时序分三层（VISION.md §5.3）：
 * 开始前 / 摆放中 / 结束后。全部开放式，不解释、不评判、不给建议。
 */
export type PromptStage = 'before' | 'during' | 'after';

export const PROMPT_GROUPS: Record<PromptStage, string[]> = {
  before: [
    '先不用想清楚要摆什么。看看这些沙具，哪个最先吸引你？',
    '你可以用手碰碰沙。怎么弄都行，没有对错。',
    '如果是最后一次摆沙盘，你会摆什么？',
    '今天来的时候，身体哪个部位最先有感觉？',
    '不用急，先坐一会儿再开始。',
  ],
  during: [
    '这个摆件离你最近，它代表什么？',
    '哪个摆件离你最远？为什么把它放那么远？',
    '如果能在沙盘里再加一样东西，你会加什么？',
    '如果这些摆件会说话，最沉默的那个会说什么？',
    '有哪个摆件是你想拿掉，却还留着的？',
    '把"你"放在这里的那一刻，你在想什么？',
    '画面里有没有一个位置，是让你觉得安全一点的？',
    '你给它写了注释吗？那句话是对谁说的？',
    '沙子这一块被你推高了，那里原本是什么？',
    '有没有哪一处，你不想让人看到？',
  ],
  after: [
    '如果这个沙盘有一个标题，你会叫它什么？',
    '现在再看一遍，哪里让你想再看一眼？',
    '如果这个画面是一周后的样子，哪里会变？',
    '你愿意为它写一句话留给自己吗？',
    '摆完之后，身体的感觉和刚才比有什么不同？',
    '如果它有一个声音，是大声的还是轻的？',
    '有哪个部分，你希望有人问起？',
    '这次摆的过程里，有没有一个瞬间你想停下来？',
  ],
};

/** 兼容 v1：保留旧常量名（= 摆放中那一组） */
export const EXPLORATION_PROMPTS: string[] = PROMPT_GROUPS.during;

/** 两数的最大公约数（用于挑选与词库长度互质的步长） */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * 取 n 个提示，基于种子保证同一次渲染内稳定。
 *
 * ── 这里修过一个真实 bug ────────────────────────────────────────
 *
 * 原公式是 `(seed * 7 + i * 3 + i) % total`，注意 `i * 3 + i` 就是 `i * 4`。
 * `after` 组有 8 条，而 4 与 8 不互质 —— 于是 i=0 和 i=2 取到同一个下标：
 *
 *     seed 0 → 下标 [0, 4, 0] → 去重后只剩 **2 条**
 *
 * 结果是「结束后」这一档点「换一批」永远只有 2 句话，而不是 3 句。
 * 因为数组长度不是 0、页面也不报错，任何门禁都看不出问题 ——
 * 它是被「三个阶段都能取到 3 条」这条断言抓到的。
 *
 * 修法：步长取与 total **互质**的数。若步长与 total 互质，
 * 则 i ↦ (偏移 + i*步长) mod total 在 i < total 时必然两两不同，
 * 去重以后再也不会丢条目。total 变化时自动重算，不写死。
 */
export function pickPrompts(seed: number, count = 3, stage: PromptStage = 'during'): string[] {
  const pool = PROMPT_GROUPS[stage];
  const total = pool.length;
  if (total === 0 || count <= 0) return [];

  // 从 3 开始找一个与 total 互质的步长（3 对多数长度都互质）
  let step = 3;
  while (step < total && gcd(step, total) !== 1) step += 1;
  if (gcd(step, total) !== 1) step = 1; // total <= 2 时退回顺序取

  const start = Math.abs(Math.trunc(seed)) * 7;
  const picked: string[] = [];
  for (let i = 0; i < count && i < total; i += 1) {
    picked.push(pool[(start + i * step) % total] as string);
  }
  return [...new Set(picked)];
}

/** 按阶段取一组提示（UI 默认用法） */
export function promptsForStage(stage: PromptStage, seed: number, count = 3): string[] {
  return pickPrompts(seed, count, stage);
}

/* -------------------------------------------------------------------------- */
/*                                情绪标签（可选）                              */
/* -------------------------------------------------------------------------- */

/**
 * 摆件可打的感受标签。**只用于整理与回看，不做任何分析**。
 * 词表保持中性、覆盖正负与身体感受三类。
 */
export const AFFECT_LABELS = [
  '害怕',
  '愤怒',
  '难过',
  '孤独',
  '温暖',
  '安全',
  '沉重',
  '轻盈',
  '紧',
  '麻',
  '想靠近',
  '想远离',
  '说不清',
] as const;

export type AffectLabel = (typeof AFFECT_LABELS)[number];
