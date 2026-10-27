/**
 * 心屿 —— 全局领域类型。
 *
 * 设计原则：
 * 1. 所有用户数据都存于浏览器本地（localStorage / IndexedDB），字段必须可 JSON 序列化。
 * 2. 每条记录都有 `id` 与 `at`（ISO 时间字符串），便于「我的记录」按时间线聚合。
 * 3. 量表只做「自我了解」用途，结果分级用 levelId 引用量表定义，避免结果里塞死文案。
 * 4. v2 起沙盘使用 `SandSession`（会话 + 事件流）作为唯一事实来源；
 *    旧的 `SandboxSnapshot` 保留为**只读兼容类型**，由迁移函数升级为 `SandSession`。
 *
 * 契约见 docs/CONTRACT.md；愿景见 docs/VISION.md §6（数据模型演进）。
 */

/** ISO 8601 时间字符串，例如 2026-10-26T12:46:05.000Z */
export type ISODate = string;

/** 通用记录基类 */
export interface BaseRecord {
  id: string;
  /** 创建时间 */
  at: ISODate;
}

/* -------------------------------------------------------------------------- */
/*                                    心情                                     */
/* -------------------------------------------------------------------------- */

/** 情绪签到：每天可以打多次，用于首页「今天怎么样」与趋势图 */
export interface MoodEntry extends BaseRecord {
  /** 心情 1（很低落）~ 5（很不错） */
  mood: 1 | 2 | 3 | 4 | 5;
  /** 精力 1（耗尽）~ 5（充沛） */
  energy: 1 | 2 | 3 | 4 | 5;
  /** 情绪标签，例如「焦虑」「平静」「疲惫」 */
  tags: string[];
  /** 可选备注 */
  note?: string;
}

/* -------------------------------------------------------------------------- */
/*                                    量表                                     */
/* -------------------------------------------------------------------------- */

export type ScaleCategory = '情绪' | '压力' | '睡眠' | '自我' | '关系';

/** 量表作答选项（所有题目共用同一套选项文本与分值） */
export interface ScaleOption {
  label: string;
  value: number;
}

export interface ScaleQuestion {
  id: string;
  text: string;
  /**
   * 反向计分题：分值按 (min + max - value) 折算，
   * 其中 min / max 为选项分值的最小值与最大值。
   */
  reverse?: boolean;
}

/** 量表维度（可选，例如 PSQI 的多个成分） */
export interface ScaleDimension {
  id: string;
  label: string;
  questionIds: string[];
  /** 维度描述，解释这个维度在测什么 */
  hint?: string;
}

/** 结果分级的语义色调，决定 UI 颜色，不承载诊断含义 */
export type LevelTone = 'good' | 'watch' | 'warn' | 'alert';

export interface ScaleLevel {
  id: string;
  min: number;
  max: number;
  label: string;
  tone: LevelTone;
  /** 一句话解释这个分数区间通常意味着什么 */
  summary: string;
  /** 可执行的自我照顾建议 */
  suggestions: string[];
}

export interface Scale {
  id: string;
  /** 全称，例如「患者健康问卷-9」 */
  name: string;
  /** 简称，例如 PHQ-9 */
  shortName: string;
  category: ScaleCategory;
  /** 卡片上的一句话介绍 */
  description: string;
  /** 指导语 */
  instruction: string;
  /** 时间范围，例如「最近两周」 */
  timeframe: string;
  estimatedMinutes: number;
  /** 计分说明（展示给用户，说明分数如何计算、不代表诊断） */
  scoringNote: string;
  options: ScaleOption[];
  questions: ScaleQuestion[];
  dimensions?: ScaleDimension[];
  levels: ScaleLevel[];
  /** 版权 / 使用说明 */
  attribution?: string;
}

/** 一次量表作答记录 */
export interface ScaleResult extends BaseRecord {
  scaleId: string;
  /** questionId -> 选项原始分值（未做反向折算，便于回溯） */
  answers: Record<string, number>;
  /** 总分（已按反向题折算） */
  total: number;
  /** 维度得分（已按反向题折算） */
  dimensionScores?: Record<string, number>;
  /** 命中的分级 id */
  levelId: string;
}

/* -------------------------------------------------------------------------- */
/*                              沙盘 · 摆件与场景                              */
/* -------------------------------------------------------------------------- */

/** 沙盘中的一个摆件 */
export interface SandboxItem {
  id: string;
  /** 对应素材库中的 symbol id */
  symbolId: string;
  /** 归一化坐标 0~1，保证不同屏幕尺寸下布局一致 */
  x: number;
  y: number;
  /** 缩放 0.5 ~ 2 */
  scale: number;
  /** 旋转角度 -180 ~ 180 */
  rotation: number;
  /** 层级，越大越靠上 */
  z: number;
  /** 可选：用户给这个摆件写的注释 */
  note?: string;
  /** 可选：用户给这个摆件打的情绪/身体感受标签（仅自己可见，不做分析） */
  affectLabels?: string[];
  /** 可选：用户本地录音的 dataURL（仅存本地，不导出到分享文件） */
  audioNote?: string;
  /** 可选：用户本地导入的自定义图（dataURL，仅存本地） */
  imageData?: string;
  /**
   * v1.5+：埋进沙里的深度 0~1（0 = 完全露出，1 = 完全埋没）。
   * 由沙面高度与 z 共同决定视觉呈现，不参与解读。
   */
  burial?: number;
}

/** 沙盘快照（v1 数据模型，仅用于读取与迁移；新代码请用 SandSession） */
export interface SandboxSnapshot extends BaseRecord {
  title: string;
  items: SandboxItem[];
  /** 沙盘背景主题 id */
  sceneId: string;
  /** 用户对本次沙盘的自我解读 */
  reflection?: string;
  /** 生成的可选提示（自我探索问题） */
  prompts?: string[];
}

export type SceneId = 'beach' | 'meadow' | 'night' | 'room' | 'void';

/* -------------------------------------------------------------------------- */
/*                           沙盘 · 会话与事件（v2 核心）                       */
/* -------------------------------------------------------------------------- */

/** 会话模式：自助 / 咨询师协作 / 督导 */
export type SessionMode = 'self' | 'counselor' | 'supervision';

/** 临床流程阶段（手册六阶段模型的子集，产品只做「可适配」不做流程写死） */
export type SessionPhase = 'intro' | 'create' | 'reflect' | 'connect' | 'record' | 'dismantle';

/** 沙面湿度状态：干沙会流、湿沙可塑。仅用于表达，无诊断含义。 */
export type SandWetness = 'dry' | 'wet';

/**
 * v2 沙面高度场（L2）。
 *
 * - `cols × rows` 默认 128 × 96；
 * - `height` 为 RLE + Base64 编码的 Uint8 序列，0~255 映射 0~7cm；
 * - `wetness` 可选，编码方式同 `height`，仅在分区润湿时写入。
 *
 * 编解码见 `src/sandbox/surfaceCodec.ts`。
 */
export interface SandSurface {
  cols: number;
  rows: number;
  /** RLE/Base64 编码的高度图 */
  height: string;
  /** 可选：湿度分布，编码方式同上 */
  wetness?: string;
  /** 全局湿度档（工具层快速判断，不替代 wetness 分布） */
  state?: SandWetness;
  /** 已喷水次数（客观记录，不解读） */
  waterAdded?: number;
}

/** 沙面笔刷类型 */
export type SurfaceTool = 'raise' | 'dig' | 'smooth' | 'rake' | 'water' | 'flatten' | 'tunnel';

/** 事件类型清单（见 VISION.md §5.4 / §6.1） */
export type SandboxEventType =
  | 'item.add'
  | 'item.move'
  | 'item.scale'
  | 'item.rotate'
  | 'item.remove'
  | 'item.note'
  | 'item.affect'
  | 'item.layer'
  | 'item.bury'
  | 'scene.change'
  | 'surface.stroke'
  | 'surface.reset'
  | 'session.start'
  | 'session.phase'
  | 'session.lock'
  | 'session.save'
  | 'session.import'
  | 'annotation.add'
  | 'reflection.edit';

/** 一条过程事件；`t` 为相对会话开始的毫秒数 */
export interface SandboxEvent {
  /** 相对会话开始的毫秒数（单调递增） */
  t: number;
  type: SandboxEventType;
  /** 涉及单个摆件时给出 id */
  itemId?: string;
  /** 坐标/角度/笔刷路径等载荷，必须可 JSON 序列化 */
  payload?: Record<string, unknown>;
}

/** 会话标注（治疗师在时间轴上打点；v2.0 只做数据与展示，编辑在 v2.5 增强） */
export interface SessionAnnotation {
  id: string;
  /** 对应事件序号（0-based），-1 表示会话结尾 */
  eventIndex: number;
  t: number;
  text: string;
  author?: 'self' | 'counselor';
  at: ISODate;
}

/** 会话元信息：临床记录字段的非诊断子集（见 VISION.md §5.4） */
export interface SessionMeta {
  /** 化名/代号，不含真实身份 */
  alias?: string;
  /** 来访者化名 id（本地档案 id） */
  clientRef?: string;
  /** 咨询师代号（本地，不做账号） */
  therapistRef?: string;
  /** 第几次会谈 */
  sessionNo?: number;
  /** 当前阶段 */
  phase?: SessionPhase;
  /** 会话开始/结束时间 */
  startedAt?: ISODate;
  endedAt?: ISODate;
  /** 沙盘尺寸（cm），用于客观记录，不做分析 */
  trayW?: number;
  trayD?: number;
  trayH?: number;
  /** 是否已取得拍摄/导出同意 */
  consentPhoto?: boolean;
  /** 是否允许把过程数据（事件流）包含在导出中 */
  consentProcess?: boolean;
  /** 沙盘级的感受词（用户自选，只用于整理，不做分析） */
  sandboxAffects?: string[];
}

/** 沙盘会话（v2 唯一事实来源） */
export interface SandSession extends BaseRecord {
  schemaVersion: 2;
  /** 会话标题 */
  title: string;
  /** 结束时间（封盘或显式结束） */
  endedAt?: ISODate;
  mode: SessionMode;
  /** 当前场景主题 */
  sceneId: string;
  /** 当前摆件状态（必须等于事件重放结果） */
  items: SandboxItem[];
  /** 完整过程事件流 */
  events: SandboxEvent[];
  /** L2 沙面状态（v1 快照为 undefined） */
  surface?: SandSurface;
  /** 用户自述 */
  reflection?: string;
  /** 引导问题 */
  prompts?: string[];
  /** 是否已封盘（锁定后不可改，只能另存副本） */
  locked: boolean;
  /** 封盘/结束时间 */
  lockedAt?: ISODate;
  /** 元信息 */
  meta?: SessionMeta;
  /** 时间轴标注 */
  annotations?: SessionAnnotation[];
  /** 是否已归档（拆除阶段：归档而非删除） */
  archived?: boolean;
  /** 归档时间，用于保留期清理 */
  archivedAt?: ISODate;
  /** 缩略图（dataURL，IndexedDB 存原图；localStorage 只存会话本体） */
  thumbnail?: string;
}

/** 归档保留期（天）：0 表示永久保留 */
export type RetentionDays = 0 | 30 | 90 | 180;

/** 本地来访者档案（仅本机、化名、不做账号体系） */
export interface LocalClient extends BaseRecord {
  /** 化名/代号，例如「小林」「A2」 */
  alias: string;
  /** 备注（咨询师自己看） */
  note?: string;
  /** 归档（隐藏但保留） */
  archived?: boolean;
  /** 颜色标记，便于区分（不影响语义） */
  color?: string;
}

/* -------------------------------------------------------------------------- */
/*                                 情绪工具箱                                  */
/* -------------------------------------------------------------------------- */

export interface ToolSession extends BaseRecord {
  /** 工具 id，例如 breathing / grounding / thought-record */
  toolId: string;
  /** 本次练习时长（秒），非计时类工具可省略 */
  durationSec?: number;
  /** 工具自定义数据（例如呼吸轮次、思维记录内容） */
  payload?: Record<string, unknown>;
}

/** 三件好事 / 感恩日记 */
export interface JournalEntry extends BaseRecord {
  kind: 'gratitude' | 'thought-record' | 'free-write';
  title: string;
  content: string;
  /** 0~1，当天的整体心情，可选 */
  mood?: number;
}

/* -------------------------------------------------------------------------- */
/*                                  用户偏好                                   */
/* -------------------------------------------------------------------------- */

/** 渲染器选择：DOM 2D（兜底/无障碍）、Canvas 2.5D 轴测（默认）、3D（可选、懒加载） */
export type RendererKind = 'dom2d' | 'iso2d' | 'three';

export interface Preferences {
  /** 是否已确认过首次进入的免责声明 */
  acknowledgedDisclaimer: boolean;
  /** 是否开启减少动效 */
  reducedMotion: boolean;
  /** 是否已通过年龄门（未成年人需监护人同意） */
  acknowledgedAge?: boolean;
  /** 沙盘音效开关（沙声/落沙声） */
  soundEnabled?: boolean;
  /** 默认渲染器 */
  renderer?: RendererKind;
  /** 归档保留期（天） */
  retentionDays?: RetentionDays;
  /** 语言 */
  locale?: 'zh-CN' | 'en';
  /** 是否开启轮廓模式（色盲/对比度辅助） */
  outlineMode?: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                 沙具包（生态）                              */
/* -------------------------------------------------------------------------- */

/** 18 子类本体（见 VISION.md §5.2） */
export type SymbolSubcategory =
  | 'nature-land'
  | 'nature-water'
  | 'nature-sky'
  | 'nature-plant'
  | 'animal-wild'
  | 'animal-farm'
  | 'animal-water'
  | 'animal-insect'
  | 'person-adult'
  | 'person-child'
  | 'person-family'
  | 'person-role'
  | 'person-myth'
  | 'building-home'
  | 'building-public'
  | 'building-religious'
  | 'building-ruin'
  | 'object-daily'
  | 'object-tool'
  | 'object-food'
  | 'object-vehicle'
  | 'object-treasure'
  | 'abstract-symbol'
  | 'abstract-element';

/** 沙具（象征物）条目 */
export interface SandboxSymbolEntry {
  id: string;
  label: string;
  /** 英文名（i18n 用） */
  labelEn?: string;
  /** 大类（6 类，兼容 v1） */
  category: string;
  /** 子类（18+ 子类，v2 起用于检索） */
  subcategory: SymbolSubcategory;
  /** 渲染字符（emoji 或单字符） */
  glyph: string;
  /** 检索关键词（中英混排） */
  tags?: string[];
  /** 来源沙具包 id，内置包为 'core' */
  packId?: string;
  /** 资产授权标识，例如 'emoji' / 'CC0' */
  license?: string;
}

/** 沙具包 manifest（symbol-pack/v1） */
export interface SymbolPackManifest {
  format: 'symbol-pack/v1';
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  description?: string;
  homepage?: string;
  /** 该包提供的沙具 */
  symbols: SandboxSymbolEntry[];
}
