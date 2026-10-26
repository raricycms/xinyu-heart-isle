/**
 * 心屿 · 记录单事实模型
 *
 * 这一层的存在理由只有一条：**把"记录单里能出现什么"变成可测试的纯数据**。
 *
 * 记录单是唯一会离开这台设备（打印成 PDF、发给来访者）的东西，
 * 因此红线是硬的（CONTRACT §5.1 / §5.6）：
 * - 只允许出现：时间、场景、模式、摆件清单（含坐标）、写下的文字、批注、沙面统计、免责声明；
 * - 不允许出现：任何解读、评价、诊断、趋势判断、建议。
 *
 * 做法：页面不直接拼接文案，而是先 `buildSessionReport()` 得到一个结构化模型，
 * 再由页面渲染 / `reportToMarkdown()` 序列化。这样单测可以逐字段断言
 * "模型里没有任何非事实字段"，而页面改动不会悄悄绕过检查。
 */

import type { SandSession, SandSurface } from '@/lib/types';
import { computeSessionStats } from '@/sandbox/replay/stats';
import type { SessionStatsData } from '@/sandbox/replay/stats';
import { symbolGlyph, symbolLabel } from '@/sandbox/symbols';
import { getScene } from '@/sandbox/scenes';

/** 免责声明（唯一允许出现在记录单里的"表达立场"的句子，且是否定式） */
export const REPORT_DISCLAIMER =
  '本记录仅为过程事实（时间、数量、位置、写下的文字），不含解释与诊断，也不构成治疗建议。' +
  '沙盘内容的意义由摆放者本人决定。';

/** 记录单里的模式文案（只描述使用场景，不描述心理状态） */
export const REPORT_MODE_LABEL: Record<SandSession['mode'], string> = {
  self: '自己摆',
  counselor: '咨询中使用',
  supervision: '督导复盘',
};

/** 记录单里的"是否封盘"文案 */
export function lockLabel(session: SandSession): string {
  return session.locked ? '已封盘' : '未封盘';
}

/**
 * 记录单**禁止**出现的措辞片段。
 *
 * 单测直接拿这个表去扫生成的模型与 Markdown，任何一条命中即失败。
 * 注意：这里刻意不包含「诊断」——免责声明里必须出现「不含解释与诊断」。
 */
export const INTERPRETATION_PATTERNS = [
  '意味着',
  '说明你',
  '表明你',
  '代表你',
  '显示出你',
  '倾向于',
  '你感到',
  '焦虑水平',
  '抑郁水平',
  '症状',
  '障碍',
  '阳性',
  '阴性',
  '评估为',
  '提示你',
  '建议你',
  '需要关注',
  '值得注意',
  '问题在于',
  '心理状态',
  '治愈',
  '好转',
  '恶化',
] as const;

/** 一个摆件的客观行 */
export interface ReportItemRow {
  /** 展示序号（1 起，按层级排序后的顺序） */
  index: number;
  itemId: string;
  symbolId: string;
  /** 沙具名（来自沙具库） */
  label: string;
  /** 沙具字形（打印时作视觉锚点，无含义） */
  glyph: string;
  /** 归一化坐标 0~1（保留两位小数，便于阅读） */
  x: number;
  y: number;
  /** 层级 */
  z: number;
  scale: number;
  rotation: number;
  /** 埋深 0~1，未记录时为 undefined */
  burial?: number;
  /** 用户自己写的注释（原文） */
  note?: string;
  /** 用户自己打的感受标签（原文） */
  affectLabels?: string[];
}

/** 一条批注 */
export interface ReportAnnotationRow {
  id: string;
  /** 第几步（1 起） */
  step: number;
  /** 相对会话开始的毫秒数 */
  t: number;
  text: string;
  author?: 'self' | 'counselor';
}

/** 沙面统计（全部为可直接测得的量） */
export interface ReportSurfaceFacts {
  /** 是否记录了沙面数据 */
  recorded: boolean;
  /** 网格列数 */
  cols?: number;
  /** 网格行数 */
  rows?: number;
  /** 被改动过的格子比例 0~1 */
  movedRatio: number;
  /** 湿润比例 0~1 */
  wetRatio: number;
  /** 喷水次数 */
  waterAdded?: number;
  /** 全局湿度档 */
  state?: 'dry' | 'wet';
}

/** 时间统计（客观） */
export interface ReportTimeFacts {
  /** 会话开始时间（ISO） */
  startedAt: string;
  /** 结束时间（ISO，可缺） */
  endedAt?: string;
  /** 从第一条到最后一条事件的毫秒数 */
  durationMs: number;
  /** 第一件摆件出现的毫秒时刻，没有摆件时为 null */
  firstItemAt: number | null;
  /** 最后一次动作的毫秒时刻 */
  lastActionAt: number | null;
  /** 相邻动作之间的最长间隔（毫秒） */
  longestPauseMs: number;
}

/** 记录单完整事实模型 */
export interface SessionReportModel {
  /** 会话 id（仅本机，不出现在打印件以外的用途） */
  sessionId: string;
  title: string;
  /** 档案化名（若已绑定） */
  clientAlias?: string;
  /** 第几次会谈（若记录） */
  sessionNo?: number;
  sceneId: string;
  sceneLabel: string;
  mode: SandSession['mode'];
  modeLabel: string;
  locked: boolean;
  lockedLabel: string;
  archived: boolean;
  time: ReportTimeFacts;
  items: ReportItemRow[];
  itemCount: number;
  eventCount: number;
  /** 用户写下的文字（原文，未编辑） */
  reflection: string | null;
  annotations: ReportAnnotationRow[];
  surface: ReportSurfaceFacts;
  /** 用过的沙具次数（按次数倒序，纯计数） */
  symbolCounts: Array<{ symbolId: string; label: string; glyph: string; count: number }>;
  /** 九宫格分布（纯计数） */
  zones: Array<{ zone: string; label: string; count: number }>;
  /** 免责声明 */
  disclaimer: string;
  /** 生成时刻 */
  generatedAt: string;
}

const ZONE_LABEL_TEXT: Record<string, string> = {
  tl: '左上',
  tc: '上中',
  tr: '右上',
  ml: '左中',
  mc: '中间',
  mr: '右中',
  bl: '左下',
  bc: '下中',
  br: '右下',
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function surfaceFacts(session: SandSession, stats: SessionStatsData): ReportSurfaceFacts {
  const surface: SandSurface | undefined = session.surface;
  const facts: ReportSurfaceFacts = {
    recorded: Boolean(surface),
    movedRatio: round2(stats.surfaceMovedRatio * 100) / 100,
    wetRatio: round2(stats.wetRatio * 100) / 100,
  };
  if (surface) {
    facts.cols = surface.cols;
    facts.rows = surface.rows;
    if (surface.waterAdded !== undefined) facts.waterAdded = surface.waterAdded;
    if (surface.state) facts.state = surface.state;
  }
  return facts;
}

/**
 * 生成记录单事实模型。
 *
 * 不传 `stats` 时会现场计算一次（纯函数，可重复调用）。
 * 注意 `items` 按 `z` 升序（与画布堆叠顺序一致），序号也是按这个顺序给的。
 */
export function buildSessionReport(
  session: SandSession,
  stats: SessionStatsData = computeSessionStats(session),
  generatedAt = new Date().toISOString(),
): SessionReportModel {
  const scene = getScene(session.sceneId);
  const items: ReportItemRow[] = [...session.items]
    .sort((a, b) => a.z - b.z || a.id.localeCompare(b.id))
    .map((item, index) => {
      const row: ReportItemRow = {
        index: index + 1,
        itemId: item.id,
        symbolId: item.symbolId,
        label: symbolLabel(item.symbolId),
        glyph: symbolGlyph(item.symbolId),
        x: round2(item.x),
        y: round2(item.y),
        z: item.z,
        scale: round2(item.scale),
        rotation: Math.round(item.rotation * 10) / 10,
      };
      if (item.burial !== undefined) row.burial = round2(item.burial);
      if (item.note) row.note = item.note;
      if (item.affectLabels?.length) row.affectLabels = [...item.affectLabels];
      return row;
    });

  const annotations: ReportAnnotationRow[] = (session.annotations ?? []).map((annotation) => {
    const row: ReportAnnotationRow = {
      id: annotation.id,
      step: annotation.eventIndex + 1,
      t: annotation.t,
      text: annotation.text,
    };
    if (annotation.author) row.author = annotation.author;
    return row;
  });

  const model: SessionReportModel = {
    sessionId: session.id,
    title: session.title,
    sceneId: session.sceneId,
    sceneLabel: scene.label,
    mode: session.mode,
    modeLabel: REPORT_MODE_LABEL[session.mode],
    locked: session.locked,
    lockedLabel: lockLabel(session),
    archived: session.archived === true,
    time: {
      startedAt: session.meta?.startedAt ?? session.at,
      endedAt: session.endedAt ?? session.meta?.endedAt,
      durationMs: stats.durationMs,
      firstItemAt: stats.firstItemAt,
      lastActionAt: stats.lastActionAt,
      longestPauseMs: stats.longestPauseMs,
    },
    items,
    itemCount: stats.itemCount,
    eventCount: stats.eventCount,
    reflection: session.reflection?.trim() ? session.reflection : null,
    annotations,
    surface: surfaceFacts(session, stats),
    symbolCounts: stats.symbolCounts.map((entry) => ({
      symbolId: entry.symbolId,
      label: entry.label,
      glyph: entry.glyph,
      count: entry.count,
    })),
    zones: stats.zones.map((cell) => ({
      zone: cell.zone,
      label: ZONE_LABEL_TEXT[cell.zone] ?? cell.zone,
      count: cell.count,
    })),
    disclaimer: REPORT_DISCLAIMER,
    generatedAt,
  };

  if (session.meta?.alias) model.clientAlias = session.meta.alias;
  if (session.meta?.sessionNo !== undefined) model.sessionNo = session.meta.sessionNo;

  return model;
}

/* -------------------------------------------------------------------------- */
/*                                 Markdown                                   */
/* -------------------------------------------------------------------------- */

/** 毫秒 -> `M分S秒`（客观，无评价） */
export function formatSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

/**
 * 事实模型 -> Markdown（供「导出 Markdown」与人工核对使用）。
 * 生成的文件带 BOM 由 `download.ts` 负责，这里只产出纯文本。
 */
export function reportToMarkdown(model: SessionReportModel): string {
  const lines: string[] = [];
  lines.push(`# ${model.title}`);
  lines.push('');
  lines.push('心屿 · 赛博沙盘记录单');
  lines.push('');

  lines.push('## 基本信息');
  lines.push('');
  lines.push(`- 开始时间：${model.time.startedAt}`);
  if (model.time.endedAt) lines.push(`- 结束时间：${model.time.endedAt}`);
  if (model.clientAlias) lines.push(`- 档案化名：${model.clientAlias}`);
  if (model.sessionNo !== undefined) lines.push(`- 第几次会谈：${model.sessionNo}`);
  lines.push(`- 场景：${model.sceneLabel}`);
  lines.push(`- 模式：${model.modeLabel}`);
  lines.push(`- 状态：${model.lockedLabel}`);
  lines.push(`- 摆件数：${model.itemCount}`);
  lines.push(`- 操作次数：${model.eventCount}`);
  lines.push(`- 过程时长：${formatSpan(model.time.durationMs)}`);
  lines.push('');

  lines.push('## 摆件清单');
  lines.push('');
  if (model.items.length === 0) {
    lines.push('无摆件。');
  } else {
    lines.push('| # | 沙具 | 坐标 x | 坐标 y | 层级 | 缩放 | 旋转 | 注释 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const item of model.items) {
      lines.push(
        `| ${item.index} | ${item.label} | ${item.x.toFixed(2)} | ${item.y.toFixed(2)} | ${item.z} | ` +
          `${item.scale.toFixed(2)} | ${item.rotation} | ${item.note ?? ''} |`,
      );
    }
  }
  lines.push('');

  lines.push('## 沙面统计');
  lines.push('');
  if (!model.surface.recorded) {
    lines.push('这次没有保存沙面数据。');
  } else {
    lines.push(`- 网格：${model.surface.cols ?? '?'} × ${model.surface.rows ?? '?'}`);
    lines.push(`- 沙面改动比例：${Math.round(model.surface.movedRatio * 100)}%`);
    lines.push(`- 湿润比例：${Math.round(model.surface.wetRatio * 100)}%`);
    if (model.surface.waterAdded !== undefined) {
      lines.push(`- 喷水次数：${model.surface.waterAdded}`);
    }
    if (model.surface.state) {
      lines.push(`- 湿度档：${model.surface.state === 'wet' ? '湿沙' : '干沙'}`);
    }
  }
  lines.push('');

  lines.push('## 写下的文字');
  lines.push('');
  lines.push(model.reflection ?? '（这次没有写下文字。）');
  lines.push('');

  lines.push('## 批注');
  lines.push('');
  if (model.annotations.length === 0) {
    lines.push('（没有批注。）');
  } else {
    for (const annotation of model.annotations) {
      const who =
        annotation.author === 'counselor' ? '咨询师' : annotation.author === 'self' ? '本人' : '';
      lines.push(`- 第 ${annotation.step} 步${who ? `（${who}）` : ''}：${annotation.text}`);
    }
  }
  lines.push('');

  lines.push('## 九宫格分布');
  lines.push('');
  lines.push(model.zones.map((zone) => `${zone.label} ${zone.count}`).join(' · '));
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(model.disclaimer);
  lines.push('');
  lines.push(`生成时间：${model.generatedAt} · 数据来源：本机浏览器存储`);
  lines.push('');
  return lines.join('\n');
}
