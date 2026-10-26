/**
 * a11y 门禁的变异验证 —— **在 dist 的副本上跑**，绝不改工作区的 dist。
 *
 * 为什么改成副本：
 * 上一版直接改 `dist/index.html` 再恢复。有一次恢复时撞上另一条命令的
 * `vite build`，`index.html` 恢复成「旧 bundle hash」而被覆盖成「新 hash」之前的
 * 中间态，于是紧接着的两次审计读到**过期的 bundle**，报出 7 个根本不存在的
 * `keyboard-unreachable`。这跟「在共享工作区 git checkout 做 A/B」是同一类错误：
 * **变异测试污染了被测对象本身。**
 *
 * 现在的做法：
 *   1. 把 dist 整个复制到 tmp/mut-dist/；
 *   2. 变异只写 tmp/mut-dist/index.html；
 *   3. 用环境变量把 a11y 的 dist 指向副本；
 *   4. 跑完删副本。
 * 工作区的 dist 全程只读。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC_DIST = join(ROOT, 'dist');
const MUT_DIST = join(ROOT, 'tmp', 'mut-dist');
const INDEX = join(MUT_DIST, 'index.html');

/** 每条变异：注入的 script、预期命中的规则名、预期是否失败 */
const MUTATIONS = [
  {
    name: 'keyboard-unreachable（孤立 tabindex=-1 按钮）',
    expectRule: 'keyboard-unreachable',
    expectFail: true,
    script: `function go(){
      var b = document.createElement('button');
      b.textContent = '孤立按钮';
      b.setAttribute('tabindex','-1');
      b.style.cssText = 'min-width:44px;min-height:44px';
      document.body.appendChild(b);
    }`,
  },
  {
    name: 'roving tabindex 合法组（反向：不应误报）',
    expectRule: 'keyboard-unreachable',
    expectFail: false,
    script: `function go(){
      var wrap = document.createElement('div');
      wrap.setAttribute('role','toolbar');
      wrap.setAttribute('aria-label','测试工具栏');
      for (var i = 0; i < 5; i++) {
        var b = document.createElement('button');
        b.textContent = '项' + i;
        b.setAttribute('tabindex', i === 0 ? '0' : '-1');
        b.style.cssText = 'min-width:44px;min-height:44px';
        wrap.appendChild(b);
      }
      document.body.appendChild(wrap);
    }`,
  },
  {
    name: 'heading-order（h1 -> h4 跳级）',
    expectRule: 'heading-order',
    expectFail: true,
    script: `function go(){
      var h = document.createElement('h4');
      h.textContent = '跳级标题';
      document.body.appendChild(h);
    }`,
  },
  {
    name: 'target-size（8px 小按钮）',
    expectRule: 'target-size',
    expectFail: true,
    script: `function go(){
      var b = document.createElement('button');
      b.textContent = '×';
      b.style.cssText = 'width:8px;height:8px;padding:0;border:0';
      document.body.appendChild(b);
    }`,
  },
  {
    name: 'html-lang（去掉 lang 属性）',
    expectRule: 'html-lang',
    expectFail: true,
    script: null, // 特殊处理：直接改 <html lang>
  },
  {
    name: 'image-alt（无 alt 的图片）',
    expectRule: 'image-alt',
    expectFail: true,
    script: `function go(){
      var img = document.createElement('img');
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      document.body.appendChild(img);
    }`,
  },
];

function runAudit(route) {
  try {
    const out = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', 'scripts/audit/a11y.ts', route],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 300_000,
        env: { ...process.env, XINYU_A11Y_DIST: MUT_DIST },
      },
    );
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? -1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

if (!existsSync(join(SRC_DIST, 'index.html'))) {
  console.error('✗ 没有 dist/index.html，先 npx vite build');
  process.exit(2);
}

/**
 * 从 index.html 里抽出它引用的 bundle 文件名。
 * 用来做「产物自洽」检查，见下面 assertAssetsExist。
 */
function bundleRefsOf(html) {
  return [...html.matchAll(/\/assets\/([A-Za-z0-9._-]+\.(?:js|css))/g)].map((match) => match[1]);
}

/**
 * 「产物自洽」守卫 —— 这条是拿半小时的假故障换来的。
 *
 * 曾经的真实故障：`dist/index.html` 引用了 `index-ona4T-I6.js`，而
 * `dist/assets/` 里只有 `index-CC-iJE1F.js`。页面照样打开（HTML 200），
 * 但加载不到真正的应用代码，于是 DOM 是空的/半成品，审计报出
 * **7 个根本不存在的 `keyboard-unreachable`**。
 *
 * 那个症状看起来完全像「产品有 bug」，害我去 grep 源码里谁设了
 * `tabindex="-1"`（实际一处都没有）。如果这里先断言「index.html 引用的
 * 资源必须真实存在」，一秒钟就能定位到「产物不同步」，而不是产品问题。
 */
function assertAssetsExist(dir, html) {
  const missing = bundleRefsOf(html).filter(
    (name) => !existsSync(join(dir, 'assets', name)),
  );
  if (missing.length > 0) {
    console.error(
      `✗ 产物不自洽：${dir}/index.html 引用了不存在的资源：\n` +
        missing.map((name) => `    ${name}`).join('\n') +
        '\n  这说明 index.html 与 assets/ 来自不同的构建（多半是构建期间被并发改写）。\n' +
        '  在这种产物上跑出的任何「规则命中」都不可信，直接重跑 npx vite build。',
    );
    process.exit(2);
  }
}

// 干净的副本
rmSync(MUT_DIST, { recursive: true, force: true });
mkdirSync(MUT_DIST, { recursive: true });
cpSync(SRC_DIST, MUT_DIST, { recursive: true });
const pristine = readFileSync(INDEX, 'utf8');

/*
 * 起点就断言产物自洽：源 dist 与刚复制出的副本都必须「引用的资源真实存在」。
 * 只要这一步过了，后面所有变异结果才有意义。
 */
assertAssetsExist(SRC_DIST, readFileSync(join(SRC_DIST, 'index.html'), 'utf8'));
assertAssetsExist(MUT_DIST, pristine);
console.log('产物自洽检查 ✓（index.html 引用的资源均存在）');

let failures = 0;

/* 前置：未变异时副本必须绿（否则后面所有结论都不成立） */
{
  const result = runAudit('/about');
  const ok = result.code === 0;
  console.log(`前置检查（未变异副本应通过）：exit=${result.code} ${ok ? '✓' : '✗'}`);
  if (!ok) {
    console.log(result.out.split('\n').slice(-8).join('\n'));
    failures += 1;
  }
}

for (const mutation of MUTATIONS) {
  console.log(`\n变异：${mutation.name}`);
  let mutated;
  if (mutation.script === null) {
    // html-lang：去掉 lang
    mutated = pristine.replace(/<html lang="[^"]*"/, '<html');
  } else {
    const inject = `<script>\n(function(){\n  ${mutation.script}\n  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);\n  else go();\n})();\n</script>`;
    mutated = pristine.replace('</body>', `${inject}\n</body>`);
  }
  if (mutated === pristine) {
    console.log(`  ✗ 变异没有生效（替换没命中），无法验证`);
    failures += 1;
    continue;
  }
  writeFileSync(INDEX, mutated, 'utf8');

  const result = runAudit('/about');
  const ruleHit = result.out.includes(mutation.expectRule);
  const failed = result.code === 1;

  if (mutation.expectFail) {
    const ok = ruleHit && failed;
    console.log(`  规则命中=${ruleHit} exit=${result.code}（期望 1） ${ok ? '✓' : '✗'}`);
    if (!ok) {
      console.log(result.out.split('\n').slice(-8).join('\n'));
      failures += 1;
    }
  } else {
    const ok = !ruleHit && result.code === 0;
    console.log(`  误报=${ruleHit}（期望 false） exit=${result.code}（期望 0） ${ok ? '✓' : '✗'}`);
    if (!ok) {
      console.log(result.out.split('\n').slice(-8).join('\n'));
      failures += 1;
    }
  }

  writeFileSync(INDEX, pristine, 'utf8');
}

/* 收尾：副本恢复原样后必须绿（证明变异确实被撤销） */
{
  const result = runAudit('/about');
  const ok = result.code === 0;
  console.log(`\n收尾检查（副本已复原应通过）：exit=${result.code} ${ok ? '✓' : '✗'}`);
  if (!ok) failures += 1;
}

rmSync(MUT_DIST, { recursive: true, force: true });

console.log(`\n${failures === 0 ? '✓ 全部变异被正确捕获/豁免' : `✗ ${failures} 项变异验证失败`}`);
process.exit(failures === 0 ? 0 : 1);
