/**
 * `scripts/dev/` 下所有浏览器探针共用的 vite preview 生命周期管理。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 为什么要有这个文件
 * ─────────────────────────────────────────────────────────────────────────────
 * 原来每个探针脚本都自己抄一遍 `spawn('npx.cmd', ['vite','preview',...])`，
 * 于是同一个缺陷被复制了十几份：**每个脚本跑完都泄漏 1 个 vite 孤儿进程**，
 * 继续占着端口。症状很隐蔽 —— 脚本自己的输出永远是「全部通过 / EXIT 0」，
 * 只有下一次运行才报 `ERR_CONNECTION_REFUSED`，或者更坏：
 * 连到上一次残留的旧服务器上，**测的是过期构建**，绿得毫无意义。
 *
 * 抽成一个模块，就是为了让这件事只在一个地方正确，
 * 不再出现「一个脚本修好了、其他十几个还漏」。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 正确姿势（三个坑，全都实测踩过）
 * ─────────────────────────────────────────────────────────────────────────────
 * 1) **不要** `shell: true` + `npx.cmd`。
 *    Windows 上会套一层 cmd.exe：进程树是 cmd.exe → npx → vite。
 *    `child.kill()` 只杀掉 cmd.exe，真正的 vite 进程**变成孤儿继续占端口**。
 *
 * 2) **也不要**去掉 shell 直接 spawn `npx.cmd`。
 *    Node 18+ 的安全变更禁止直接 spawn .cmd/.bat，直接报
 *    `Error: spawn EINVAL`（本机 Node v22.17.1 实测）。
 *
 * 3) **正确做法：绕过 npx 这层壳**，直接用 `process.execPath` 跑 vite 的入口 JS。
 *    进程树只有一层，`child.pid` 就是 vite 本体，`kill()` 就是真 kill。
 *    本来直接用 node_modules/vite/bin/vite.js
 *    的绝对路径可以完全不用在 PATH 里，还避免受 cwd 影响。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ `stdio` 必须是 `'ignore'`，不能用 `'pipe'`
 * ─────────────────────────────────────────────────────────────────────────────
 * 曾经改成 `'pipe'` 想把 vite 的输出收集起来便于诊断，结果 preview
 * **稳定地在中途以 code=-1 退出**（4294967295），表现为
 * 「单独跑一次通过、连着跑两次必挂」，而且失败位置每次都不一样。
 *
 * 原因是管道有缓冲区：父进程这边一旦读取节奏跟不上（我们在跑 puppeteer，
 * 主进程被大量占用），写入端就会阻塞/EPIPE，vite 于是异常退出。
 * `ignore` 把输出丢到 devnull 就完全没有这个问题。
 * 诊断信息改用「退出码 + 端口」传达，足够了。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 使用方式
 * ─────────────────────────────────────────────────────────────────────────────
 * ```js
 * import { startPreview, stopPreview, waitForServer, pickFreePort } from './_shared/preview.mjs';
 *
 * const port = await pickFreePort(4193);        // 首选端口被占就换一个空闲的
 * const preview = startPreview({ port });        // 单进程，kill 即真 kill
 * const base = `http://127.0.0.1:${port}`;
 * try {
 *   if (!(await waitForServer(preview, `${base}/`))) throw new Error('preview 启动超时');
 *   // ... 跑 puppeteer
 * } finally {
 *   await stopPreview(preview);                  // 等它真的断气再返回
 * }
 * ```
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 所有还活着的 preview 子进程。
 *
 * 用途：脚本中途抛未捕获异常、或者被 Ctrl+C 打断时，
 * `finally` 块不保证跑到（比如 `process.exit()` 直接终止）。
 * 在进程 `exit` 事件里兜底 kill 一遍，避免「脚本挂了 → 服务器还留着」。
 */
const live = new Set();

function reapOnExit() {
  for (const child of live) {
    try {
      child.kill();
    } catch {
      /* 已经死了 */
    }
  }
}
process.on('exit', reapOnExit);
/* SIGINT/SIGTERM 不在默认处理下触发 exit 前的 finally，这里显式转成正常退出 */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    reapOnExit();
    process.exit(130);
  });
}

/** vite CLI 入口的绝对路径（不依赖 PATH，也不依赖 npx 外壳） */
export function resolveViteBin(cwd = process.cwd()) {
  const bin = join(cwd, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(bin)) {
    throw new Error(`找不到 vite 入口：${bin}（先 npm install）`);
  }
  return bin;
}

/**
 * 启动 vite preview。**只有一个进程**，返回的 child.pid 就是 vite 本体。
 *
 * 不等待就绪——就绪判断交给 `waitForServer`，因为「怎么算就绪」
 * 和「启动」是两件事，混在一起会导致超时后不知道该怪谁。
 */
export function startPreview({ port, cwd = process.cwd(), extraArgs = [] } = {}) {
  const viteBin = resolveViteBin(cwd);
  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(port), '--strictPort', ...extraArgs],
    {
      cwd,
      /*
       * 必须 `'ignore'`，理由见文件头「stdio 必须是 ignore」一节。
       * 改成 'pipe' 会让 preview 稳定地中途 code=-1 退出。
       */
      stdio: 'ignore',
      /* 不弹黑框（Windows） */
      windowsHide: true,
    },
  );
  live.add(child);
  child.once('exit', () => live.delete(child));
  return child;
}

/**
 * 停掉 preview，并**等到它真的断气**才返回。
 *
 * 只 kill 自己 spawn 的进程就够 —— 因为我们直接跑 node（不经过 cmd.exe /
 * npx 外壳），pid 就是 vite 本体。不要用「按端口 taskkill /T /F」那套：
 * 那是在「已经有孤儿」的前提下打补丁，并发时会误杀别人的服务器。
 *
 * 为什么要等：kill 完之后立刻返回，下一个进程可能马上起来抢同一端口或
 * 残留 socket。更常见的是**上一个实例还在退出过程中**，连续运行时两个
 * 实例短暂并存、互相把对方的服务器打死 —— 表现就是「单独跑通过、
 * 连着跑必挂」。所以这里轮询 exitCode，最多等 8 秒。
 */
export async function stopPreview(child, { timeoutMs = 8000 } = {}) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    live.delete(child);
    return;
  }
  try {
    child.kill();
  } catch {
    /* 忽略 */
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      live.delete(child);
      return;
    }
    await sleep(100);
  }
  /*
   * 兜底：SIGTERM 没杀掉（极少见，但 Windows 上确实出现过）。
   * 只按**自己 spawn 的 pid** 及子进程杀，不碰别人。
   */
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(child.pid, 'SIGKILL');
    }
  } catch {
    /* 已经死了 */
  }
  live.delete(child);
  await sleep(300);
}

/** 端口是否空闲（listen 一次试试） */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/** 让系统分配一个空闲端口（listen(0) 拿到再关掉） */
function systemPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * 挑端口。
 *
 * `preferred` 是脚本原来的默认端口（4173 / 4175 / 4193 ...）。它**只是首选**，
 * 不是硬约束：端口被上次残留的实例、或并发的另一次运行占着时，
 * 就换一个系统分配的空闲端口，而不是撞上去让 `--strictPort` 起不来。
 *
 * 固定端口 + 「起来前先清干净」这套思路的毛病是它默认了单实例，
 * 一旦并发就会互杀；让路是更简单也更安全的做法。
 */
export async function pickFreePort(preferred) {
  if (preferred && (await isPortFree(preferred))) return preferred;
  if (preferred) {
    console.log(`提示：端口 ${preferred} 已被占用，改用系统分配的空闲端口`);
  }
  return systemPort();
}

/**
 * 等 preview 就绪。
 *
 * 返回 true = 就绪；返回 false = 超时；**child 提前退出则抛错**。
 *
 * 「child 已经退出就立刻报错」这一条很关键：否则我们会连上**别人的**
 * （残留的）服务器，然后在一个即将消失的进程上做完整套校验，
 * 得到一份「通过」但完全没验证到本次构建的报告。
 */
export async function waitForServer(child, url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(
        `vite preview 启动即退出（exitCode=${child.exitCode}）。端口 ${new URL(url).port} 可能被占用。`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      /* 还没起来，继续等 */
    }
    await sleep(250);
  }
  return false;
}

/**
 * 起一个 preview 并等到就绪 —— 大部分探针脚本只需要这一个入口。
 * 返回 `{ child, port, base, close }`。**调用方必须 `await close()`**。
 */
export async function launchPreview({
  port: preferred,
  timeoutMs = 30000,
  distDir = 'dist',
  cwd = process.cwd(),
} = {}) {
  if (!existsSync(join(cwd, distDir))) {
    throw new Error(`找不到 ${distDir}/，请先跑 \`npx vite build\``);
  }
  const port = await pickFreePort(preferred);
  const child = startPreview({ port, cwd });
  const base = `http://127.0.0.1:${port}`;
  try {
    const ready = await waitForServer(child, `${base}/`, timeoutMs);
    if (!ready) throw new Error(`vite preview 未能在 ${timeoutMs}ms 内就绪（${base}）`);
  } catch (error) {
    await stopPreview(child);
    throw error;
  }
  return {
    child,
    port,
    base,
    close: () => stopPreview(child),
  };
}
