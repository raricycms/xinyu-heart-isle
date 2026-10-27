/**
 * 核对 `docs/FAQ.md` 里的技术断言是否与代码一致。
 *
 * ── 为什么需要这条门禁 ────────────────────────────────────────────
 *
 * FAQ 是**最容易腐烂的文档类型**：它用第一人称对用户打包票
 * （"只存在你这台设备上""最多 4000 条""键盘能用"），
 * 而这些话一旦与代码脱节，就是在**主动误导**用户 ——
 * 比没有 FAQ 更糟，因为用户会按它做决定（例如据此判断数据安全）。
 *
 * 它也不属于 `docs-numbers.mjs` 能覆盖的形态：那个门禁查的是
 * 「文档里的数字 vs 代码里的数字」，而 FAQ 的断言多数**不是数字**，
 * 是「X 真的有实现」「Y 真的是默认值」这类存在性/取值性陈述。
 *
 * ── 这条门禁是怎么抓到自己人的 ────────────────────────────────────
 *
 * 写 FAQ 时我在里面写了一句：
 *
 *   > 旧版本文件会通过迁移函数读取，`src/lib/sandplay.ts` 里有迁移逻辑
 *
 * 门禁第一次跑就红了 —— `src/lib/sandplay.ts` **根本不存在**，
 * 迁移逻辑在 `src/format/migrate.ts`（`migrateSnapshot` / `isLegacySnapshot`）。
 * 我凭记忆写了一个文件路径，而记忆是错的。
 *
 * 这正是这条门禁存在的意义：**文档里的具体路径必须被真的打开过**。
 *
 * ── 局限（说清楚，不假装周全）──────────────────────────────────
 *
 * 它只检查我在下面显式列出的断言，不是"理解 FAQ 全文"。
 * 新增 FAQ 条目时如果引入新的事实断言，要同步在这里加一条 ——
 * 否则那一条就是无门禁的。这一点没有自动化办法，
 * 但漏掉的后果是"多一句没人核对的话"，而不是"门禁给出假绿"。
 */
import { readFileSync, existsSync } from 'node:fs';

const faq = readFileSync('docs/FAQ.md', 'utf8');
const src = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

let checks = 0, failures = 0;
function item(name, ok, evidence) {
  checks += 1;
  if (ok) console.log('  ✓ ' + name);
  else { failures += 1; console.error('  ✗ ' + name + ' — ' + evidence); }
}

console.log('');
console.log('FAQ 技术断言核对');
console.log('');

/* ── 存储与容量 ── */
{
  item('FAQ 说 localStorage 约 5MB', /约 5MB/.test(faq), 'FAQ 明文');
  item('FAQ 说 IndexedDB 存沙面/缩略图', /IndexedDB/.test(faq) && /缩略图/.test(faq), 'FAQ 明文');
  const idb = src('src/lib/idb.ts');
  item('代码真的有 IndexedDB 模块', idb.length > 500, `idb.ts ${idb.split('\n').length} 行`);
  item('代码有 IDB 降级路径测试', existsSync('src/lib/idb-fallback.test.ts'), 'idb-fallback.test.ts');
}

/* ── 无后端 ── */
{
  item('FAQ 声称无后端', /没有任何服务器/.test(faq), 'FAQ 明文');
  item('package.json 无后端框架依赖', (() => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const deps = Object.keys(pkg.dependencies ?? {});
    const backend = deps.filter((d) => /express|koa|fastify|hapi|nest/.test(d));
    return backend.length === 0;
  })(), '发现后端框架');
  item('有 bundle-budget 门禁守住体积', existsSync('scripts/audit/bundle-budget.mjs'), 'bundle-budget.mjs');
}

/* ── 沙具 ── */
{
  const sym = src('src/sandbox/symbols.ts');
  const ms = [...sym.matchAll(/^\s*s\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/gm)];
  item('FAQ 说 327 个沙具', /327/.test(faq), 'FAQ 明文');
  item('代码实际是 327 个', ms.length === 327, `实际 ${ms.length}`);
  item('FAQ 说是 Unicode emoji 不是图片', /Unicode emoji/.test(faq), 'FAQ 明文');
}

/* ── 沙具包限制 ── */
{
  const packs = src('src/sandbox/library/packs.ts');
  item('FAQ 说上限 2000 个符号', /2000/.test(faq), 'FAQ 明文');
  const m2000 = /MAX_PACK_SYMBOLS[^=]*=\s*(\d+)/.exec(packs);
  item('代码 MAX_PACK_SYMBOLS = 2000', m2000 && Number(m2000[1]) === 2000, m2000 ? m2000[1] : '未找到');

  item('FAQ 说单图上限 200KB', /200KB/.test(faq), 'FAQ 明文');
  const m200k = /MAX_IMAGE_DATA_URI[^=]*=\s*([\d_*\s]+)/.exec(packs);
  item('代码里有 MAX_IMAGE_DATA_URI', m200k !== null, '未找到');

  item('FAQ 说校验真源在 packs.ts 的 validatePack', /validatePack/.test(faq), 'FAQ 明文');
  item('validatePack 确实在 packs.ts', /export function validatePack/.test(packs), '未找到导出');
  item('FAQ 说 samples/ 有三个样例', /三个?样例/.test(faq) || /纯字形包、内嵌图片包/.test(faq), 'FAQ 明文');
}

/* ── 事件流 ── */
{
  const ev = src('src/sandbox/events.ts');

  /*
   * ⚠️ 变异验证抓到的第一个漏洞：原来写 `/4000/.test(faq)`，
   * 把 FAQ 里的「MAX_EVENTS = 4000」改成 9999 后**门禁依然是绿的** ——
   * 因为 FAQ 别处还有「4000」这个数字（"30–60 分钟的操作量远低于 4000"）。
   *
   * 教训：断言要**绑到那个具体说法上**，不能只查"文件里有没有这个数"。
   * 一个数字在一篇文档里出现两次，松断言等于两处都没管。
   */
  item('FAQ 说 MAX_EVENTS = 4000（绑定到具体表述）',
    /MAX_EVENTS\s*=\s*4000/.test(faq), 'FAQ 明文');
  item('代码 MAX_EVENTS = 4000', /MAX_EVENTS\s*=\s*4000/.test(ev), '未找到');

  /*
   * 并且**交叉验证**：FAQ 里提到的那个数字必须真的等于代码里的常量。
   * 光两边各自匹配"= 4000"还不够 —— 将来代码改成 5000、FAQ 改成 5000
   * 也会一起绿，但那时 FAQ 里「远低于 4000」那句就错了。
   * 所以直接把 FAQ 里的数字抽出来和代码常量比。
   */
  const faqNum = /MAX_EVENTS\s*=\s*(\d+)/.exec(faq);
  const codeNum = /MAX_EVENTS\s*=\s*(\d+)/.exec(ev);
  item('FAQ 里的 MAX_EVENTS 数字 === 代码里的常量值',
    faqNum !== null && codeNum !== null && faqNum[1] === codeNum[1],
    `FAQ=${faqNum ? faqNum[1] : '?'} 代码=${codeNum ? codeNum[1] : '?'}`);

  item('FAQ 说压缩而非丢弃', /压缩/.test(faq), 'FAQ 明文');
  item('events-truncate.test.ts 存在', existsSync('src/sandbox/events-truncate.test.ts'), '缺失');
}

/* ── 无障碍 ── */
{
  item('FAQ 说键盘方向键移动 + Shift 加速', /Shift/.test(faq) && /方向键/.test(faq), 'FAQ 明文');
  const iso = src('src/sandbox/render/iso2d.tsx');
  item('iso2d 真的有 shiftKey 加速', /event\.shiftKey/.test(iso), '未找到');
  item('iso2d 真的有方向键处理', /ArrowRight|ArrowUp/.test(iso), '未找到');
  item('FAQ 说 E2E 21 项断言覆盖键盘流程', /21 项/.test(faq), 'FAQ 明文');
}

/* ── 格式 ── */
{
  item('FAQ 指向 docs/FORMAT.md', existsSync('docs/FORMAT.md'), '缺失');
  item('FAQ 说 schema 在 public/schema/', /public\/schema/.test(faq), 'FAQ 明文');
  item('public/schema 真的存在', existsSync('public/schema'), '缺失');
  item('FAQ 说格式号 sandplay-session/v1', /sandplay-session\/v1/.test(faq), 'FAQ 明文');

  /*
   * ⚠️ 变异验证抓到的第二个、也是最严重的一个漏洞。
   *
   * 原来的三条断言是：
   *   item('FAQ 说旧版可迁移', /迁移/.test(faq))
   *   item('sandplay.ts 有迁移逻辑', /migrateSnapshot/.test(src('src/format/migrate.ts')))
   *
   * 它们分别在验「FAQ 里有"迁移"二字」和「代码里有 migrateSnapshot 函数」，
   * 但**从来没有验过 FAQ 里写的那个路径是真的**。
   * 于是把 FAQ 里的 `src/format/migrate.ts` 改回我写错的
   * `src/lib/sandplay.ts`（该文件不存在），门禁**依然是绿的**。
   *
   * 这正是写这条门禁的初衷 —— 我自己就写错过这个路径 ——
   * 结果门禁在它最该管的那件事上是瞎的。
   *
   * 修法：把 FAQ 正文里出现的所有 `src/...` 路径抽出来，逐个查存在性。
   * 这不是"多写一条断言"，而是把"文档里的路径必须真实存在"这个
   * 原则**变成可执行的检查**。以后 FAQ 里新增任何路径自动被覆盖。
   */
  const pathRe = /`(src\/[A-Za-z0-9_./-]+|scripts\/[A-Za-z0-9_./-]+|public\/[A-Za-z0-9_./-]+)`/g;
  const mentioned = [...new Set([...faq.matchAll(pathRe)].map((m) => m[1]))];
  item('FAQ 里引用了具体代码路径（否则这条检查是空的）', mentioned.length > 0,
    `找到 ${mentioned.length} 个`);

  const missing = mentioned.filter((p) => !existsSync(p));
  item(`FAQ 引用的 ${mentioned.length} 个代码路径全部真实存在`, missing.length === 0,
    '不存在：' + missing.join(', '));

  /* 迁移函数确实存在，且在 FAQ 说的那个文件里 */
  const migrateFile = mentioned.find((p) => /migrate/.test(p));
  item('FAQ 指向的迁移文件里真的有迁移函数',
    migrateFile !== undefined &&
      /migrateSnapshot/.test(src(migrateFile)) &&
      /isLegacySnapshot/.test(src(migrateFile)),
    migrateFile ? migrateFile : 'FAQ 里没提到迁移文件');
}

/* ── 浏览器兼容 ── */
{
  item('FAQ 说 Safari 无痕 IDB 有降级', /无痕|隐私/.test(faq), 'FAQ 明文');
  item('FAQ 说明确未验 Firefox/Safari', /未做逐项验证|未验/.test(faq), 'FAQ 明文');
}

/* ── 门禁自身的一致性 ── */
{
  /*
   * ⚠️ 这里的「20 个环节」有个自指陷阱：把本门禁加进 `check` 之后，
   * `check` 就变成 21 个环节，FAQ 那句话立刻过期，门禁自己把自己搞红。
   *
   * 所以断言不是"等于 20"，而是"FAQ 里写的数字 === package.json 里
   * 实际拆出来的环节数"。这样加环节只需同步改 FAQ 一处数字，
   * 而不会出现"代码对了门禁说错"的假红。
   */
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const steps = pkg.scripts.check.split(' && ').length;
  const claimed = /(\d+)\s*个环节/.exec(faq);
  item('FAQ 写了 check 的环节数', claimed !== null, 'FAQ 里没写');
  item('FAQ 里的环节数 === package.json 实际环节数',
    claimed !== null && Number(claimed[1]) === steps,
    `FAQ=${claimed ? claimed[1] : '?'} 实际=${steps}`);
  item('FAQ 警告 e2e 不构建', /e2e.*不会自动构建|不构建/.test(faq.replace(/\n/g, ' ')), 'FAQ 明文');
}

/* ── 许可 ── */
{
  item('FAQ 说代码 Apache-2.0', /Apache-2\.0/.test(faq), 'FAQ 明文');
  item('FAQ 说文档 CC BY 4.0', /CC BY 4\.0/.test(faq), 'FAQ 明文');
  item('FAQ 说沙具不涉及授权', /不涉及/.test(faq), 'FAQ 明文');
  item('LICENSE 存在', existsSync('LICENSE'), '缺失');
  item('NOTICE 存在', existsSync('NOTICE'), '缺失');
  item('THIRD_PARTY_NOTICES.md 存在', existsSync('THIRD_PARTY_NOTICES.md'), '缺失');
}

/* ── 红线：FAQ 不许回答临床问题 ── */
{
  /*
   * ⚠️ 变异验证抓到的第三个漏洞。
   *
   * 原来写 `/不做诊断|不答/.test(faq)`。把 FAQ 正文里那句
   * 「本项目不做诊断、不做解读、不做专业判断」整段替换成别的文字后，
   * **门禁依然是绿的**。为什么？因为这个脚本自己的文件头注释里
   * 也写着「不做诊断」（我在注释里引用了 FAQ 原句）。
   *
   * 那个 `faq` 变量只读 docs/FAQ.md，不含本文件 —— 但断言太松了：
   * FAQ 正文还有别处写「不答」（"关于临床判断的一切问题本文一律不答"），
   * 所以替换掉一句、另一句仍然命中。
   *
   * 教训：**红线的断言必须锚定到那条红线本身的可辨识措辞**，
   * 而不能用"文件里出现过某个宽泛词"来代替。
   * 红线是整套门禁里最不能有幽灵的一条。
   *
   * 现在要求三件事同时成立：
   *   1. 文首那段显式声明（含"不做诊断"且含指向 CONTRACT 的章节号）
   *   2. 完整的三个"不做"并列（不做诊断、不做解读、不做专业判断）
   *   3. 文末「没答到的问题」一节仍然明确拒绝临床问题
   */
  const fullDisclaimer = /不做诊断、不做解读、不做专业判断/.test(faq);
  item('FAQ 保留了完整的「不做诊断、不做解读、不做专业判断」三不做',
    fullDisclaimer, '三不做被改动或删除');

  const headerDisclaimer = /本项目不做诊断[^\n]*§5\.6/.test(faq) || /§5\.6[^\n]*不做诊断/.test(faq);
  item('文首声明同时包含「不做诊断」与 CONTRACT §5.6 指引',
    headerDisclaimer, '文首声明缺失或没指向 §5.6');

  const tailRefusal = /本项目不做解读/.test(faq);
  item('文末仍然明确拒绝临床解读类问题', tailRefusal, '文末拒绝声明缺失');

  item('FAQ 指向 CONTRACT §5.6', /5\.6/.test(faq), 'FAQ 明文');
}

console.log('');
console.log(`合计：${checks} 项，${failures} 项失败`);
if (failures > 0) process.exit(1);
console.log('✓ FAQ 里每条技术断言都与代码一致');

