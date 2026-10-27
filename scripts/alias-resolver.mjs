/**
 * `alias-loader.mjs` 的解析实现（跑在独立的 loader 线程里）。
 *
 * 只做一件事：把 `@/foo` 解析成 `<src>/foo`。
 *
 * ── 为什么要单独一个文件 ────────────────────────────────────────
 *
 * `register()` 的钩子在独立线程执行，模块级变量不共享，
 * 映射表必须通过 `data` 传入。
 *
 * ── 这个文件踩过的三个坑（都表现为「静默不生效」）──────────────
 *
 * 1. **`initialize` 必须收 `data`。**
 *    第一版写成无参 `initialize()`，于是 `srcUrl` 一直是空串，
 *    拼出的路径全不存在，最后落到 `nextResolve` 报
 *    `Cannot find package '@/lib'` —— 看起来像钩子没注册，
 *    其实注册了但数据没进去。现在收不到 `srcUrl` 会直接抛错。
 *
 * 2. **`srcUrl` 必须以 `/` 结尾。**
 *    `new URL('lib/storage', 'file:///.../src')` 的结果是
 *    `file:///.../lib/storage` —— **把 `src` 整个替换掉了**，
 *    因为 URL 把不带尾斜杠的最后一段当成文件名。
 *    表现同样是"@/ 命中了但全部未命中"。
 *
 * 3. **`@` 开头的 specifier 会被 Node 先当 npm scope 包。**
 *    默认路径下 Node 在包解析阶段就会失败，**但 resolve 钩子先于它执行**，
 *    所以只要钩子返回合法 `url` 并设 `shortCircuit: true`，就能拦住。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @type {string} 以 `file://` 开头、**以 `/` 结尾**的 src 目录 URL */
let srcUrl = '';

/**
 * @param {{ srcUrl: string }} data
 */
export function initialize(data) {
  const raw = data?.srcUrl ?? '';
  if (!raw) {
    throw new Error('alias-resolver: 未收到 srcUrl，请用 alias-loader.mjs 注册');
  }
  /* 坑 2：必须以斜杠结尾，否则 `new URL(rel, base)` 会替换掉最后一段 */
  srcUrl = raw.endsWith('/') ? raw : `${raw}/`;
}

/** 候选后缀：按 Vite 的默认解析顺序 */
const SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/**
 * @param {string} specifier
 * @param {object} context
 * @param {(specifier: string, context: object) => Promise<object>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) {
    return nextResolve(specifier, context);
  }

  /* `@/lib/storage` -> `<src>/lib/storage` */
  const rel = specifier.slice(2);
  const basePath = fileURLToPath(new URL(rel, srcUrl));

  for (const suffix of SUFFIXES) {
    const candidate = basePath + suffix;
    if (existsSync(candidate)) {
      return {
        url: pathToFileURL(candidate).href,
        /*
         * 坑 3：必须 shortCircuit。
         * 否则 Node 还会继续走默认的「npm 包解析」，
         * 在那里因为 `@/lib` 不是合法包名而失败。
         */
        shortCircuit: true,
      };
    }
  }

  /*
   * 找不到时**不要**编一个假路径返回 —— 让 Node 自己报错，
   * 错误信息里会带上原始 specifier，比自造的报错更好查。
   */
  return nextResolve(specifier, context);
}
