/**
 * 心屿 · 客观统计导出（Markdown）
 *
 * 导出内容与页面上看到的完全一致：只有数字、单位与表格。
 * **不写入任何解读、评价、建议或诊断。** 第一段固定是免责说明。
 *
 * 纯函数 `toStatsMarkdown(session)` 便于单测；`downloadStatsMarkdown` 只做
 * `Blob` + `URL.createObjectURL` 的浏览器动作，不做网络请求（CONTRACT §5.4）。
 */

import { formatDuration } from '@/lib/date';
import type { SandSession } from '@/lib/types';
import { computeSessionStats, ZONE_LABELS, type SessionStatsData } from '@/sandbox/replay/stats';
import { getScene } from '@/sandbox/scenes';

/** 固定的免责说明（与 `replay.statsDisclaimer` 一致的口径，导出文件不依赖 i18n） */
export const STATS_DISCLAIMER = '以下只是数字，不代表任何评价，也不是诊断。';

/** 把毫秒格式化为 `mm:ss` */
function mmss(ms: number | null): string {
  if (ms === null) return '—';
  return formatDuration(Math.max(0, ms) / 1000);
}

/** 转义 Markdown 表格单元格里的竖线与换行 */
function cell(value: string | number): string {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * 生成统计 Markdown 文本。
 *
 * 结构（纯事实）：
 * 1. 免责说明
 * 2. 会话元信息（标题、时间、场景、模式、是否封盘）
 * 3. 数量与时长
 * 4. 时间分布
 * 5. 沙面
 * 6. 九宫格分布
 * 7. 事件类型分布
 * 8. 沙具大类 / 子类汇总
 * 9. 沙具清单
 */
export function toStatsMarkdown(
  session: SandSession,
  stats?: SessionStatsData,
  options: { exportedAt?: Date } = {},
): string {
  const data = stats ?? computeSessionStats(session);
  const scene = getScene(session.sceneId);
  const exportedAt = options.exportedAt ?? new Date();
  const lines: string[] = [];

  lines.push(`# ${session.title} · 客观记录`);
  lines.push('');
  lines.push(`> ${STATS_DISCLAIMER}`);
  lines.push('');

  // 元信息
  lines.push('## 会话信息');
  lines.push('');
  lines.push('| 项目 | 内容 |');
  lines.push('| --- | --- |');
  lines.push(`| 标题 | ${cell(session.title)} |`);
  lines.push(`| 时间 | ${cell(session.at)} |`);
  lines.push(`| 场景 | ${cell(scene.label)} |`);
  lines.push(`| 模式 | ${cell(session.mode === 'self' ? '自助' : session.mode === 'counselor' ? '咨询师协作' : '督导')} |`);
  lines.push(`| 是否封盘 | ${cell(session.locked ? '是' : '否')} |`);
  lines.push(`| 事件条数 | ${cell(data.eventCount)} |`);
  lines.push(`| 导出时间 | ${cell(exportedAt.toISOString())} |`);
  lines.push('');

  // 数量与时长
  lines.push('## 数量与时长');
  lines.push('');
  lines.push('| 项目 | 数值 |');
  lines.push('| --- | --- |');
  lines.push(`| 摆件数 | ${cell(data.itemCount)} |`);
  lines.push(`| 总时长 | ${cell(mmss(data.durationMs))} |`);
  lines.push(`| 操作次数 | ${cell(data.eventCount)} |`);
  lines.push(`| 放入次数 | ${cell(data.addCount)} |`);
  lines.push(`| 拿走次数 | ${cell(data.removeCount)} |`);
  lines.push(`| 移动次数 | ${cell(data.moveCount)} |`);
  lines.push(`| 缩放次数 | ${cell(data.scaleCount)} |`);
  lines.push(`| 旋转次数 | ${cell(data.rotateCount)} |`);
  lines.push(`| 写过注释 | ${cell(data.noteCount)} |`);
  lines.push(`| 整理沙面 | ${cell(data.strokeCount)} |`);
  lines.push(`| 换场景 | ${cell(data.sceneChanges)} |`);
  lines.push('');

  // 时间分布
  lines.push('## 时间分布');
  lines.push('');
  lines.push('| 项目 | 数值 |');
  lines.push('| --- | --- |');
  lines.push(`| 第一件摆件 | ${cell(mmss(data.firstItemAt))} |`);
  lines.push(`| 最后一次动作 | ${cell(mmss(data.lastActionAt))} |`);
  lines.push(`| 最长停顿 | ${cell(mmss(data.longestPauseMs))} |`);
  lines.push('');

  // 沙面
  lines.push('## 沙面');
  lines.push('');
  lines.push('| 项目 | 数值 |');
  lines.push('| --- | --- |');
  lines.push(`| 沙面改动比例 | ${cell(Math.round(data.surfaceMovedRatio * 100))}% |`);
  lines.push(`| 湿润比例 | ${cell(Math.round(data.wetRatio * 100))}% |`);
  lines.push('');

  // 九宫格
  lines.push('## 九宫格分布');
  lines.push('');
  lines.push('| 区域 | 摆件数 |');
  lines.push('| --- | --- |');
  for (const zone of data.zones) {
    lines.push(`| ${cell(ZONE_LABELS[zone.zone])} | ${cell(zone.count)} |`);
  }
  lines.push('');

  // 事件类型分布
  lines.push('## 事件类型分布');
  lines.push('');
  if (data.eventTypes.length === 0) {
    lines.push('（没有过程事件）');
  } else {
    lines.push('| 事件类型 | 次数 | 占比 |');
    lines.push('| --- | --- | --- |');
    for (const entry of data.eventTypes) {
      lines.push(
        `| ${cell(entry.label)} | ${cell(entry.count)} | ${cell(Math.round(entry.ratio * 100))}% |`,
      );
    }
  }
  lines.push('');

  // 沙具大类 / 子类
  lines.push('## 沙具汇总');
  lines.push('');
  lines.push('### 按大类');
  lines.push('');
  if (data.categoryCounts.length === 0) {
    lines.push('（没有摆件）');
  } else {
    lines.push('| 大类 | 次数 |');
    lines.push('| --- | --- |');
    for (const entry of data.categoryCounts) {
      lines.push(`| ${cell(entry.label)} | ${cell(entry.count)} |`);
    }
  }
  lines.push('');
  lines.push('### 按子类');
  lines.push('');
  if (data.subcategoryCounts.length === 0) {
    lines.push('（没有摆件）');
  } else {
    lines.push('| 子类 | 所属大类 | 次数 |');
    lines.push('| --- | --- | --- |');
    for (const entry of data.subcategoryCounts) {
      lines.push(`| ${cell(entry.label)} | ${cell(entry.categoryLabel)} | ${cell(entry.count)} |`);
    }
  }
  lines.push('');

  // 沙具清单
  lines.push('## 沙具清单');
  lines.push('');
  if (data.symbolCounts.length === 0) {
    lines.push('（没有摆件）');
  } else {
    lines.push('| 沙具 | 次数 |');
    lines.push('| --- | --- |');
    for (const entry of data.symbolCounts) {
      lines.push(`| ${cell(entry.label)} | ${cell(entry.count)} |`);
    }
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(`本文件由「心屿」在本机生成，数据未离开本设备。${STATS_DISCLAIMER}`);
  lines.push('');

  return lines.join('\n');
}

/** 建议的导出文件名，例如 `沙盘记录-2026-10-26.md` */
export function statsFileName(session: SandSession): string {
  const date = new Date(session.at);
  const stamp = Number.isNaN(date.getTime())
    ? session.at.slice(0, 10)
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const safeTitle = session.title.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 40) || '沙盘记录';
  return `${safeTitle}-${stamp}.md`;
}

/**
 * 触发浏览器下载 `.md` 文件。
 *
 * 只用 `Blob` + `URL.createObjectURL`，不经网络。返回是否成功发起下载；
 * 非浏览器环境（单测）返回 false，不抛错。
 */
export function downloadStatsMarkdown(
  session: SandSession,
  options: { stats?: SessionStatsData; exportedAt?: Date } = {},
): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const markdown = toStatsMarkdown(session, options.stats, { exportedAt: options.exportedAt });
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = statsFileName(session);
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // 让浏览器有机会开始下载再回收
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
