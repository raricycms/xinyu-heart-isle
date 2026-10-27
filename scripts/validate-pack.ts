#!/usr/bin/env node
/**
 * 心屿 · 沙具包（`.symbolpack.json`）校验器
 *
 * 这是 `docs/SYMBOL_PACK.md` 的参考实现。
 *
 * 用法（需要 Node 22，无需安装依赖）：
 *
 *   npm run validate:pack -- samples/example.symbolpack.json
 *   npm run validate:pack -- samples/*.symbolpack.json
 *   npm run validate:pack -- --json mypack.symbolpack.json
 *
 * 退出码：
 *   0 = 全部通过
 *   1 = 有文件未通过校验（含参数错误）
 *   2 = 有文件无法读取（不存在 / 无权限 / 是目录）
 *
 * ── 设计约束（与 `validate-session.ts` 保持一致）─────────────────
 *
 * 1. **单一事实来源**：判定逻辑全部来自 `src/sandbox/library/packs.ts`
 *    的 `validatePack()`，本文件只做 IO 与排版。绝不在这里复制一份
 *    校验规则 —— 两份实现必然漂移，而漂移的方式永远是"CLI 说通过，
 *    应用里装不上"，最难查。
 * 2. **不联网**：校验全程离线。
 * 3. **可组合**：`--json` 输出机器可读结果，便于 CI 消费。
 *
 * ── 为什么要走 alias-loader ────────────────────────────────────
 *
 * `packs.ts` 运行时导入了 `@/lib/storage`（不是 `import type`，
 * 擦不掉），Node 默认不认 `@/` 别名。所以本文件必须配合
 * `--import ./scripts/alias-loader.mjs` 运行 —— `package.json`
 * 的 `validate:pack` 脚本已经带上了。
 *
 * 直接 `node --experimental-strip-types scripts/validate-pack.ts x.json`
 * 会报 `Cannot find package '@/lib'`。这不是本文件的 bug，
 * 是缺少别名钩子，改用 npm 脚本即可。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  SYMBOL_PACK_FORMAT,
  SYMBOL_PACK_MANIFEST_FORMAT,
  BUILTIN_SYMBOL_COUNT,
  validatePack,
} from '../src/sandbox/library/packs.ts';
import type { SymbolPackFile } from '../src/sandbox/library/packs.ts';

/* -------------------------------------------------------------------------- */
/*                                  常量与类型                                  */
/* -------------------------------------------------------------------------- */

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_IO = 2;

const USAGE = `心屿 · 沙具包校验器

用法：
  npm run validate:pack -- <文件...> [选项]

选项：
  --json      以 JSON 格式输出（便于 CI 与其他工具消费）
  --quiet     只输出结果，不输出详情
  --help      显示本帮助

退出码：
  0  全部通过
  1  有文件未通过校验（含参数错误）
  2  有文件无法读取（不存在 / 无权限 / 是目录）

示例：
  npm run validate:pack -- samples/example.symbolpack.json
  npm run validate:pack -- "packs/*.symbolpack.json" --json

格式说明见 docs/SYMBOL_PACK.md
`;

interface FileReport {
  file: string;
  ok: boolean;
  exitCode: number;
  issues: string[];
  summary?: {
    name: string;
    id: string;
    version: string;
    license: string;
    author: string;
    symbolCount: number;
    imageCount: number;
    /** 粗略体积（KB，1 位小数） */
    sizeKB: number;
  };
}

/* -------------------------------------------------------------------------- */
/*                                  参数解析                                   */
/* -------------------------------------------------------------------------- */

interface Args {
  files: string[];
  json: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args | { help: true } | { error: string } {
  const files: string[] = [];
  let json = false;
  let quiet = false;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { help: true };
    else if (arg === '--json') json = true;
    else if (arg === '--quiet') quiet = true;
    else if (arg.startsWith('-')) return { error: `无法识别的选项：${arg}` };
    else files.push(arg);
  }

  if (files.length === 0) return { error: '没有指定文件。' };
  return { files, json, quiet };
}

/* -------------------------------------------------------------------------- */
/*                                  文件展开                                   */
/* -------------------------------------------------------------------------- */

/**
 * 展开通配符。
 *
 * 刻意用一个极简实现（`*` → 当前目录匹配），而不是引 `glob` 依赖：
 * 校验器要能在「刚 clone 下来、还没 `npm i`」的状态下跑。
 */
function expandGlob(pattern: string): string[] {
  if (!pattern.includes('*')) return [pattern];

  const dir = dirname(pattern);
  const base = basename(pattern);
  /* 只支持单个 `*`，够用；多星号当普通文件名处理 */
  if (base.split('*').length !== 2) return [pattern];

  const [prefix, suffix] = base.split('*');
  let entries: string[];
  try {
    entries = readdirSync(dir === '' ? '.' : dir);
  } catch {
    return [pattern];
  }

  return entries
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => join(dir === '' ? '.' : dir, name))
    .sort();
}

/* -------------------------------------------------------------------------- */
/*                                  单文件校验                                  */
/* -------------------------------------------------------------------------- */

function validateFile(file: string): FileReport {
  let text: string;
  try {
    const stat = statSync(file);
    if (stat.isDirectory()) {
      return { file, ok: false, exitCode: EXIT_IO, issues: ['这是一个目录，不是文件。'] };
    }
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const reason =
      code === 'ENOENT' ? '文件不存在。' : code === 'EACCES' ? '没有读取权限。' : '无法读取文件。';
    return { file, ok: false, exitCode: EXIT_IO, issues: [reason] };
  }

  /* 剥 BOM：Windows 编辑器常写 BOM，而 JSON.parse 不认 */
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!stripped.trim()) {
    return { file, ok: false, exitCode: EXIT_INVALID, issues: ['文件是空的。'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (error) {
    return {
      file,
      ok: false,
      exitCode: EXIT_INVALID,
      issues: [`不是有效的 JSON：${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const result = validatePack(parsed);
  if (!result.ok || !result.pack) {
    return { file, ok: false, exitCode: EXIT_INVALID, issues: result.issues };
  }

  return {
    file,
    ok: true,
    exitCode: EXIT_OK,
    issues: [],
    summary: summarize(result.pack, stripped),
  };
}

function summarize(pack: SymbolPackFile, rawText: string): NonNullable<FileReport['summary']> {
  const imageCount = pack.symbols.filter((symbol) => symbol.image !== undefined).length;
  return {
    name: pack.name,
    id: pack.id ?? '(由包名推导)',
    version: pack.version ?? '1.0.0',
    license: pack.license,
    author: pack.author ?? '未署名',
    symbolCount: pack.symbols.length,
    imageCount,
    sizeKB: Math.round((Buffer.byteLength(rawText, 'utf8') / 1024) * 10) / 10,
  };
}

/* -------------------------------------------------------------------------- */
/*                                    输出                                     */
/* -------------------------------------------------------------------------- */

function printHuman(reports: FileReport[], quiet: boolean): void {
  for (const report of reports) {
    const mark = report.ok ? '✓' : '✗';
    process.stdout.write(`${mark} ${report.file}\n`);

    if (!report.ok) {
      for (const issue of report.issues) {
        process.stdout.write(`    ${issue}\n`);
      }
      continue;
    }

    if (quiet || !report.summary) continue;
    const s = report.summary;
    process.stdout.write(
      `    ${s.name}　包 id：${s.id}　版本：${s.version}\n` +
        `    授权：${s.license}　作者：${s.author}\n` +
        `    沙具 ${s.symbolCount} 条` +
        (s.imageCount > 0 ? `（其中 ${s.imageCount} 条用内嵌图片）` : '（全部用字形）') +
        `　文件 ${s.sizeKB}KB\n`,
    );
  }

  if (reports.length > 1) {
    const passed = reports.filter((report) => report.ok).length;
    process.stdout.write(
      `\n合计 ${reports.length} 个文件：${passed} 通过 / ${reports.length - passed} 未通过\n`,
    );
  }
}

function printJson(reports: FileReport[], exitCode: number): void {
  const payload = {
    validator: 'xinyu-validate-pack',
    format: SYMBOL_PACK_FORMAT,
    /** 也接受这个别名格式 */
    acceptedFormats: [SYMBOL_PACK_FORMAT, SYMBOL_PACK_MANIFEST_FORMAT],
    builtinSymbolCount: BUILTIN_SYMBOL_COUNT,
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

  const expanded = new Set<string>();
  for (const file of parsed.files) {
    for (const resolved of expandGlob(file)) expanded.add(resolved);
  }
  const files = [...expanded];
  if (files.length === 0) {
    process.stderr.write('没有匹配到任何文件。\n');
    return EXIT_IO;
  }

  const reports = files.map((file) => validateFile(file));

  /* 退出码优先级：读取失败(2) > 校验失败(1) > 通过(0) */
  let exitCode = EXIT_OK;
  for (const report of reports) {
    if (report.exitCode === EXIT_IO) exitCode = EXIT_IO;
    else if (report.exitCode === EXIT_INVALID && exitCode !== EXIT_IO) exitCode = EXIT_INVALID;
  }

  if (parsed.json) printJson(reports, exitCode);
  else printHuman(reports, parsed.quiet);

  return exitCode;
}

process.exit(main(process.argv.slice(2)));
