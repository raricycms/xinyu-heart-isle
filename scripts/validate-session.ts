#!/usr/bin/env node
/**
 * 心屿 · `.sandplay.json` 会话文件校验器
 *
 * 这是 `docs/FORMAT.md` 的参考实现：**只依赖 Node 22 自带能力**，不装任何 npm 依赖。
 *
 * 用法（无需构建、无需安装依赖）：
 *
 *   node --experimental-strip-types scripts/validate-session.ts samples/example.sandplay.json
 *   node --experimental-strip-types scripts/validate-session.ts samples/*.sandplay.json
 *   node --experimental-strip-types scripts/validate-session.ts --strict file.sandplay.json
 *   node --experimental-strip-types scripts/validate-session.ts --json file.sandplay.json
 *
 * 退出码：
 *   0 = 全部通过
 *   1 = 有文件校验未通过（含参数错误）
 *   2 = 有文件无法读取（不存在 / 无权限 / 是目录）
 *
 * 设计约束：
 * 1. **单一事实来源**：判定逻辑全部来自 `src/format/sandplay.ts`，本文件只做 IO 与排版。
 * 2. **可组合**：`--json` 输出机器可读结果，便于 CI 与其他工具消费。
 * 3. **不联网**：校验过程完全离线，不会把会话内容发送到任何地方。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseSandplayFile } from '../src/format/sandplay.ts';
import type { ValidationIssue } from '../src/format/sandplay.ts';

/* -------------------------------------------------------------------------- */
/*                                  常量与类型                                  */
/* -------------------------------------------------------------------------- */

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_IO = 2;

const MODE_LABELS: Record<string, string> = {
  self: '自助',
  counselor: '咨询师协作',
  supervision: '督导',
};

/** 单个文件的校验结果（`--json` 时原样输出） */
interface FileReport {
  file: string;
  /** 是否通过 */
  ok: boolean;
  /** 该文件单独决定的退出码 */
  exitCode: number;
  /** 无法读取时的原因 */
  readError?: string;
  /** 校验问题列表 */
  issues: ValidationIssue[];
  /** 通过时的摘要；未通过则缺省 */
  summary?: SessionSummary;
}

interface SessionSummary {
  title: string;
  mode: string;
  modeLabel: string;
  sceneId: string;
  itemCount: number;
  eventCount: number;
  /** 过程时长（毫秒）：有事件时取最后一条事件的 t，否则用 endedAt - createdAt */
  durationMs: number;
  durationSource: 'events' | 'timestamps' | 'none';
  locked: boolean;
  exportedAt: string;
  producer: string;
  surface?: {
    cols: number;
    rows: number;
    state: 'dry' | 'wet';
    hasWetness: boolean;
    waterAdded: number;
  };
  reflectionLength: number;
  annotationCount: number;
}

interface Options {
  files: string[];
  strict: boolean;
  json: boolean;
  quiet: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                  参数解析                                   */
/* -------------------------------------------------------------------------- */

const USAGE = `心屿 · 沙盘会话文件校验器（sandplay-session/v1）

用法：
  node --experimental-strip-types scripts/validate-session.ts <文件...> [选项]

选项：
  --strict       把警告也当作错误（推荐在 CI 中使用）
  --json         输出机器可读的 JSON（便于管道处理）
  --quiet, -q    只输出错误，不输出通过信息
  --help, -h     显示本帮助

示例：
  node --experimental-strip-types scripts/validate-session.ts samples/example.sandplay.json
  node --experimental-strip-types scripts/validate-session.ts --strict samples/*.sandplay.json

退出码：
  0 = 全部通过　1 = 校验未通过（含参数错误）　2 = 文件无法读取

通配符说明：
  Windows PowerShell 不会自动展开 * 和 ?，而 cmd / bash 会。
  为了两边行为一致，本工具在自己的参数里再做一次展开——所以
  samples/*.sandplay.json 在任何 shell 里都能用。
`;

/** 路径里是否含通配符（* 或 ?） */
function hasGlobMagic(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?');
}

/**
 * 极简通配符展开：只支持 `*` 与 `?`，只作用于文件名的最后一段。
 *
 * 不引入 glob 依赖是刻意的——校验器要能零依赖运行。
 * 展开失败时原样返回，让后续「文件不存在」的报错来提示用户。
 */
function expandGlob(pattern: string): string[] {
  if (!hasGlobMagic(pattern)) return [pattern];

  const dir = dirname(pattern);
  const filePattern = basename(pattern);
  const absoluteDir = dir === '' ? '.' : dir;

  let entries: string[];
  try {
    entries = readdirSync(absoluteDir);
  } catch {
    return [pattern];
  }

  // 把 * -> .*、? -> . 转成正则；其余字符一律转义
  const regex = new RegExp(
    `^${filePattern
      .split('')
      .map((char) => {
        if (char === '*') return '.*';
        if (char === '?') return '.';
        return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('')}$`,
  );

  const matched = entries.filter((name) => regex.test(name)).sort();
  if (matched.length === 0) return [pattern];
  return matched.map((name) => (dir === '' || dir === '.' ? name : join(dir, name)));
}

function parseArgs(argv: string[]): Options | { help: true } | { error: string } {
  const files: string[] = [];
  const flags = new Set<string>();

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--strict' || arg === '--json' || arg === '--quiet' || arg === '-q') {
      flags.add(arg);
      continue;
    }
    if (arg.startsWith('-')) return { error: `无法识别的选项：${arg}` };
    files.push(arg);
  }

  if (files.length === 0) return { error: '至少需要一个文件路径。' };

  // 去重（同一文件通过通配符和显式路径各传一次时只校验一遍），保持顺序
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const resolved of expandGlob(file)) {
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      expanded.push(resolved);
    }
  }

  return {
    files: expanded,
    strict: flags.has('--strict'),
    json: flags.has('--json'),
    quiet: flags.has('--quiet') || flags.has('-q'),
  };
}

/* -------------------------------------------------------------------------- */
/*                                    校验                                     */
/* -------------------------------------------------------------------------- */

/** 读文件并去掉可能存在的 UTF-8 BOM（Windows 编辑器常见） */
function readTextFile(path: string): { text: string } | { error: string } {
  try {
    const stats = statSync(path);
    if (stats.isDirectory()) return { error: '这是一个目录，不是文件。' };
    if (!stats.isFile()) return { error: '不是一个普通文件。' };
    const raw = readFileSync(path, 'utf8');
    // '\uFEFF' = UTF-8 BOM。JSON.parse 不接受它，这里静默剥掉。
    return { text: raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw };
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return { error: '文件不存在。' };
    if (err.code === 'EACCES') return { error: '没有读取权限。' };
    if (err.code === 'EISDIR') return { error: '这是一个目录，不是文件。' };
    return { error: `读取失败：${err.message}` };
  }
}

function toSummary(validated: NonNullable<ReturnType<typeof parseSandplayFile>['data']>, exportedAt: string, producer: string): SessionSummary {
  const events = validated.events;

  let durationMs = 0;
  let durationSource: SessionSummary['durationSource'] = 'none';
  if (events.length > 0) {
    durationMs = events.reduce((max, event) => (event.t > max ? event.t : max), 0);
    durationSource = 'events';
  } else if (validated.endedAt) {
    const start = Date.parse(validated.createdAt);
    const end = Date.parse(validated.endedAt);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      durationMs = end - start;
      durationSource = 'timestamps';
    }
  }

  let surface: SessionSummary['surface'];
  if (validated.surface) {
    surface = {
      cols: validated.surface.cols,
      rows: validated.surface.rows,
      state: validated.surface.state === 'wet' ? 'wet' : 'dry',
      hasWetness: typeof validated.surface.wetness === 'string' && validated.surface.wetness.length > 0,
      waterAdded: validated.surface.waterAdded ?? 0,
    };
  }

  const mode = validated.mode;

  return {
    title: validated.title,
    mode,
    modeLabel: MODE_LABELS[mode] ?? mode,
    sceneId: validated.sceneId,
    itemCount: validated.items.length,
    eventCount: events.length,
    durationMs,
    durationSource,
    locked: validated.locked,
    exportedAt,
    producer,
    ...(surface ? { surface } : {}),
    reflectionLength: validated.reflection ? validated.reflection.length : 0,
    annotationCount: validated.annotations ? validated.annotations.length : 0,
  };
}

function validateFile(path: string, strict: boolean): FileReport {
  const read = readTextFile(path);
  if ('error' in read) {
    return { file: path, ok: false, exitCode: EXIT_IO, readError: read.error, issues: [] };
  }

  const result = parseSandplayFile(read.text, strict);
  if (!result.ok || !result.data) {
    return { file: path, ok: false, exitCode: EXIT_INVALID, issues: result.issues };
  }

  // 摘要所需的 exportedAt / producer 不在 ValidationResult 里（校验器只回 session 正文），
  // 这里重新取一次顶层字段——JSON.parse 已在 parseSandplayFile 内成功过，所以这里必然安全。
  const envelope = JSON.parse(read.text) as {
    exportedAt?: string;
    producer?: { app?: string; version?: string };
  };
  const app = envelope.producer?.app ?? '(未署名)';
  const version = envelope.producer?.version ?? '?';

  return {
    file: path,
    ok: true,
    exitCode: EXIT_OK,
    issues: result.issues,
    summary: toSummary(result.data, envelope.exportedAt ?? '', `${app} ${version}`),
  };
}

/* -------------------------------------------------------------------------- */
/*                                    输出                                     */
/* -------------------------------------------------------------------------- */

/** 毫秒 -> mm:ss（超过 1 小时用 h:mm:ss） */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

const CHECK = '✓';
const CROSS = '✗';

function printHuman(reports: FileReport[], options: Options): void {
  for (const report of reports) {
    if (report.readError) {
      process.stdout.write(`${CROSS} ${report.file}\n`);
      process.stdout.write(`  无法读取：${report.readError}\n`);
      continue;
    }

    if (!report.ok) {
      const errors = report.issues.filter((issue) => issue.severity === 'error');
      const warnings = report.issues.filter((issue) => issue.severity === 'warning');
      process.stdout.write(`${CROSS} ${report.file}\n`);
      process.stdout.write(
        `  ${errors.length} 个错误${warnings.length > 0 ? ` / ${warnings.length} 个警告` : ''}` +
          `${options.strict ? '（--strict：警告已按错误处理）' : ''}\n`,
      );
      for (const issue of report.issues) {
        const tag = issue.severity === 'error' ? 'error  ' : 'warning';
        process.stdout.write(`  ${tag} ${issue.path}\n`);
        process.stdout.write(`          ${issue.message}\n`);
      }
      continue;
    }

    const summary = report.summary;
    if (!summary) continue;

    if (!options.quiet) {
      process.stdout.write(`${CHECK} ${report.file}\n`);
    } else {
      process.stdout.write(`${CHECK} ${report.file}\n`);
    }

    const lines: string[] = [];
    lines.push(
      `  标题：${summary.title || '(无标题)'}　模式：${summary.modeLabel}(${summary.mode})　` +
        `场景：${summary.sceneId}${summary.locked ? '　已封盘' : ''}`,
    );
    lines.push(
      `  摆件 ${summary.itemCount}　事件 ${summary.eventCount}　` +
        `时长 ${formatDuration(summary.durationMs)}${summary.durationSource === 'none' ? '（无过程数据）' : ''}`,
    );
    if (summary.surface) {
      const kind = summary.surface.state === 'wet' ? '湿沙' : '干沙';
      const wet = summary.surface.hasWetness ? '，含湿度场' : '';
      lines.push(
        `  沙面 ${summary.surface.cols}×${summary.surface.rows} ${kind}${wet}　` +
          `喷水 ${summary.surface.waterAdded} 次`,
      );
    }
    if (summary.reflectionLength > 0 || summary.annotationCount > 0) {
      lines.push(
        `  自述 ${summary.reflectionLength} 字　标注 ${summary.annotationCount} 条`,
      );
    }
    lines.push(`  导出：${summary.producer}　${summary.exportedAt}`);

    for (const line of lines) process.stdout.write(`${line}\n`);

    const warnings = report.issues.filter((issue) => issue.severity === 'warning');
    if (warnings.length > 0) {
      process.stdout.write(`  ${warnings.length} 个警告：\n`);
      for (const issue of warnings) {
        process.stdout.write(`  warning ${issue.path}　${issue.message}\n`);
      }
    }
  }

  if (reports.length > 1) {
    const passed = reports.filter((report) => report.ok).length;
    process.stdout.write(`\n合计 ${reports.length} 个文件：${passed} 通过 / ${reports.length - passed} 未通过\n`);
  }
}

function printJson(reports: FileReport[], exitCode: number): void {
  const payload = {
    validator: 'xinyu-validate-session',
    format: 'sandplay-session/v1',
    ok: exitCode === EXIT_OK,
    exitCode,
    totals: {
      files: reports.length,
      passed: reports.filter((report) => report.ok).length,
      failed: reports.filter((report) => !report.ok).length,
    },
    files: reports,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

/* -------------------------------------------------------------------------- */
/*                                    入口                                     */
/* -------------------------------------------------------------------------- */

function main(argv: string[]): number {
  const parsed = parseArgs(argv);

  if ('help' in parsed) {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }
  if ('error' in parsed) {
    process.stderr.write(`参数错误：${parsed.error}\n\n${USAGE}`);
    return EXIT_INVALID;
  }

  const reports = parsed.files.map((file) => validateFile(file, parsed.strict));

  // 退出码优先级：读取失败(2) > 校验失败(1) > 通过(0)
  let exitCode = EXIT_OK;
  for (const report of reports) {
    if (report.exitCode === EXIT_IO) exitCode = EXIT_IO;
    else if (report.exitCode === EXIT_INVALID && exitCode !== EXIT_IO) exitCode = EXIT_INVALID;
  }

  if (parsed.json) printJson(reports, exitCode);
  else printHuman(reports, parsed);

  return exitCode;
}

process.exit(main(process.argv.slice(2)));
