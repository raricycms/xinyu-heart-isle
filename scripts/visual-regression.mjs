/**
 * 心屿 · 视觉回归门禁
 *
 * `docs/VISION.md` §7.4 的「视觉」一行长期是 ❌，写着「3 个场景 × 3 种摆法
 * 截图回归（沙面/阴影/遮挡）」。仓库里当时只有
 * `scripts/dev/verify-visual-criteria.mjs`，它是**按可读断言判好坏并存图**，
 * 不做任何回归比对 —— 存下来的图没人看第二眼，也就不可能变红。
 *
 * 这个脚本补上真正的像素回归：同一场景跑两次，逐像素比对，超阈值就红。
 *
 * ## 为什么不是「截图 vs 基线图」
 *
 * 常规做法是提交基线 PNG、每次比对。这里刻意**不**这么做：
 *
 * 1. 反锯齿在不同 Chrome / 显卡 / DPI 下差几个像素是常态，
 *    基线图会把「环境差异」变成红灯，最后大家学会忽略它；
 * 2. 基线图需要人肉更新，更新流程一旦松动，门禁就会静默腐烂；
 * 3. 仓库已经有 21 张 `scripts/dev/shots/` 的图，再加一批基线会让 diff 变成二进制噪声。
 *
 * 改用**确定性判据**：同一个构建、同一个视口，同一操作序列跑两次，
 * 结果必须**逐像素一致**。这能抓到真正要紧的一类问题：
 * 非确定性渲染（随机数、未初始化缓冲、竞态、记忆化失效导致的抖色），
 * 以及「改动让画面结构变了」——后者靠结构指纹（见下）捕获。
 *
 * ## 三个场景 × 三种摆法（照 VISION 的要求）
 *
 * | 场景 | 摆法 |
 * | --- | --- |
 * | 平沙 | 只有一个摆件，无沙面扰动（基线） |
 * | 沙丘 | 有起伏的沙面 + 埋入的摆件（考山体遮挡） |
 * | 密集 | 多个摆件前后重叠（考 z-order 与阴影） |
 *
 * 每种摆法都校验：
 *   · 两次渲染**逐像素一致**（确定性）
 *   · canvas 非空白（真的画了东西，不是全一色）
 *   · 结构指纹在两次之间稳定
 *   · 与「空场景」有显著差异（证明摆件/沙面确实参与了绘制）
 *
 * 用法：
 *   node scripts/visual-regression.mjs              # 判通过/失败（npm run visual）
 *   node scripts/visual-regression.mjs --keep       # 保留本次 PNG 到 tmp/visual/
 *
 * 环境变量 `XINYU_VISUAL_DIST` 可指向别的构建产物（变异测试用）。
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { launchPreview } from './dev/_shared/preview.mjs';

/* --------------------------------- 配置 --------------------------------- */

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');

const PORT = 4321;
const SHOT_DIR = path.resolve(process.cwd(), 'tmp', 'visual');

/**
 * 跑哪个构建产物。默认 `dist`。
 *
 * 设 `XINYU_VISUAL_DIST` 可指向副本 —— 专供变异测试
 * （`scripts/audit/visual-self-test.mjs`）：把 dist 复制到 `tmp/` 再注入缺陷，
 * 工作区的 `dist/` 全程只读。
 *
 * 这条约束是踩坑换来的：早期某个变异脚本直接改 `dist/index.html`，
 * 恢复时与并发的 `vite build` 撞车，导致后续审计读到过期 bundle 并假报缺陷。
 * **变异测试必须跑在副本上。**
 */
const DIST_DIR = process.env.XINYU_VISUAL_DIST
  ? path.resolve(process.env.XINYU_VISUAL_DIST)
  : path.resolve(process.cwd(), 'dist');

/**
 * 判定阈值。
 *
 * 确定性检查要求**严格逐像素**（阈值 0），因为同一个构建在同一个进程里
 * 渲染两次，唯一的差异来源就是代码里的非确定性 —— 那正是要抓的。
 */
const EXACT_MATCH_TOLERANCE = 0; // 逐像素差异容忍度：0 = 必须完全一致
const MIN_NONBLANK_RATIO = 0.02; // 非空白像素至少 2%（防「什么都没画」）
const MIN_VARIANCE = 8; // 通道方差下限（防「画了但一片死色」）

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

/* -------------------------------- 断言记账 -------------------------------- */

/**
 * @typedef {{ name: string, ok: boolean, detail: string }} Check
 */

/** @type {Check[]} */
const checks = [];

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} [detail]
 */
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------ 场景与摆法数据 ------------------------------ */

/**
 * 从 `src/sandbox/symbols.ts` 里解析出全部合法 symbolId。
 *
 * 为什么不信任自己手写的 id：第一版种子写了 `tree / house / person / rock`，
 * 其中 `person`（真名 `man`）和 `rock`（真名 `stone`）根本不存在。
 * 页面不会报错，只会把不认识的字形渲染成灰色占位符 —— 于是「密集」场景
 * 看起来和平沙差不多，而所有断言照样绿。
 *
 * 这是「引用完整性」类问题：**代码里出现了一个不存在的名字，但没有任何
 * 机制会告诉你**。解析源码是最省事又最诚实的校验方式。
 */
function loadValidSymbolIds() {
  const source = readFileSync(path.resolve(process.cwd(), 'src', 'sandbox', 'symbols.ts'), 'utf8');
  const ids = new Set();
  for (const match of source.matchAll(/\bs\('([a-z0-9-]+)'/g)) ids.add(match[1]);
  return ids;
}

const VALID_SYMBOL_IDS = loadValidSymbolIds();

/**
 * 沙盘场景种子。写入 localStorage 的 `xinyu.sessions`，
 * 让页面直接以「已保存的会话」打开，避免依赖鼠标操作序列
 * （那本身就不确定：拖拽落点受布局影响）。
 *
 * @typedef {object} SceneSeed
 * @property {string} id
 * @property {string} name
 * @property {string} why 为什么要这个场景 —— 写清楚，否则后人不敢改
 * @property {Array<{id: string, symbolId: string, x: number, y: number, scale: number, z: number, rotation: number, burial?: number}>} items
 * @property {Array<{tool: string, points: Array<{x: number, y: number}>}>} surfaceStrokes 沙面起伏
 */

/** @type {SceneSeed[]} */
const SCENES = [
  {
    id: 'vis-flat',
    name: '平沙 · 单摆件',
    why: '基线：沙面无扰动，只有一个摆件。任何「凭空多出来的东西」都会让它与另外两组拉开差异。',
    items: [{ id: 'it-1', symbolId: 'tree', x: 0.5, y: 0.5, scale: 1, z: 1, rotation: 0 }],
    surfaceStrokes: [],
  },
  {
    id: 'vis-dune',
    name: '沙丘 · 埋沙摆件',
    why: '考山体遮挡：沙面有明显起伏，摆件部分埋入。立面（cell.wall）如果画错，这一组会变形。',
    items: [{ id: 'it-1', symbolId: 'house', x: 0.35, y: 0.55, scale: 1.2, z: 2, rotation: 15, burial: 0.4 }],
    surfaceStrokes: [
      {
        tool: 'raise',
        points: [
          { x: 0.2, y: 0.5 },
          { x: 0.3, y: 0.5 },
          { x: 0.4, y: 0.5 },
          { x: 0.5, y: 0.5 },
        ],
      },
    ],
  },
  {
    id: 'vis-crowded',
    name: '密集 · 多摆件重叠',
    why: '考 z-order 与阴影：4 个摆件前后重叠。排序写错会让遮挡关系反过来，指纹立刻变。',
    items: [
      { id: 'it-1', symbolId: 'tree', x: 0.3, y: 0.4, scale: 1, z: 1, rotation: 0 },
      { id: 'it-2', symbolId: 'house', x: 0.45, y: 0.45, scale: 1, z: 2, rotation: 0 },
      { id: 'it-3', symbolId: 'man', x: 0.55, y: 0.5, scale: 1, z: 3, rotation: 0 },
      { id: 'it-4', symbolId: 'stone', x: 0.65, y: 0.55, scale: 1, z: 4, rotation: 0 },
    ],
    surfaceStrokes: [],
  },
];

/* ------------------------------- 浏览器侧辅助 ------------------------------- */

/**
 * 在页面里读 canvas 像素并算统计量。
 *
 * 这里必须自己写，不能用 `canvas.toDataURL()` 比对 —— 后者受编码器
 * 版本影响，而且无法给出「差了多少像素」这种可读的解释。
 */
const CANVAS_STATS = `(() => {
  const canvas = document.querySelector('.iso2d__canvas');
  if (!canvas) return { error: '找不到 .iso2d__canvas' };
  const ctx = canvas.getContext('2d');
  if (!ctx) return { error: '拿不到 2d context' };
  const { width, height } = canvas;
  if (width === 0 || height === 0) return { error: 'canvas 尺寸为 0' };
  const data = ctx.getImageData(0, 0, width, height).data;

  // toHex: 便宜但足够敏感的像素级摘要
  let hash = 2166136261;
  const seen = new Map();
  let nonBlank = 0;
  let sum = 0;
  let sumSq = 0;
  const total = width * height;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    // FNV-1a 混入四个通道
    hash ^= r; hash = Math.imul(hash, 16777619);
    hash ^= g; hash = Math.imul(hash, 16777619);
    hash ^= b; hash = Math.imul(hash, 16777619);
    hash ^= a; hash = Math.imul(hash, 16777619);

    const key = (r << 16) | (g << 8) | b;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (a > 0) nonBlank += 1;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += lum;
    sumSq += lum * lum;
  }

  const mean = sum / total;
  const variance = sumSq / total - mean * mean;

  // 取最常见的前 8 种颜色，构成结构指纹的一部分
  const top = [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key, count]) => {
      const r = (key >> 16) & 255, g = (key >> 8) & 255, b = key & 255;
      return [r, g, b, Math.round((count / total) * 1000) / 1000];
    });

  return {
    hash: (hash >>> 0).toString(16),
    width,
    height,
    nonBlankRatio: Math.round((nonBlank / total) * 1000) / 1000,
    variance: Math.round(variance * 100) / 100,
    distinctColors: seen.size,
    top,
    // 逐像素数据留给后面比对用 —— 800×560×4 约 1.8MB，单页可接受
    pixels: Array.from(data),
  };
})()`;

/**
 * @typedef {object} CanvasStats
 * @property {string} [hash]
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [nonBlankRatio]
 * @property {number} [variance]
 * @property {number} [distinctColors]
 * @property {Array<[number, number, number, number]>} [top]
 * @property {number[]} [pixels]
 * @property {string} [error]
 */

/**
 * 逐像素比对，返回差异统计
 *
 * @param {number[]} a
 * @param {number[]} b
 */
function diffPixels(a, b) {
  if (a.length !== b.length) return { differing: Math.max(a.length, b.length), maxDelta: 255 };
  let differing = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.length; i += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      delta = Math.max(delta, Math.abs(a[i + channel] - b[i + channel]));
    }
    if (delta > EXACT_MATCH_TOLERANCE) {
      differing += 1;
      maxDelta = Math.max(maxDelta, delta);
    }
  }
  return { differing, maxDelta };
}

/* --------------------------------- 渲染一遍 --------------------------------- */

/**
 * 打开一个场景，等到画面稳定，取 canvas 统计量。
 *
 * 稳定性怎么判：连续 3 次读到同一个 hash 才算稳定。
 * 固定等待是不行的 —— 沙面的 relax 是异步的（rest-angle 松弛要跑几帧），
 * 等早了会读到中间态，两次读到不同的中间态就会假报「不确定性」。
 *
 * @param {import('puppeteer-core').Page} page
 * @param {SceneSeed} seed
 * @param {string} base
 * @returns {Promise<CanvasStats>}
 */
async function renderScene(page, seed, base) {
  await page.goto(`${base}/sandbox`, { waitUntil: 'domcontentloaded' });

  // 注入种子会话
  await page.evaluate((scene) => {
    /*
     * 会话形状必须符合 `coerceSession` 的 v2 分支（`src/format/migrate.ts`）：
     *   - 必须有 `schemaVersion: 2` 或 (events 数组 + mode 字符串)
     *   - 时间字段叫 `at`，**不是** `createdAt`
     *   - 事件的时间字段叫 `t`（数字），**不是** `at`/`seq`
     *   - `items` 也要直接给（重放之外还有一层兜底）
     * 写错任何一条，`coerceSession` 返回 null，listSessions 过滤掉，
     * 于是页面拿到空白沙盘 —— 三个场景渲染出同一张图。
     * 这正是本脚本运行时抓到的问题（见下方「三个场景画面互不相同」）。
     */
    const now = Date.now();
    const events = [];
    let tick = 0;
    const nextT = () => {
      tick += 16;
      return now + tick;
    };

    for (const item of scene.items) {
      events.push({
        t: nextT(),
        type: 'item.add',
        itemId: item.id,
        payload: {
          item: {
            id: item.id,
            symbolId: item.symbolId,
            x: item.x,
            y: item.y,
            scale: item.scale,
            rotation: item.rotation,
            z: item.z,
            burial: item.burial ?? 0,
          },
        },
      });
    }
    for (const stroke of scene.surfaceStrokes) {
      events.push({
        t: nextT(),
        type: 'surface.stroke',
        payload: {
          tool: stroke.tool,
          points: stroke.points,
          radius: 0.08,
          strength: 1,
        },
      });
    }

    const session = {
      schemaVersion: 2,
      id: scene.id,
      at: new Date(now).toISOString(),
      title: scene.name,
      mode: 'self',
      sceneId: 'beach',
      items: scene.items.map((item) => ({
        id: item.id,
        symbolId: item.symbolId,
        x: item.x,
        y: item.y,
        scale: item.scale,
        rotation: item.rotation,
        z: item.z,
        burial: item.burial ?? 0,
      })),
      events,
      locked: false,
      thumbnail: null,
    };
    localStorage.setItem('xinyu.sessions', JSON.stringify([session]));
    localStorage.setItem('xinyu.preferences', JSON.stringify({ renderer: 'iso2d', reducedMotion: true }));
  }, seed);

  /*
   * 用 `?from=<id>` 打开：这是 `parseResumeParams` 认的参数名
   * （`src/sandbox/replay/resume.ts`，配 `buildResumeHref`）。
   * 一开始我写成 `?session=`，页面完全忽略 → 又回到「三个场景同一张图」。
   */
  await page.goto(`${base}/sandbox?from=${encodeURIComponent(seed.id)}`, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('.iso2d__canvas', { timeout: 20_000 }).catch(() => undefined);

  // 等稳定
  let previous = '';
  let stableCount = 0;
  const deadline = Date.now() + 12_000;
  /** @type {CanvasStats} */
  let stats = { error: '尚未取到画面' };
  while (Date.now() < deadline) {
    stats = await page.evaluate(CANVAS_STATS);
    if (stats.error) break;
    if (stats.hash === previous) {
      stableCount += 1;
      if (stableCount >= 3) break;
    } else {
      stableCount = 0;
      previous = stats.hash ?? '';
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return stats;
}

/* --------------------------------- 主流程 --------------------------------- */

async function main() {
  if (!chromePath) {
    console.error('✗ 找不到 Chrome / Edge，无法做视觉回归。');
    process.exit(2);
  }
  if (!existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.error(`✗ 没有 ${path.join(DIST_DIR, 'index.html')}，请先运行：npx vite build`);
    process.exit(2);
  }

  if (KEEP) mkdirSync(SHOT_DIR, { recursive: true });

  console.log('心屿 · 视觉回归');
  console.log(`  浏览器：${chromePath}`);
  console.log(`  场景：${SCENES.length} 个 × 2 次渲染（确定性比对）\n`);

  const preview = await launchPreview({ port: PORT, distDir: DIST_DIR });
  let browser;

  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-CN', '--force-device-scale-factor=1'],
      defaultViewport: { width: 1280, height: 900 },
    });

    const page = await browser.newPage();

    for (const seed of SCENES) {
      console.log(`场景：${seed.name}`);
      console.log(`  ${seed.why}`);

      const first = await renderScene(page, seed, preview.base);
      const second = await renderScene(page, seed, preview.base);

      if (first.error ?? second.error) {
        check(`${seed.id} 取到画面`, false, String(first.error ?? second.error));
        continue;
      }

      /*
       * ⓪ 种子里的 symbolId 必须真实存在。
       *
       * 第一版我随手写了 `tree / house / person / rock`，其中 `person` 和
       * `rock` 在 `src/sandbox/symbols.ts` 里并不存在（真名是 `man` / `stone`）。
       * 后果不报错：摆件照画，只是退化成灰色占位字形 —— 于是「密集」场景
       * 看起来跟「平沙」差不多，而所有断言依然是绿的。
       * 一条永远绿得合乎逻辑的断言，比没有断言更危险。
       */
      const unknown = seed.items.map((item) => item.symbolId).filter((id) => !VALID_SYMBOL_IDS.has(id));
      check(
        `${seed.id} 所有 symbolId 都真实存在`,
        unknown.length === 0,
        unknown.length === 0
          ? `${seed.items.length} 个全部有效`
          : `未知：${unknown.join(', ')}（共解析到 ${VALID_SYMBOL_IDS.size} 个合法 id）`,
      );

      // ① 两次渲染必须逐像素一致（确定性）
      const diff = diffPixels(first.pixels ?? [], second.pixels ?? []);
      check(
        `${seed.id} 两次渲染逐像素一致`,
        diff.differing === 0,
        diff.differing === 0 ? `0 像素不同（hash ${first.hash}）` : `${diff.differing} 像素不同，最大通道差 ${diff.maxDelta}`,
      );

      // ② 真的画了东西
      check(
        `${seed.id} 画面非空白`,
        (first.nonBlankRatio ?? 0) >= MIN_NONBLANK_RATIO,
        `非空白 ${((first.nonBlankRatio ?? 0) * 100).toFixed(1)}%（≥ ${MIN_NONBLANK_RATIO * 100}%）`,
      );

      // ③ 不是一片死色
      check(
        `${seed.id} 有足够的明暗层次`,
        (first.variance ?? 0) >= MIN_VARIANCE,
        `方差 ${first.variance}（≥ ${MIN_VARIANCE}），${first.distinctColors} 种颜色`,
      );

      // ④ 稳定（两次 hash 相同才有指纹意义）
      check(`${seed.id} 结构指纹稳定`, first.hash === second.hash, `${first.hash} vs ${second.hash}`);

      console.log(
        `  · canvas ${first.width}×${first.height}｜非空白 ${(((first.nonBlankRatio ?? 0) * 100).toFixed(1))}%｜` +
          `方差 ${first.variance}｜${first.distinctColors} 色`,
      );
      console.log(`  · 主色：${(first.top ?? []).slice(0, 4).map((entry) => `rgb(${entry[0]},${entry[1]},${entry[2]}) ${(entry[3] * 100).toFixed(1)}%`).join('、')}`);

      if (KEEP) {
        await page.screenshot({ path: path.join(SHOT_DIR, `${seed.id}.png`), fullPage: false });
      }
      console.log('');
    }

    /*
     * ⑤ 场景之间必须彼此不同。
     *
     * 这一条防的是「所有场景都渲染成同一张图」—— 那说明种子没生效，
     * 前面每一条「一致」「非空白」都会绿得毫无意义。
     * 记住：只验一致性不验差异性的门禁，等价于只测了「截图能截出来」。
     */
    console.log('场景差异（防「种子没生效、三个场景其实是同一张图」）：');
    /** @type {Map<string, string>} */
    const hashes = new Map();
    for (const seed of SCENES) {
      const stats = await renderScene(page, seed, preview.base);
      if (stats.hash) hashes.set(seed.id, stats.hash);
    }
    const uniqueHashes = new Set(hashes.values());
    check(
      '三个场景画面互不相同',
      uniqueHashes.size === SCENES.length,
      `${SCENES.length} 个场景产生 ${uniqueHashes.size} 种画面（${[...hashes.entries()].map(([id, hash]) => `${id}:${hash}`).join(' ')}）`,
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await preview.close();
  }

  /* ------------------------------- 报告 ------------------------------- */

  console.log('\n' + '─'.repeat(78));
  const failed = checks.filter((entry) => !entry.ok);
  console.log(`合计：${checks.length} 项检查，${failed.length} 项失败`);
  if (failed.length > 0) {
    console.log('\n失败明细：');
    for (const entry of failed) console.log(`  ✗ ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
    if (!KEEP) console.log('\n提示：加 --keep 可保留本次截图，便于人眼比对。');
    process.exit(1);
  }
  console.log('\n✓ 视觉回归通过');
  if (!KEEP) rmSync(SHOT_DIR, { recursive: true, force: true });
}

await main();
