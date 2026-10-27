/**
 * `SECURITY.md` 里的安全声明必须与代码一致。
 *
 * ── 为什么安全声明比技术断言更需要门禁 ────────────────────────────
 *
 * 一个架构描述过时了，读者可能只是困惑。但一条**安全声明**过时了，
 * 读者会据此做出错误的风险判断 —— 例如看到「全仓库不使用
 * dangerouslySetInnerHTML」就认为没有 XSS 注入点。
 *
 * 这类声明还有一个特点：**它是"否定性"的**（"不使用 X"、"没有 Y"）。
 * 否定性声明没法靠「读一遍代码确认存在」来验证，只能靠**全仓库扫描**
 * —— 也就是说，它天然适合做成门禁，而天然不适合靠人工检查。
 *
 * 「现在没有」和「永远不会有人加进来」是两件事。
 * 门禁管的是前者在每一刻都成立。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const security = readFileSync('SECURITY.md', 'utf8');

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

/* ── 收集全部生产源文件（排除测试）────────────────────────────── */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      if (/\.(test|spec)\.(ts|tsx)$/.test(name)) continue;
      out.push(p);
    }
  }
  return out;
}

const files = walk('src');
const contents = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

function findHits(pattern) {
  const hits = [];
  for (const [file, text] of contents) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (pattern.test(lines[i])) hits.push(`${file}:${i + 1}`);
    }
  }
  return hits;
}

console.log('');
console.log('SECURITY.md 安全声明核对');
console.log(`  （扫描 ${files.length} 个生产源文件，已排除 *.test.*）`);
console.log('');

/* ── 声明 1：不使用 dangerouslySetInnerHTML ── */
{
  item('SECURITY.md 确实声明了不使用 dangerouslySetInnerHTML',
    /不使用\*\*\s*`dangerouslySetInnerHTML`|不使用\s*`dangerouslySetInnerHTML`/.test(security),
    '声明缺失或措辞已改');
  const hits = findHits(/dangerouslySetInnerHTML/);
  item('代码里确实没有 dangerouslySetInnerHTML', hits.length === 0, hits.join(', '));
}

/* ── 声明 2（补充）：没有 innerHTML 赋值 ── */
/*
 * SECURITY.md 没写这一条，但它是同一条防线的另一半：
 * dangerouslySetInnerHTML 只是 React 的写法，直接 .innerHTML = 一样危险。
 * 门禁顺手守住，并在文档里说清。
 */
{
  const hits = findHits(/\.innerHTML\s*=/);
  item('代码里没有 .innerHTML 直接赋值', hits.length === 0, hits.join(', '));
}

/* ── 声明 3（补充）：没有 eval / new Function ── */
{
  const hits = findHits(/\beval\s*\(|new\s+Function\s*\(/);
  item('代码里没有 eval / new Function', hits.length === 0, hits.join(', '));
}

/* ── 声明 4：零后端 ── */
{
  item('SECURITY.md 声明了「纯前端、零后端、无账号」',
    /纯前端.*零后端.*无账号/.test(security), '声明缺失');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const deps = Object.keys(pkg.dependencies ?? {});
  const serverish = deps.filter((d) =>
    /express|koa|fastify|hapi|nest|socket\.io|ws$|axios|node-fetch|got$/.test(d));
  item('运行时依赖里没有服务端框架或 HTTP 客户端', serverish.length === 0,
    serverish.join(', '));

  /* 没有后端代码目录 */
  const backendDirs = ['server', 'api', 'backend', 'src/server', 'src/api']
    .filter((d) => existsSync(d));
  item('仓库里没有 server/api/backend 目录', backendDirs.length === 0,
    backendDirs.join(', '));
}

/* ── 声明 5：数据只存在浏览器里 ── */
{
  item('SECURITY.md 声明数据存在 localStorage + IndexedDB',
    /localStorage/.test(security) && /IndexedDB/i.test(security), '声明缺失');

  const storage = readFileSync('src/lib/storage.ts', 'utf8');
  item('storage.ts 用 localStorage', /localStorage/.test(storage), '未找到');
  item('idb.ts 用 indexedDB', /indexedDB/i.test(readFileSync('src/lib/idb.ts', 'utf8')), '未找到');
}

/* ── 声明 6：不使用 postinstall 脚本的包 ── */
{
  item('SECURITY.md 声明不使用带 postinstall 的包', /postinstall/.test(security), '声明缺失');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  item('本项目自己没有 postinstall 脚本',
    !(pkg.scripts ?? {}).postinstall, 'package.json 里有 postinstall');
}

/* ── 声明 7：数据不出设备 → 全仓库无上传调用 ── */
/*
 * 这是整个项目最强的一条承诺（"数据不出设备"）。
 * 它必须能被机械验证：任何 fetch/XHR/WebSocket/sendBeacon 都算违背。
 *
 * 例外：静态资源加载（本仓库不用 fetch 加载资源，都是 import），
 * 所以这条可以零例外。
 */
{
  item('SECURITY.md / README 声明数据不出设备',
    /数据不出设备|无网络传输|没有网络传输/.test(security) ||
      /数据不出设备/.test(readFileSync('README.md', 'utf8')),
    '声明缺失');

  const netHits = findHits(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|import\s*\(['"]https?:/);
  item('代码里没有任何网络请求调用（fetch/XHR/WebSocket/sendBeacon）',
    netHits.length === 0, netHits.join(', '));
}

console.log('');
console.log(`合计：${checks} 项，${failures} 项失败`);
if (failures > 0) process.exit(1);
console.log('✓ SECURITY.md 的每一条安全声明都与代码一致');
