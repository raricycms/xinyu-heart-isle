/**
 * bundle-budget.mjs 的自测。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 *
 * 体积门禁本身也可能成为幽灵：如果它「永远输出 ✓」（比如读错了目录、
 * 或者 static 链永远是空集），那它每天都在报告「达标」，而真实体积
 * 已经涨到 500KB。所以必须证明**它在该红的时候会红**。
 *
 * 做法沿用 CONTRACT §9.4 的变异验证思路，但更彻底：不依赖真实 dist，
 * 而是在临时目录里**造两个假的 dist**：
 *   - 一个达标 → 期望退出 0
 *   - 一个超线 → 期望退出 1
 *
 * 这样测的是判据本身，而不是当前仓库的体积数字（后者会变，
 * 一变就得改测试 —— 那又是把期望值抄进测试的老毛病）。
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/audit/bundle-budget.mjs');
let failures = 0;
let checks = 0;

function check(name, ok, detail) {
  checks += 1;
  if (ok) {
    console.log('  ✓ ' + name);
  } else {
    failures += 1;
    console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  }
}

/**
 * 造一个假 dist 并跑门禁。
 *
 * 注意目录结构：脚本从 `cwd/dist/assets` 找文件，所以假 dist 必须
 * 建在 `<workDir>/dist/assets`，而 `cwd` 是 `<workDir>`。
 * 第一版漏了这层 `dist`，四个用例全在报「找不到目录」——
 * 恰好也证明脚本没有假绿（该红的时候确实红了）。
 *
 * 文件内容用可复现的伪随机字符；`sizeKb` 指**解压后**大小，
 * gzip 压缩率按 3.5:1 估算。
 */
function makeDist(workDir, plan) {
  const assetsDir = join(workDir, 'dist', 'assets');
  mkdirSync(assetsDir, { recursive: true });
  for (const [name, spec] of Object.entries(plan)) {
    const { sizeKb, imports } = spec;
    /*
     * 生成**真的难压缩**的内容。
     *
     * 这一小段改了三版，每版都是自测抓出来的：
     *   1. `(i*7919) % 36`    周期 36，gzip 压到 1/50，超线用例反而绿
     *   2. `(seed*1103515245+12345) & 0x7fffffff`
     *      JS 里这个乘法超出 2^53 丢精度，实际退化成短周期，压到 1/20
     *   3. xorshift32（下面这个）—— 周期 2^32-1，压缩率约 1:1
     *
     * 用实测确认过：300KB 的 xorshift 输出 gzip 后仍是 ~290KB。
     * **估算压缩率这种事，估两次错两次，只能实测。**
     */
    let seed = 0x9e3779b9;
    const bytes = Buffer.alloc(sizeKb * 1024);
    for (let i = 0; i < bytes.length; i += 1) {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      /* 映射到可打印 ASCII，避免生成非法 UTF-8 造成文件读取问题 */
      bytes[i] = 32 + (seed % 95);
    }
    let body = bytes.toString('latin1');
    if (imports) {
      for (const target2 of imports) body += '\nimport"./' + target2 + '";\n';
    }
    writeFileSync(join(assetsDir, name), body, 'utf8');
  }
}

function runAudit(cwd) {
  try {
    const out = execFileSync(process.execPath, [script], { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? '') + (error.stderr ?? '') };
  }
}

const workRoot = mkdtempSync(join(tmpdir(), 'xinyu-budget-'));
try {
  /* ---- 用例 1：达标 ---- */
  {
    const dir = join(workRoot, 'ok');
    makeDist(dir, {
      'index-aaa.js': { sizeKb: 100 },
      'three-bbb.js': { sizeKb: 120 },
      'SandboxPage-ccc.js': { sizeKb: 20 },
      /* 注意：不能有 SafetyPage chunk，否则「危机页在主包」那条会红 */
    });
    const result = runAudit(dir);
    check('达标时退出 0', result.code === 0, 'code=' + result.code + ' ' + result.out.slice(-200));
    check('达标时输出「全部达标」', /全部达标/.test(result.out), result.out.slice(-120));
  }

  /* ---- 用例 2：首屏超线 ---- */
  {
    const dir = join(workRoot, 'heavy');
    /*
     * makeDist 现在产出高熵文本（gzip 几乎压不动，约 1:1.05），
     * 所以 sizeKb 就约等于 gzip 后的 KB。
     * 给 300KB，稳稳越过 210KB 的判失败线，且不卡在线上。
     */
    makeDist(dir, {
      'index-aaa.js': { sizeKb: 300 },
      'three-bbb.js': { sizeKb: 100 },
    });
    const result = runAudit(dir);
    check('首屏超线时退出 1', result.code === 1, 'code=' + result.code);
    check('超线时报出「首屏」', /首屏/.test(result.out), result.out.slice(-200));
  }

  /* ---- 用例 3：SafetyPage 被拆包 ---- */
  {
    const dir = join(workRoot, 'safety-split');
    makeDist(dir, {
      'index-aaa.js': { sizeKb: 80 },
      'three-bbb.js': { sizeKb: 100 },
      'SafetyPage-ddd.js': { sizeKb: 5 },
    });
    const result = runAudit(dir);
    check('SafetyPage 被拆包时退出 1', result.code === 1, 'code=' + result.code);
    check(
      '报出危机页问题',
      /SafetyPage|危机页/.test(result.out),
      result.out.slice(-200),
    );
  }

  /* ---- 用例 4：three 混进主包 ---- */
  {
    const dir = join(workRoot, 'three-inline');
    makeDist(dir, {
      'index-aaa.js': { sizeKb: 80, imports: ['three-bbb.js'] },
      'three-bbb.js': { sizeKb: 100 },
    });
    const result = runAudit(dir);
    check('three 混进主包时退出 1', result.code === 1, 'code=' + result.code);
    check('报出 three 在主包', /three/.test(result.out), result.out.slice(-200));
  }

  /* ---- 用例 5：没有 dist ---- */
  {
    const dir = join(workRoot, 'no-dist');
    mkdirSync(dir, { recursive: true });
    const result = runAudit(dir);
    check('没有 dist 时退出 1（而不是假绿）', result.code === 1, 'code=' + result.code);
  }
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}

console.log('');
if (failures > 0) {
  console.error('✗ ' + failures + ' / ' + checks + ' 项自测失败');
  process.exit(1);
}
console.log('✓ ' + checks + ' 项自测全部通过');
