/**
 * 心屿 —— 全局领域类型。
 *
 * 设计原则：
 * 1. 所有用户数据都存于浏览器 localStorage，字段必须可 JSON 序列化。
 * 2. 每条记录都有 `id` 与 `at`（ISO 时间字符串），便于「我的记录」按时间线聚合。
 * 3. 量表只做「自我了解」用途，结果分级用 levelId 引用量表定义，避免结果里塞死文案。
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
/*                                  赛博沙盘                                   */
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
}

/** 沙盘快照 */
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

export interface Preferences {
  /** 是否已确认过首次进入的免责声明 */
  acknowledgedDisclaimer: boolean;
  /** 是否开启减少动效 */
  reducedMotion: boolean;
  /** 首页展示的昵称，可选 */
  nickname?: string;
}
