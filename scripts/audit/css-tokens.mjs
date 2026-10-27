/**
 * 心屿 · CSS 自定义属性对账
 *
 * 【为什么需要这个脚本】
 *
 * CSS 的 `var(--x)` 有一个恶毒的特性：**变量未定义时，整条声明被静默
 * 丢弃，不报错、不警告、不进控制台**。于是 `font-size: var(--fs-sm)`
 * 里那个变量只要拼错或压根没定义，字号就悄悄回退到继承值，
 * `border-radius` 回退到 0，`box-shadow` 回退到 none。
 *
 * 这个项目里真实发生过：`sandbox-workbench.css` / `sandbox-replay.css` /
 * `toolbox.css` 共 81 处 `var()` 指向从未定义的 token（`--fs-*` 整套、
 * `--shadow-1..3`、`--r-pill`、`--ink-1..4`、`--dur-fast` 等），
 * 结果沙盘工作台的圆角与阴影从上线起就没生效过。
 *
 * 这类 bug 的可怕之处在于**全部门禁都是绿的**：
 * - tsc 不看 CSS；
 * - 单测不渲染样式；
 * - E2E 断言的是 DOM 结构和文本，不是计算样式；
 * - 视觉回归没有基线图（见 docs/TESTING.md 的已知缺口）；
 * - 浏览器不会报错。
 *
 * 所以只能静态对账：把每个 CSS 文件里所有 `var(--x)` 拿出来，
 * 和 `global.css` 里定义过的集合求差。
 *
 * 【判定规则】
 *
 * - 未定义 + **无 fallback**（`var(--x)`）→ 真失效，报错。
 * - 未定义 + **有 fallback**（`var(--x, 14px)`）→ 无害，放行。
 *   fallback 是作者显式给出的兜底值，浏览器会用它对，视觉上是预期的。
 * - `@property` 或内联 `style` 里定义的变量，本项目没有使用，不处理。
 *
 * 【注释不算数】
 *
 * 注释里的 `var(--x)` 只是文档说明（比如解释这个脚本本身），
 * 必须先剥掉注释再扫，否则会自己举报自己。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const STYLE_DIR = path.join(process.cwd(), 'src/styles');
/** 定义表所在文件：所有全局 token 都在这里 */
const TOKEN_FILE = 'global.css';

/** 剥掉 CSS 注释（保留换行，好让行号仍然对得上） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/** 收集一个文件里定义的所有自定义属性名 */
function collectDefined(src) {
  const defined = new Set();
  for (const match of src.matchAll(/(^|[\s;{])(--[a-z0-9-]+)\s*:/gi)) {
    defined.add(match[2]);
  }
  return defined;
}

/** 收集一个文件里所有 var() 引用，区分有无 fallback */
function collectUses(src) {
  const uses = [];
  const lines = src.split('\n');
  lines.forEach((rawLine, index) => {
    for (const match of rawLine.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/gi)) {
      uses.push({
        name: match[1],
        hasFallback: match[2] === ',',
        line: index + 1,
        text: rawLine.trim().slice(0, 110),
      });
    }
  });
  return uses;
}

function main() {
  const tokenPath = path.join(STYLE_DIR, TOKEN_FILE);
  const tokenSrc = stripComments(readFileSync(tokenPath, 'utf8'));
  const tokenDefined = collectDefined(tokenSrc);

  if (tokenDefined.size === 0) {
    console.error(`✗ 在 ${TOKEN_FILE} 里一个自定义属性都没找到 —— 解析规则可能失效了`);
    process.exit(1);
  }

  const files = readdirSync(STYLE_DIR)
    .filter((name) => name.endsWith('.css'))
    .sort();

  /*
   * 定义表是**全局合并**的，不是一个文件说了算。
   *
   * CSS 自定义属性是继承/层叠的，`--fs-sm` 定义在 `sandbox-workbench.css`
   * 里也照样能在 `toolbox.css` 里用（只要作用域覆盖到）。所以这里把
   * 所有 CSS 文件的定义合起来算，避免「定义写在别的文件里」被误判成失效。
   *
   * 自检 C5/C7 就是为了钉住这条：一开始只认 global.css，结果后置定义的
   * 变量被误报 —— 检测器的误报和漏报一样有害，它会让人开始无视告警。
   */
  const defined = new Set(tokenDefined);
  const perFileDefined = new Map();
  for (const file of files) {
    const src = stripComments(readFileSync(path.join(STYLE_DIR, file), 'utf8'));
    const own = collectDefined(src);
    perFileDefined.set(file, own);
    for (const name of own) defined.add(name);
  }

  const broken = [];
  let harmless = 0;
  let checked = 0;

  for (const file of files) {
    const src = stripComments(readFileSync(path.join(STYLE_DIR, file), 'utf8'));
    for (const use of collectUses(src)) {
      checked += 1;
      if (defined.has(use.name)) continue;
      if (use.hasFallback) {
        harmless += 1;
        continue;
      }
      broken.push({ file, ...use });
    }
  }

  console.log('CSS 自定义属性对账');
  console.log(`  定义表：${TOKEN_FILE}（${tokenDefined.size} 个核心 token）+ 全文件合并，共 ${defined.size} 个`);
  console.log(`  扫描：${files.length} 个 CSS 文件，${checked} 处 var() 引用`);
  console.log(`  有 fallback 的未定义引用（无害）：${harmless} 处`);

  if (broken.length === 0) {
    console.log('\n✓ 没有「未定义且无 fallback」的 var() 引用');
    console.log('  —— 这类引用会让整条 CSS 声明被静默丢弃，是浏览器里最安静的一类 bug。');
    process.exit(0);
  }

  console.log(`\n✗ ${broken.length} 处 var() 指向未定义变量且没有 fallback：`);
  console.log('  这些声明在浏览器里不生效，且不会报任何错。\n');
  for (const item of broken) {
    console.log(`  ${item.file}:${item.line}  ${item.name}`);
    console.log(`    ${item.text}`);
  }
  console.log('\n修复方式二选一：');
  console.log('  1. 在 global.css 里定义该 token（若它是设计体系的一部分）；');
  console.log('  2. 给调用点加 fallback：var(--x, 实际值)（若它只是一次性值）。');
  process.exit(1);
}

main();
