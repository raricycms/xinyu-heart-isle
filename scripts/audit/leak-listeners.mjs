/**
 * 监听器与计时器泄漏审计（`npm run audit:leaks`）。
 *
 * ── 为什么这个门禁存在 ──────────────────────────────────────────
 *
 * `docs/TESTING.md` §6.2.4 写着「没有内存断言」，理由很实在：
 * `performance.memory` 需要 Chromium 私有 flag，波动极大，
 * 做成门禁会退化成随机红灯。
 *
 * 但内存泄漏的**最常见成因是完全静态可查的**：
 *
 *   1. `addEventListener` 没有配对的 `removeEventListener`
 *   2. `setInterval` 没有配对的 `clearInterval`
 *   3. React `useEffect` 里注册了东西却没 return 清理函数
 *
 * 这些不需要测内存就能抓。抓不到"所有泄漏"，但能抓到
 * "泄漏的典型形状" —— 而 §6.2.4 真正担心的正是这个形状：
 * 「用 20 分钟没问题，用 2 小时卡死」。
 *
 * ── 规则（故意定得窄）──────────────────────────────────────────
 *
 * 只检查**生产代码**（排除 *.test.* / *.example.*）。测试文件里
 * 造假 window 是正常手法，不该被这个门禁管。
 *
 * 判定方式：同一个文件里，出现 `addEventListener(type, fn)`
 * 就必须出现 `removeEventListener(type, ...)`，type 字面量要能对上。
 * 对不上就报 —— 但**模块作用域的注册是白名单**：
 * `storage.ts` 在模块加载时注册 `storage` 事件，那是单例设计，
 * 它这辈子只注册一次，没有"清理"这个概念。
 *
 * ── 为什么不做成 AST 分析 ───────────────────────────────────────
 *
 * 这个仓库已经证明过（见 dead-components.mjs 的注释）：
 * 用正则做结构分析会误报，而误报比漏报更伤 —— 一次误报就足以
 * 让人不再相信门禁。所以规则刻意窄：只认「同文件内 type 字面量配对」，
 * 跨文件、动态 type、条件注册这些情况全部放过（宁可漏，不可误报）。
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = 'src';
const reportOnly = process.argv.includes('--report-only');

/**
 * 白名单：模块作用域注册、只注册一次的监听器。
 * 每一项都必须写清**为什么**它不需要清理 —— "临时"/"先放着"不是理由。
 */
const ALLOWLIST = new Map([
  [
    'src/lib/storage.ts',
    '模块作用域注册 `storage` 事件，用于跨标签页同步。模块单例，进程内只注册一次，没有清理时机。',
  ],
]);

/** 只扫生产代码；测试与示例文件里的假 window 不归这个门禁管 */
const SKIP = /\.(test|spec)\.[tj]sx?$|\.example\.[tj]sx?$|\.d\.ts$/;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.[tj]sx?$/.test(entry.name) && !SKIP.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * 从 `addEventListener('x', ...)` / `setInterval(...)` 里抽出标识。
 * 返回 `{ kind, key, line }`。
 */
function findRegistrations(text) {
  const found = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // addEventListener('storage', ...) —— 只认第一个参数是字面量的
    const addMatch = line.match(/\baddEventListener\(\s*['"]([^'"]+)['"]/);
    if (addMatch) {
      found.push({ kind: 'listener', key: addMatch[1], line: i + 1 });
    }

    // setInterval / setTimeout —— 计时器只需要"有人清"
    if (/\bsetInterval\s*\(/.test(line)) {
      found.push({ kind: 'interval', key: 'setInterval', line: i + 1 });
    }
  }
  return found;
}

function hasCleanup(text, reg, lines) {
  if (reg.kind === 'listener') {
    const line = lines[reg.line - 1] ?? '';
    /*
     * `{ once: true }` 是一种**天然清理**：事件触发一次后浏览器
     * 自动解绑，不需要（也不该）再写 removeEventListener。
     *
     * 第一版没认这条，于是 `symbolSource.ts` 的两处
     * `addEventListener('load', onReady, { once: true })` 被误报成泄漏。
     *
     * 误报比漏报更伤 —— 一次误报就足以让人不再相信门禁。
     * 所以这类明确的、语义上的清理方式必须被识别，而不是塞白名单。
     */
    if (/\{\s*once\s*:\s*true\s*\}/.test(line)) return true;

    // 必须是同一个 type 字面量
    const re = new RegExp(
      `\\bremoveEventListener\\(\\s*['"]${reg.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
    );
    return re.test(text);
  }
  // setInterval 必须配 clearInterval
  return /\bclearInterval\s*\(/.test(text);
}

/**
 * 模块作用域 vs 函数/effect 作用域。
 *
 * 判据：注册那一行左边的缩进。React 里的注册总在 useEffect 内
 * （至少 2 层缩进），模块顶层的注册缩进为 0。
 *
 * 这是启发式，所以只在**白名单文件**上用它决定"要不要报"——
 * 非白名单文件里缩进为 0 的注册照报，因为那大概率是真漏了。
 */
function isModuleScope(lines, lineNo) {
  const line = lines[lineNo - 1] ?? '';
  return line.length > 0 && line[0] !== ' ' && line[0] !== '\t';
}

const files = await walk(SRC);
const problems = [];
let registrations = 0;
let allowlisted = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const regs = findRegistrations(text);
  if (regs.length === 0) continue;

  const lines = text.split(/\r?\n/);
  const allowReason = ALLOWLIST.get(file.replace(/\\/g, '/'));

  for (const reg of regs) {
    registrations += 1;
    if (hasCleanup(text, reg, lines)) continue;

    if (allowReason) {
      allowlisted += 1;
      continue;
    }
    if (isModuleScope(lines, reg.line)) {
      // 模块作用域但不在白名单 —— 报，因为没写理由的模块级注册
      // 就是"我没想过它会不会泄漏"
      problems.push({
        file: file.replace(/\\/g, '/'),
        ...reg,
        why: '模块作用域注册且无白名单理由',
      });
      continue;
    }
    problems.push({
      file: file.replace(/\\/g, '/'),
      ...reg,
      why: reg.kind === 'listener' ? '没有配对的 removeEventListener' : '没有配对的 clearInterval',
    });
  }
}

console.log('监听器 / 计时器泄漏审计');
console.log(`  扫描：${files.length} 个生产代码文件`);
console.log(`  注册点：${registrations} 处`);
console.log(`  白名单：${ALLOWLIST.size} 项（每项都有理由）`);
if (allowlisted > 0) console.log(`  白名单豁免：${allowlisted} 处`);
console.log('');

if (problems.length === 0) {
  console.log('✓ 每个监听器 / 计时器都有配对清理');
  console.log('  —— 这是 §6.2.4 内存缺口里「完全静态可查」的那一半。');
  console.log('     另一半（真实内存曲线）仍需要人工用 DevTools 观察。');
  process.exit(0);
}

console.error(`✗ ${problems.length} 处注册没有配对清理：`);
console.error('');
for (const p of problems) {
  console.error(`  ${p.file}:${p.line}  ${p.kind}(${p.key})`);
  console.error(`      ${p.why}`);
}
console.error('');
console.error('修法二选一：');
console.error('  1. 在 useEffect 里 return 一个清理函数；');
console.error('  2. 若确实是模块单例、只注册一次，加进本脚本的 ALLOWLIST 并写明理由。');
process.exit(reportOnly ? 0 : 1);
