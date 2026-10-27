/**
 * 文档里「数值与最小值」类断言的可运行性自测。
 *
 * ── 这个文件防的是什么 ──────────────────────────────────────────
 *
 * `docs/FORMAT.md` §10.1 是一张**手写的**最小合法值表。
 * 手写表格最容易出的错不是排版，而是**某一格写错了**：
 *
 *   - 说 `scale` 最小 0.5，校验器其实允许 0.1
 *   - 说 `mode` 可以是 `"counselor"`，枚举里拼错成 `counsellor`
 *   - 说"省略 surface 等于平整沙面"，实际省略会得到 0 高度
 *
 * 读者照着写，校验器拒绝，他不会认为是文档错了 ——
 * 会认为是自己做错了。这类错误的代价比代码 bug 更高，
 * 因为受害者是最没有能力排查的人。
 *
 * 所以：**表中每一行的「最小合法值」都真的喂给校验器**。
 *
 * ── 同时也验反向 ────────────────────────────────────────────────
 *
 * 只验"能过"是不够的。如果校验器什么都不查，那整张表都会"通过"。
 * 所以每条"会被拒"的说明也都验一遍 —— 双向都验，
 * 这张表才叫事实，不叫叙述。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const doc = readFileSync('docs/FORMAT.md', 'utf8');

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log('  ✓ ' + name);
  else {
    failures += 1;
    console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  }
}

const dir = mkdtempSync(join(tmpdir(), 'xinyu-format-'));
process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结论 */
  }
});

function runValidator(args) {
  try {
    const out = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--no-warnings',
        '--import',
        './scripts/alias-loader.mjs',
        'scripts/validate-session.ts',
        ...args,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: String(error.stdout ?? '') + String(error.stderr ?? '') };
  }
}

/** 用最小字段拼一份会话，再按需覆写 `session` 里的部分 */
function minimalSession(overrides = {}) {
  return {
    format: 'sandplay-session/v1',
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    producer: { app: 'x', version: '0' },
    session: {
      id: 's',
      createdAt: '2026-01-01T00:00:00.000Z',
      title: 'x',
      mode: 'self',
      sceneId: 'beach',
      locked: false,
      items: [],
      events: [],
      ...overrides,
    },
  };
}

function validate(obj) {
  const file = join(dir, 'a.sandplay.json');
  writeFileSync(file, JSON.stringify(obj), 'utf8');
  return runValidator([file]);
}

console.log('docs/FORMAT.md §10.1 最小合法值表 · 可运行性');
console.log('');

/* ── 1. 这一节必须存在且覆盖到位 ─────────────────────────────── */
{
  check('文档里有 §10.1', doc.includes('## 10.1 每个字段的最小合法值'));
  const start = doc.indexOf('## 10.1');
  const end = doc.indexOf('## 11. 参考实现清单');
  const section = start !== -1 && end !== -1 ? doc.slice(start, end) : '';
  check('  覆盖顶层字段', section.includes('`format`') && section.includes('`producer`'));
  check('  覆盖 session 必需字段', section.includes('`sceneId`') && section.includes('`locked`'));
  check('  覆盖 items 字段', section.includes('`symbolId`') && section.includes('`rotation`'));
  check('  覆盖 events 字段', section.includes('`t`') && section.includes('`type`'));
  check('  澄清了"省略 surface ≠ 没有沙面"', section.includes('不等于'));
}

/* ── 2. 正向：表里说合法的，必须真的能过 ─────────────────────── */
{
  const r = validate(minimalSession());
  check('最小会话通过', r.code === 0, 'exit=' + r.code + ' ' + r.out.slice(-250));
}

for (const mode of ['self', 'counselor', 'supervision']) {
  const r = validate(minimalSession({ mode }));
  check('mode = "' + mode + '" 合法', r.code === 0, 'exit=' + r.code + ' ' + r.out.slice(-200));
}

{
  const item = { id: 'i', symbolId: 'tree', x: 0, y: 1, scale: 0.5, rotation: -180, z: 0 };
  const r = validate(minimalSession({ items: [item] }));
  check('items 用最小合法值通过', r.code === 0, 'exit=' + r.code + ' ' + r.out.slice(-250));

  for (const [label, patch] of [
    ['x/y = 0.5', { x: 0.5, y: 0.5 }],
    ['rotation = 180（上界含）', { rotation: 180 }],
    ['scale = 2（上界含）', { scale: 2 }],
  ]) {
    const r2 = validate(minimalSession({ items: [{ ...item, ...patch }] }));
    check('  ' + label + ' 合法', r2.code === 0, 'exit=' + r2.code + ' ' + r2.out.slice(-200));
  }
}

{
  const r = validate(minimalSession({ items: [], events: [] }));
  check('items: [] 合法（空沙盘）', r.code === 0, 'exit=' + r.code);
  const r2 = validate(minimalSession({ meta: {} }));
  check('meta: {} 合法', r2.code === 0, 'exit=' + r2.code + ' ' + r2.out.slice(-200));
}

{
  const event = {
    t: 0,
    type: 'item.add',
    payload: { item: { id: 'i', symbolId: 'tree', x: 0.5, y: 0.5, scale: 1, rotation: 0, z: 0 } },
  };
  const r = validate(minimalSession({ events: [event] }));
  check('event 用最小字段通过', r.code === 0, 'exit=' + r.code + ' ' + r.out.slice(-250));
}

/* ── 3. 表里说可省略的，省略后必须仍能过 ─────────────────────── */
for (const field of ['meta', 'annotations', 'prompts', 'reflection', 'surface', 'phase', 'endedAt']) {
  const session = minimalSession();
  delete session.session[field];
  const r = validate(session);
  check('省略 ' + field + ' 时通过', r.code === 0, 'exit=' + r.code + ' ' + r.out.slice(-200));
}

/* ── 4. 反向：表里说"会被拒"的，必须真的被拒 ─────────────────── */
{
  const bad = minimalSession();
  bad.version = '1';
  check('version 用字符串会被拒', validate(bad).code === 1);

  const bad2 = minimalSession();
  bad2.format = 'sandplay-session/v2';
  check('format = v2 会被拒', validate(bad2).code === 1);

  const dup = { id: 'same', symbolId: 'tree', x: 0.5, y: 0.5, scale: 1, rotation: 0, z: 0 };
  const r3 = validate(minimalSession({ items: [dup, { ...dup }] }));
  check('items id 重复会被拒', r3.code === 1, 'exit=' + r3.code + ' ' + r3.out.slice(-200));

  const r4 = validate(minimalSession({ items: [{ ...dup, id: 'ok', x: 1.5 }] }));
  check('坐标 x = 1.5 越界会被拒', r4.code === 1, 'exit=' + r4.code + ' ' + r4.out.slice(-200));

  const r5 = validate(minimalSession({ events: [{ t: 0, type: 'nope.nope' }] }));
  check('未知事件类型会被拒', r5.code === 1, 'exit=' + r5.code + ' ' + r5.out.slice(-200));

  const r6 = validate(minimalSession({ mode: 'invalid' }));
  check('mode 非法值会被拒', r6.code === 1, 'exit=' + r6.code + ' ' + r6.out.slice(-200));
}

/* ── 5. §8.1 的 7 个禁止键名，逐个验 ─────────────────────────── */
{
  const forbidden = ['realName', 'name', 'phone', 'idCard', 'email', 'address', 'wechat'];
  for (const key of forbidden) {
    const r = validate(minimalSession({ meta: { [key]: 'x' } }));
    check('meta.' + key + ' 会被拒', r.code === 1, 'exit=' + r.code + ' ' + r.out.slice(-200));
  }

  /* 允许的替代不能被误伤 —— 隐私规则写太宽等于逼人放弃用 meta */
  const ok = validate(minimalSession({ meta: { alias: '小A', clientRef: 'c1' } }));
  check('meta.alias / clientRef 不被误伤', ok.code === 0, 'exit=' + ok.code + ' ' + ok.out.slice(-200));
}

console.log('');
if (failures > 0) {
  console.error('✗ ' + failures + ' / ' + checks + ' 项失败');
  process.exit(1);
}
console.log('✓ ' + checks + ' 项：表里每一格都验过');
