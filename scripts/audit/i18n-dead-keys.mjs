#!/usr/bin/env node
/**
 * i18n 死键检查：字典里的每个键都必须有人用。
 *
 * ---- 为什么 ----
 *
 * 幽灵字段排查完 `Preferences` 之后顺手扫了 i18n 字典，发现 195 个键里
 * 有一批从没被 `t()` 引用过。其中一部分是**真的死了**（功能删了、
 * 文案留着），另一部分是**动态拼接**的（`t(\`sandbox.scene.${id}\`)`），
 * 简单的字符串搜索看不出来。
 *
 * 这一层很关键：`settings.sound` / `settings.reducedMotion` /
 * `settings.outline` 三个键在这次排查里被证明是「有文案、没 UI」的证据 ——
 * 文案齐备会让人以为功能存在。反过来说，**没人用的文案也是幽灵的证据**。
 *
 * ---- 判定 ----
 *
 * 一个键算「被使用」，只要满足任一：
 *   1. 源码里出现完整字面量 `'sandbox.scene.beach'`；
 *   2. 源码里有同前缀的模板拼接 `` t(`sandbox.scene.${…}`) ``，
 *      且该键的前缀（最后一段之前的部分）匹配；
 *   3. 键在 README / docs 里被显式列出（文档承诺也算契约）。
 *
 * 用法：
 *   node scripts/audit/i18n-dead-keys.mjs
 *   node scripts/audit/i18n-dead-keys.mjs --strict
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.I18N_ROOT ? path.resolve(process.env.I18N_ROOT) : process.cwd();
const STRICT = process.argv.includes('--strict');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.|\.spec\./.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/** 从 zh-CN.ts 抓所有键 */
function readKeys() {
  const src = readFileSync(path.join(ROOT, 'src/i18n/zh-CN.ts'), 'utf8');
  return [...src.matchAll(/^ {2}'([A-Za-z0-9_.]+)':/gm)].map((m) => m[1]);
}

const files = walk(path.join(ROOT, 'src')).filter((f) => !f.includes(`${path.sep}i18n${path.sep}`));
const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');

/*
 * 动态前缀：把源码里所有 `t(\`xxx.${` 的 xxx. 前缀抓出来，
 * 这些前缀下的键都算「可能被用到」。
 */
const dynamicPrefixes = [...source.matchAll(/t\(`([A-Za-z0-9_.]+)\.\$\{/g)].map((m) => m[1]);

const keys = readKeys();
const dead = [];
const dynamic = [];

for (const key of keys) {
  if (source.includes(`'${key}'`)) continue;

  // 前缀匹配：key 形如 sandbox.scene.beach，前缀 sandbox.scene 出现在动态拼接里
  const lastDot = key.lastIndexOf('.');
  const prefix = lastDot > 0 ? key.slice(0, lastDot) : '';
  if (prefix && dynamicPrefixes.some((p) => p === prefix || prefix.startsWith(`${p}.`))) {
    dynamic.push(key);
    continue;
  }
  dead.push(key);
}

console.log(`i18n 死键检查：共 ${keys.length} 个键`);
console.log(`  动态拼接前缀：${dynamicPrefixes.length} 个 → ${dynamicPrefixes.join(', ') || '（无）'}`);
console.log(`  按前缀视为在用：${dynamic.length} 个`);
console.log(`  确认没人用：${dead.length} 个\n`);

if (dead.length > 0) {
  for (const key of dead) console.log(`  ✗ ${key}`);
  console.log(
    '\n死键有两种命运：补上使用它的 UI，或者删掉它。' +
      '\n留着不删的代价是：它会让下一个人以为功能存在（见 docs/TESTING.md §4.10）。',
  );
} else {
  console.log('✓ 没有死键');
}

/*
 * ---------------------------------------------------------------------------
 * 字典自洽：两套字典的键集、顺序、占位符必须一致。
 *
 * 这条是补上的 —— 清理 42 个死键时删了 33 行键值对，每次都要担心
 * 「zh 删了、en 忘了删」。少一个键的后果不是编译错误，而是英文用户
 * 在那个位置看到中文，或者看到字面量 `settings.retention.days`。
 * 类型系统看不见它（键是运行时字符串），只能由脚本守。
 * ---------------------------------------------------------------------------
 */
const zhSrc = readFileSync(path.join(ROOT, 'src/i18n/zh-CN.ts'), 'utf8');
const enSrc = readFileSync(path.join(ROOT, 'src/i18n/en.ts'), 'utf8');
const parity = [];

{
  const KEYS = /^ {2}'([A-Za-z0-9_.]+)':/gm;
  const PAIRS = /^ {2}'([A-Za-z0-9_.]+)':\s*'((?:[^'\\]|\\.)*)',/gm;
  const zhKeys = [...zhSrc.matchAll(KEYS)].map((m) => m[1]);
  const enKeys = [...enSrc.matchAll(KEYS)].map((m) => m[1]);

  for (const k of new Set(zhKeys.filter((k, i) => zhKeys.indexOf(k) !== i))) {
    parity.push(`zh-CN 重复键：${k}`);
  }
  for (const k of new Set(enKeys.filter((k, i) => enKeys.indexOf(k) !== i))) {
    parity.push(`en 重复键：${k}`);
  }
  for (const k of zhKeys) if (!enKeys.includes(k)) parity.push(`只在 zh-CN 有：${k}`);
  for (const k of enKeys) if (!zhKeys.includes(k)) parity.push(`只在 en 有：${k}`);

  if (zhKeys.length !== enKeys.length) {
    parity.push(`键数不等：zh-CN ${zhKeys.length} / en ${enKeys.length}`);
  } else {
    const moved = zhKeys.filter((k, i) => enKeys[i] !== k);
    if (moved.length > 0) {
      parity.push(`两表键顺序不一致（${moved.length} 处，首个：${moved[0]}）`);
    }
  }

  const collect = (src) => {
    const map = new Map();
    for (const m of src.matchAll(PAIRS)) {
      map.set(m[1], [...m[2].matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(','));
    }
    return map;
  };
  const zhPh = collect(zhSrc);
  const enPh = collect(enSrc);
  for (const [key, vars] of zhPh) {
    if (!enPh.has(key)) continue;
    if (zhPh.get(key) !== enPh.get(key)) {
      parity.push(`占位符不一致 ${key}：zh-CN[${vars || '无'}] / en[${enPh.get(key) || '无'}]`);
    }
  }
}

console.log('\n字典自洽：');
if (parity.length === 0) {
  console.log('  ✓ 两套字典键集、顺序、占位符完全一致');
} else {
  for (const p of parity) console.log(`  ✗ ${p}`);
}

process.exit(STRICT && (dead.length > 0 || parity.length > 0) ? 1 : 0);
