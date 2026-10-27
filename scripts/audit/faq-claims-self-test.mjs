/**
 * `faq-claims.mjs` 的变异验证 —— 5 种断言写错，门禁都必须变红。
 *
 * ── 这个自测很有必要，因为它的第一版就抓出 3 个幽灵断言 ──────────
 *
 * `faq-claims.mjs` 写完后我直接跑了它，48 项全绿，看着很好。
 * 然后写这个自测去破坏 FAQ —— **3 个变异完全没变红**：
 *
 * | 变异 | 我的断言 | 为什么没红 |
 * | --- | --- | --- |
 * | `MAX_EVENTS = 4000` → 9999 | `/4000/.test(faq)` | FAQ 别处还有"4000"，两个 4000 互相掩护 |
 * | 迁移路径改回 `src/lib/sandplay.ts` | 查的是**代码**有没有 `migrateSnapshot` | 从没验 FAQ 写的路径存在 |
 * | 删掉「不做诊断…」 | `/不做诊断\|不答/.test(faq)` | FAQ 别处还有"不答"，替换一处仍然命中 |
 *
 * 第二条尤其讽刺：写这条门禁的**起因**就是我自己在 FAQ 里写错了
 * 迁移文件路径（写成不存在的 `src/lib/sandplay.ts`），结果门禁
 * 在它最该管的那件事上恰好是瞎的。
 *
 * 修完后：把 FAQ 里**所有** `src/`、`scripts/`、`public/` 路径抽出来
 * 逐个查存在性 —— 以后 FAQ 新增任何路径自动被覆盖。
 *
 * ── 教训 ──────────────────────────────────────────────────────────
 *
 * 「48 项全绿」不等于门禁有效。**只有当变异能让它变红时，绿才有意义。**
 * 这也是为什么每个门禁都必须配一个自测，而不是靠"我写得很仔细"。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const FAQ = 'docs/FAQ.md';
const orig = readFileSync(FAQ, 'utf8');
let checks = 0;
let failures = 0;

function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log('  ✓ ' + name);
  else { failures += 1; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function runGate() {
  const r = spawnSync(process.execPath, ['scripts/audit/faq-claims.mjs'], { encoding: 'utf8' });
  return { code: r.status ?? 1, out: String(r.stdout ?? '') + String(r.stderr ?? '') };
}
function restore() { writeFileSync(FAQ, orig, 'utf8'); }
process.on('exit', restore);

console.log('');
console.log('变异验证：FAQ 技术断言门禁');
console.log('');

{
  const r = runGate();
  check('基线全绿', r.code === 0, 'exit=' + r.code);
}

/* 变异 1：把沙具数量写错 */
{
  const m = orig.replace('默认的 327 个沙具', '默认的 999 个沙具');
  check('变异点 1 已定位（327→999）', m !== orig);
  if (m !== orig) {
    writeFileSync(FAQ, m, 'utf8');
    const r = runGate();
    check('  门禁变红', r.code !== 0, 'exit=' + r.code);
    check('  报出 327 那条', /327/.test(r.out), r.out.slice(-300));
    restore();
  }
}

/* 变异 2：把 MAX_EVENTS 写错 */
{
  const m = orig.replace(/`MAX_EVENTS = 4000`/, '`MAX_EVENTS = 9999`');
  check('变异点 2 已定位（4000→9999）', m !== orig);
  if (m !== orig) {
    writeFileSync(FAQ, m, 'utf8');
    const r = runGate();
    check('  门禁变红', r.code !== 0, 'exit=' + r.code);
    restore();
  }
}

/* 变异 3：引用一个不存在的文件路径（这正是 FAQ 门禁抓到我自己的方式） */
{
  const m = orig.replace('`src/format/migrate.ts`', '`src/lib/sandplay.ts`');
  check('变异点 3 已定位（改回我写错的那个路径）', m !== orig);
  if (m !== orig) {
    writeFileSync(FAQ, m, 'utf8');
    const r = runGate();
    check('  门禁变红', r.code !== 0, 'exit=' + r.code);
    check('  报出迁移逻辑那条', /迁移/.test(r.out), r.out.slice(-300));
    restore();
  }
}

/* 变异 4：删掉「不做诊断」的红线声明 */
{
  const m = orig.replace(/不做诊断、不做解读、不做专业判断/g, '这个项目挺好的');
  check('变异点 4 已定位（删红线声明）', m !== orig);
  if (m !== orig) {
    writeFileSync(FAQ, m, 'utf8');
    const r = runGate();
    check('  门禁变红', r.code !== 0, 'exit=' + r.code);
    restore();
  }
}

/* 变异 5：check 环节数写错 */
{
  const m = orig.replace(/(\d+) 个环节/, '99 个环节');
  check('变异点 5 已定位（环节数→99）', m !== orig);
  if (m !== orig) {
    writeFileSync(FAQ, m, 'utf8');
    const r = runGate();
    check('  门禁变红', r.code !== 0, 'exit=' + r.code);
    restore();
  }
}

/* 变异 6：HANDOVER 里的环节数与 package.json 不一致 */
/*
 * 「22 个环节」这个事实同时写在 FAQ 和 HANDOVER 两处。
 * 这正是上面「同一事实写多处」那个坑的又一次现身 ——
 * 两份文档说法不一致，比只有一份写错更难查（读者不知道信哪个）。
 */
{
  const HANDOVER = 'docs/HANDOVER.md';
  const hoOrig = readFileSync(HANDOVER, 'utf8');
  const m = hoOrig.replace(/(\d+) 个环节/, '99 个环节');
  check('变异点 6 已定位（HANDOVER 环节数→99）', m !== hoOrig);
  if (m !== hoOrig) {
    try {
      writeFileSync(HANDOVER, m, 'utf8');
      const r = runGate();
      check('  门禁变红', r.code !== 0, 'exit=' + r.code);
      check('  报出 HANDOVER 那个错数', /HANDOVER=99/.test(r.out), r.out.slice(-300));
      check('  也报出两份文档说的不是一个数', /FAQ 与 HANDOVER 说的是同一个数/.test(r.out),
        r.out.slice(-300));
    } finally {
      writeFileSync(HANDOVER, hoOrig, 'utf8');
    }
    check('HANDOVER 逐字节还原', readFileSync(HANDOVER, 'utf8') === hoOrig);
  }
}

{
  restore();
  const r = runGate();
  check('恢复后全绿', r.code === 0, 'exit=' + r.code);
  check('FAQ 逐字节还原', readFileSync(FAQ, 'utf8') === orig);
}

console.log('');
if (failures > 0) { console.error('✗ ' + failures + ' / ' + checks + ' 项失败'); process.exit(1); }
console.log('✓ ' + checks + ' 项：6 种断言/文档写错都会让门禁变红');
