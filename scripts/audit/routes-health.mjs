/**
 * 路由健康门禁（`npm run audit:routes`）。
 *
 * ── 为什么需要 ──────────────────────────────────────────────────
 *
 * `docs/TESTING.md` §6.2.1 记着一条真实风险：
 *
 * > 改 `useSyncExternalStore` 的 `getSnapshot` 让它每次返回新对象
 * > （典型写法 `return {...state}`），组件会无限重渲染。
 * > **后果：整页白屏，且只在真实浏览器里白。单测全绿。**
 * > E2E 的 12 个场景会兜住 —— 但只在 E2E 跑到的路径上。
 * > **新加的路由如果没进 E2E，白屏就没人发现。**
 *
 * 本轮实测确认了这个缺口：
 *
 *   - 应用有 15 条路由（含 `*` 兜底）
 *   - E2E 只访问了 7 条
 *   - `a11y.ts` 访问了 15 条，但它只查无障碍属性，
 *     **没有一条"页面不是空白"的断言**
 *
 * 也就是说：`/resources`、`/toolbox/breathing-478`、各种 `:id`
 * 页面如果白屏，现有门禁全部是绿的。
 *
 * 这个脚本专门补这一块 —— 成本很低（每条路由一次加载 + 数可见字符），
 * 收益是「所有路由都真的渲染出了东西」变成一个可审计的事实。
 *
 * ── 判定标准 ────────────────────────────────────────────────────
 *
 * 不能只数 `document.body.innerText.length > 0` —— 导航栏和页脚
 * 永远有字，那样即使页面主体白屏也是绿的（典型的幽灵门禁）。
 *
 * 每条路由六层断言：
 *
 *   1. `<main>` 存在
 *   2. `<main>` 内文本量 ≥ MIN_MAIN_TEXT —— 排除空壳
 *   3. `<main>` **真有尺寸**（getBoundingClientRect > 100×100）
 *   4. `<main>` 计算样式可见（display / visibility / opacity）
 *   5. `<main>` 里有非零尺寸的子元素 —— 排除"有字但没排版"
 *   6. `document.title` 非空 + 无运行时错误
 *
 * ── 第 3、4 条是被变异验证逼出来的 ─────────────────────────────
 *
 * 第一版只查 1、2、6，用的是 `main.innerText`。看起来没问题：
 * innerText 按直觉应该跳过隐藏元素。
 *
 * 变异验证时把 `<main>` 改成 `display:none`（模拟"整块没显示"），
 * **60 项检查照样全绿**。
 *
 * 实测 Chrome 的真实语义（tmp/probe-innertext.mjs）：
 *
 *   display:none 的 <main>   → innerText **37 字**（不为 0！）
 *   visibility:hidden        → innerText 0 字
 *
 * 也就是说 `display:none` —— 最常见的"整块没显示"—— 用 innerText
 * 判定是**绿**的。断言的形状对，但**它验证的东西不是用户看到的东西**。
 *
 * 所以加了第 3、4 条几何与样式断言，并把文本量改用 textContent
 * （判断"写进 DOM 的内容量"，与"是否可见"分成两个独立维度，
 * 哪个坏了都能指出是哪个）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { launchPreview } from '../dev/_shared/preview.mjs';

const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
/*
 * 自己起 preview，而不是要求外面先开好服务。
 *
 * 用 `_shared/preview.mjs` 而不是自己 spawn —— 那个文件里记着三个
 * 实测踩过的坑（shell:true 会杀错进程、直接 spawn .cmd 报 EINVAL、
 * stdio:'pipe' 会让 vite 中途退出）。别的浏览器门禁都用它，
 * 这里没有理由另写一份。
 */
const PORT = Number(process.env.ROUTE_PORT ?? 4371);
const DIST_DIR = 'dist';
const SHOT_DIR = 'tmp/shots-routes';

/**
 * 每条路由至少要有的可见文字量。
 *
 * 20 个字符是个保守下界：一个真实的页面（哪怕只有标题 + 一句说明）
 * 都远超这个数，而"只有壳"的页面通常是 0。
 *
 * 故意定得低：这条门禁的目的是抓**白屏**，不是抓"内容太少"。
 * 定高了会因为改了文案就红。
 */
const MIN_MAIN_TEXT = 20;

/** 应用的全部路由（与 src/App.tsx 对齐，含参数示例） */
const ROUTES = [
  { path: '/', name: '首页' },
  { path: '/scales', name: '量表列表' },
  { path: '/scales/phq-9', name: '量表作答' },
  { path: '/sandbox', name: '沙盘工作台' },
  { path: '/sandbox/compare', name: '会话对比' },
  { path: '/sandbox/clients', name: '来访者列表' },
  { path: '/sandbox/session/demo-nonexistent', name: '回放（不存在的会话）' },
  { path: '/sandbox/session/demo-nonexistent/report', name: '报告（不存在的会话）' },
  { path: '/toolbox', name: '工具箱' },
  { path: '/toolbox/breathing-478', name: '工具作答' },
  { path: '/resources', name: '资源页' },
  { path: '/records', name: '记录页' },
  { path: '/safety', name: '安全页（危机资源）' },
  { path: '/about', name: '关于页' },
  { path: '/this-route-does-not-exist', name: '404 兜底' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let checks = 0;
let failures = 0;
const problems = [];

function record(route, name, ok, detail) {
  checks += 1;
  if (ok) {
    console.log(`  ✓ ${route.padEnd(42)} ${name}`);
  } else {
    failures += 1;
    problems.push({ route, name, detail });
    console.error(`  ✗ ${route.padEnd(42)} ${name} — ${detail}`);
  }
}

mkdirSync(SHOT_DIR, { recursive: true });

/* 先起 preview：它读 dist/，所以 `npm run check` 里必须排在 build 之后 */
const preview = await launchPreview({ port: PORT, distDir: DIST_DIR });
const BASE = preview.base;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

console.log('路由健康门禁');
console.log(`  服务器：${BASE}`);
console.log(`  路由数：${ROUTES.length}`);
console.log(`  判定：<main> 有内容 ≥ ${MIN_MAIN_TEXT} 字 + 真有尺寸 + 计算样式可见 + 有可见子元素`);
console.log('');

try {
  for (const route of ROUTES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    try {
      await page.goto(BASE + route.path, {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });
      /* 等懒加载 chunk 落地（与 smoke.ts 的 waitForRouteReady 同义） */
      await page
        .waitForFunction(() => document.querySelector('[data-testid="route-loading"]') === null, {
          timeout: 10000,
        })
        .catch(() => {});
      await sleep(400);

      const info = await page.evaluate(() => {
        const main = document.querySelector('main');

        /*
         * ⚠️ 这里不能用 `main.innerText` 判定白屏 —— 实测过。
         *
         * 直觉上 innerText 会跳过隐藏元素，但 Chrome 里：
         *   display:none 的父元素 → innerText **仍然有文字**（37 字）
         *   visibility:hidden      → innerText 为 0
         *
         * 也就是说 `display:none` 这种最常见的"整块没显示"
         * 用 innerText 判定是**绿**的。变异验证正是这么红我的：
         * 把 <main> 设成 display:none，60 项检查照样全绿。
         *
         * 真正可靠的是几何量：元素必须有非零尺寸，且在视口内。
         * `getBoundingClientRect()` 对 display:none 返回全 0，
         * 对 visibility:hidden 返回真实尺寸 —— 所以还要配上
         * computedStyle 的 visibility/opacity 检查。
         */
        const rect = main?.getBoundingClientRect();
        const style = main ? window.getComputedStyle(main) : null;

        /*
         * 用 textContent 而不是 innerText 数"有没有内容"：
         * 我们要判断的是"写进 DOM 的文本量"，不是"浏览器怎么排版"。
         * 可见性由下面的几何 + 样式断言单独负责。
         * 这样两个维度分开，哪个坏了都能指出是哪个。
         */
        const rawText = (main?.textContent ?? '').replace(/\s+/g, ' ').trim();

        /* 第一个真正可见的子元素，用来确认主体不是空的壳 */
        const firstVisibleChild = (() => {
          if (!main) return null;
          for (const child of Array.from(main.children)) {
            const r = child.getBoundingClientRect();
            const s = window.getComputedStyle(child);
            if (r.width > 8 && r.height > 8 && s.visibility !== 'hidden' && s.display !== 'none') {
              return { tag: child.tagName, w: Math.round(r.width), h: Math.round(r.height) };
            }
          }
          return null;
        })();

        return {
          hasMain: main !== null,
          rawTextLen: rawText.length,
          mainTextPreview: rawText.slice(0, 60),
          /* 几何：display:none 时 rect 全 0 */
          rectW: Math.round(rect?.width ?? 0),
          rectH: Math.round(rect?.height ?? 0),
          /* 样式：visibility:hidden / opacity:0 时 rect 仍有值，靠这个抓 */
          visibility: style?.visibility ?? '',
          display: style?.display ?? '',
          opacity: style?.opacity ?? '',
          firstVisibleChild,
          bodyText: (document.body.textContent ?? '').replace(/\s+/g, ' ').trim().length,
          title: document.title ?? '',
        };
      });

      const textLen = info.rawTextLen;

      record(
        route.path,
        `${route.name}：<main> 存在`,
        info.hasMain,
        '<main> 没有渲染',
      );
      record(
        route.path,
        `${route.name}：<main> 内有内容 ${textLen} 字（≥${MIN_MAIN_TEXT}）`,
        textLen >= MIN_MAIN_TEXT,
        textLen < MIN_MAIN_TEXT
          ? `只有 ${textLen} 字，疑似白屏。body 有 ${info.bodyText} 字（外壳不算数）`
          : '',
      );
      /*
       * 下面两条才是真正抓白屏的。文本量够但整块 display:none /
       * visibility:hidden / 零尺寸，用户看到的依然是白屏。
       */
      record(
        route.path,
        `${route.name}：<main> 真的有尺寸（${info.rectW}×${info.rectH}）`,
        info.rectW > 100 && info.rectH > 100,
        `尺寸 ${info.rectW}×${info.rectH} —— display:none 时 getBoundingClientRect 全 0`,
      );
      record(
        route.path,
        `${route.name}：<main> 可见（display=${info.display} visibility=${info.visibility} opacity=${info.opacity}）`,
        info.display !== 'none' && info.visibility !== 'hidden' && Number(info.opacity) > 0,
        '计算样式表明元素不可见',
      );
      record(
        route.path,
        `${route.name}：<main> 里有可见子元素`,
        info.firstVisibleChild !== null,
        '<main> 下没有任何非零尺寸的子元素',
      );
      record(
        route.path,
        `${route.name}：document.title 非空`,
        info.title.trim().length > 0,
        'title 为空',
      );
      record(
        route.path,
        `${route.name}：无未捕获运行时错误`,
        pageErrors.length === 0,
        pageErrors.slice(0, 2).join(' | '),
      );

      if (
        textLen < MIN_MAIN_TEXT ||
        info.rectW <= 100 ||
        info.rectH <= 100 ||
        info.firstVisibleChild === null ||
        pageErrors.length > 0
      ) {
        const safe = route.path.replace(/[^a-z0-9]+/gi, '_') || 'root';
        await page.screenshot({ path: `${SHOT_DIR}/${safe}.png`, fullPage: true });
      }
    } catch (error) {
      record(route.path, `${route.name}：加载成功`, false, String(error).slice(0, 160));
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await preview.close();
}

console.log('');
console.log('──────────────────────────────────────────────────────');
console.log(`合计：${checks} 项检查，${failures} 项失败`);

if (failures > 0) {
  console.error('');
  console.error('白屏是最难发现的一类缺陷：单测全绿、类型检查全绿、');
  console.error('构建成功，只有真实浏览器里什么都没有。');
  console.error('');
  console.error('常见原因：');
  console.error('  1. useSyncExternalStore 的 getSnapshot 每次返回新对象 → 无限重渲染');
  console.error('  2. 懒加载 chunk 加载失败，但没有 error boundary');
  console.error('  3. 组件内抛异常且没有 error boundary');
  console.error(`截图见 ${SHOT_DIR}/`);
  process.exit(1);
}

console.log('✓ 全部路由都渲染出了实际内容，无运行时错误');
console.log('  —— 这是 §6.2.1 里「新加的路由白屏没人发现」那一半的门禁。');

/*
 * 顺便留一份清单，供人对照：哪些路由被 E2E 覆盖了。
 * 不参与判定（E2E 覆盖是另一件事），但白屏排查时有用。
 */
writeFileSync(
  'tmp/route-health.json',
  JSON.stringify({ routes: ROUTES.map((r) => r.path), checks, failures }, null, 2),
);
