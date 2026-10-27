#!/usr/bin/env node
/**
 * 幽灵字段检查：每个类型字段都必须有「读」和「写」两侧。
 *
 * ---- 这个脚本为什么存在 ----
 *
 * 本项目 4 次交付里挖出了 5 个「死开关」，形态全都不同：
 *
 *  1. `soundEnabled` —— 有读的入口（默认值、i18n 文案、类型），
 *     **零处消费**。沙声这个 P0 项根本没实现。                （0 读 0 写）
 *  2. `sandboxUiMode` —— 同上，承诺「记住上次的模式」。       （0 读 0 写）
 *  3. `acknowledgedAge` —— CONTRACT §7.7 明文要求的功能，
 *     字段有、实现无。                                       （0 读 0 写）
 *  4. `acknowledgedDisclaimer` —— VISION §5.6「首次进入确认」，
 *     字段有、实现无。                                       （0 读 0 写）
 *  5. `nickname` —— **最隐蔽的一种**：有读、没写。
 *     `HomePage` 里 `{nickname ? … : null}` 那个分支永远为假，
 *     但搜字段名能看到消费，看起来是活的。                    （1 读 0 写）
 *
 * 第 5 种是靠人手搜不出来的。所以需要一台机器来问两个问题：
 * **谁读它？谁写它？** 任一答案为「没有」，它就是幽灵。
 *
 * ---- 判定方式 ----
 *
 * 只认 `Preferences` 里的字段（这是死开关的重灾区：它们是「用户可配置
 * 但没人用」的天然候选）。对每个字段统计：
 *   - 读：`prefs.X` / `preferences.X` / 解构 `{ X }` / `X:` 以外的方式出现
 *   - 写：`setPreferences({ X:` / `X =` / 对象字面量里 `X:`
 * 并排除定义处（`types.ts`）与测试文件。
 *
 * 这是启发式的，宁可误报也不漏报 —— 误报由人判断，漏报没人知道。
 *
 * 用法：
 *   node scripts/audit/ghost-fields.mjs          报告
 *   node scripts/audit/ghost-fields.mjs --strict  有幽灵就 exit 1
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.GHOST_ROOT ? path.resolve(process.env.GHOST_ROOT) : process.cwd();
const STRICT = process.argv.includes('--strict');

/** 递归收集 src 下的 .ts/.tsx（跳过测试与 i18n 字典） */
function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collect(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.|\.spec\./.test(entry)) continue;
    /*
     * 只排除**字典本身**（zh-CN.ts / en.ts），不要排除整个 i18n 目录。
     * 第一版写的是 `includes('/i18n/')`，把 src/i18n/index.ts 也排掉了 ——
     * 而那正好是 `const { locale } = usePreferences()` 所在处，
     * 于是 locale 被误判成「无人读取」。
     * 检测器的假阳性比被测代码的缺陷更难发现：它看起来像"真的有问题"。
     */
    if (/^(zh-CN|en)\.ts$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/** 从 types.ts 里抓出 Preferences 接口的字段名 */
function readPreferenceFields() {
  const src = readFileSync(path.join(ROOT, 'src/lib/types.ts'), 'utf8');
  const start = src.indexOf('export interface Preferences {');
  if (start < 0) throw new Error('找不到 Preferences 接口');
  let depth = 0;
  let i = src.indexOf('{', start);
  const begin = i + 1;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = src.slice(begin, i);
  const fields = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('/*') || line.startsWith('*') || line.startsWith('//')) continue;
    const m = line.match(/^([A-Za-z_$][\w$]*)\??\s*:/);
    if (m) fields.push(m[1]);
  }
  return fields;
}

/** 判断某文件里该字段是被读还是被写 */
function classify(files, field) {
  const reads = [];
  const writes = [];
  const def = new RegExp(`\\b${field}\\b`, 'g');
  /*
   * 写：**只认 `setPreferences({ …字段… })` 这一种形态**。
   *
   * 第一版还接受了「任意对象字面量里的 `X: 值`」，结果被自己坑了：
   * `Toolbar.tsx` 里的类型声明 `outlineMode: boolean;` 被当成「写入」，
   * 于是把 `setPreferences({ outlineMode })` 删掉之后检测器仍然报绿 ——
   * 检测器自己长出了幽灵。这正是 §4.10 讲的那件事：门禁的假绿比缺陷更难发现。
   *
   * 现在的判定：`setPreferences(` 后面第一个 `{…}` 里必须真的出现该字段。
   * 宁可漏报（漏报由人复核）也不假绿（假绿没人发现）。
   */
  const writeRe = new RegExp(`setPreferences\\(\\s*\\{[^}]*\\b${field}\\s*[:,]`);
  /*
   * 读：三条路径都得认。第一版只认第一条，于是把 `locale` 误报成幽灵 ——
   * 而它其实在 src/i18n/index.ts 里被解构着用。
   *   1. `prefs.locale` / `preferences.locale` / `p?.locale`
   *   2. `const { locale } = usePreferences()`  ← 最容易漏，本项目正好这么写
   *   3. 解构带重命名：`const { locale: lang } = ...`
   */
  const readRe = new RegExp(
    `(?:prefs|preferences|p)\\??\\.${field}\\b` +
      `|\\{[^{}]*\\b${field}\\b[^{}]*\\}\\s*=\\s*usePreferences\\s*\\(`,
  );

  for (const file of files) {
    // 定义处不算消费
    if (file.endsWith(`${path.sep}types.ts`)) continue;
    if (file.endsWith(`${path.sep}storage.ts`)) {
      // storage.ts 里默认值定义 X: ... 是「写默认值」，不算真实写入
      // 但读取偏好（getPreferences 返回、useSyncExternalStore）也不算消费
      // 所以整个文件对「消费方」判定跳过
      continue;
    }
    const src = readFileSync(file, 'utf8');
    if (!def.test(src)) {
      def.lastIndex = 0;
      continue;
    }
    def.lastIndex = 0;
    if (writeRe.test(src)) writes.push(path.relative(ROOT, file));
    if (readRe.test(src)) reads.push(path.relative(ROOT, file));
  }
  return { reads, writes };
}

const fields = readPreferenceFields();
const files = collect(path.join(ROOT, 'src'));

console.log(`幽灵字段检查：Preferences 共 ${fields.length} 个字段\n`);

const ghosts = [];
for (const field of fields) {
  const { reads, writes } = classify(files, field);
  const problems = [];
  if (reads.length === 0) problems.push('无人读取');
  if (writes.length === 0) problems.push('无人写入');
  const status = problems.length === 0 ? '✓' : '✗ 幽灵';
  console.log(`  ${field.padEnd(26)} 读 ${String(reads.length).padStart(2)} 写 ${String(writes.length).padStart(2)}  ${status}`);
  if (problems.length) ghosts.push({ field, problems, reads, writes });
}

if (ghosts.length === 0) {
  console.log('\n✓ 没有幽灵字段');
  process.exit(0);
}

console.log(`\n✗ 发现 ${ghosts.length} 个幽灵字段：`);
for (const g of ghosts) {
  console.log(`\n  ${g.field} —— ${g.problems.join('、')}`);
  if (g.reads.length) console.log(`    读于：${g.reads.join(', ')}`);
  if (g.writes.length) console.log(`    写于：${g.writes.join(', ')}`);
}
console.log(
  '\n修法二选一：补上缺的那一侧，或者删掉字段。' +
    '\n详见 docs/TESTING.md §4.10「死开关：字段存在 ≠ 功能存在」。',
);

process.exit(STRICT ? 1 : 0);
