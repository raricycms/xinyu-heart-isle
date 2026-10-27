/**
 * Node ESM 解析钩子：把 `@/xxx` 映射到 `src/xxx`。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 *
 * 项目里 `src/**` 统一用 `@/` 别名（`tsconfig.app.json` 的 `paths`）。
 * Vite 构建时由 Vite 解析，但**直接在 Node 里跑 `.ts` 就不认**：
 *
 *     $ node --experimental-strip-types scripts/validate-pack.ts x.json
 *     Cannot find package '@/lib' imported from .../packs.ts
 *
 * 于是所有 CLI 校验器都面临同一个选择：要么复制一份判定逻辑
 * （两份实现必然漂移），要么让 Node 学会认这个别名。
 *
 * `scripts/validate-session.ts` 之所以没这个问题，纯属运气 ——
 * 它的判定模块 `src/format/sandplay.ts` 里 `@/lib/types` 只是
 * `import type`，编译期被擦除，运行时不存在。但
 * `src/sandbox/library/packs.ts` 在**运行时**导入了 `@/lib/storage`，
 * 擦不掉。
 *
 * ── 为什么不改 src 的写法 ───────────────────────────────────────
 *
 * 把 `@/` 改成相对路径能省掉这个钩子，但那是为了迁就脚本去改产品代码，
 * 而且会把 `../../../lib/storage` 这种路径散到各处。钩子只影响脚本，
 * 是更小的改动面。
 *
 * ── 用法 ────────────────────────────────────────────────────────
 *
 *     node --experimental-strip-types \
 *          --import ./scripts/alias-loader.mjs \
 *          scripts/validate-pack.ts mypack.symbolpack.json
 *
 * 或者直接用 `npm run validate:pack`。
 *
 * ── 这里踩过一个 Windows 专属的坑 ──────────────────────────────
 *
 * 第一版是这么写的：
 *
 *     const SRC_URL = pathToFileURL(new URL('../src/', import.meta.url).pathname).href;
 *
 * 在 Windows 上错两次：
 *
 * 1. `new URL('../src/', import.meta.url).pathname` 得到
 *    `/C:/Users/.../src/`（**带前导斜杠**）。再喂给 `pathToFileURL()`
 *    就成了 `file:///C:/C:/Users/.../src/` —— 双盘符，永远不存在。
 * 2. 更隐蔽的是基准：`--import` 时 `import.meta.url` 指向的模块
 *    与预期不同，`'../src/'` 相对它解析出来的是 `scripts/src/`。
 *
 * 表现是钩子"静默不生效"：文件能加载、`register()` 也调了，
 * 但解析依然失败，报错还是那句 `Cannot find package '@/lib'`。
 *
 * 正确做法：用 `fileURLToPath(import.meta.url)` 拿真实文件路径，
 * 再用 `resolve()` / `dirname()` 拼，全程不碰 URL 的 pathname。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

/** 本文件所在目录（`<repo>/scripts`） */
const here = dirname(fileURLToPath(import.meta.url));

/** 仓库根，再由它拼出 `src/` —— 比相对 `import.meta.url` 可靠 */
const srcDir = resolve(here, '..', 'src');

/**
 * 解析钩子在**独立线程**里跑，拿不到本模块的变量，
 * 所以把映射表通过 `data` 传过去。
 */
register('./alias-resolver.mjs', import.meta.url, {
  data: {
    srcUrl: pathToFileURL(srcDir).href,
    /* 路径分隔符也传过去：钩子线程里拼候选路径用 */
    sep: process.platform === 'win32' ? '\\' : '/',
  },
});
