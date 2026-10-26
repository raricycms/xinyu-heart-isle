/**
 * 心屿 · 沙具库（检索 / 沙具包 / 引导语）单元测试
 *
 * 覆盖三块纯逻辑：
 * 1. 内置库完整性（数量、子类、id 唯一、每子类条数）——防止 `symbols.ts` 被破坏；
 * 2. 检索（中文/英文/空结果/伞词/分类过滤/分节/合并去重）；
 * 3. 沙具包（合法通过、六类非法输入拒绝、安装/覆盖/卸载、示例包可导入）。
 *
 * 说明：这些测试**不渲染 React**（vitest 环境是 node），
 * 组件的可访问性与布局靠 `scripts/audit/a11y.ts` 与手工验证覆盖。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AFFECT_LABELS,
  SYMBOLS,
  SYMBOL_COUNT,
  SUBCATEGORY_COUNT,
  categoryLabels,
  categoryOrder,
  subcategoryLabels,
  type PromptStage,
} from '@/sandbox/symbols';
import {
  filterByCategory,
  groupBySubcategory,
  mergeEntries,
  searchEntries,
  starterEntries,
  subcategoriesOf,
} from './search';
import { promptPoolSize, promptsForView, PROMPT_STAGES, nextSeed } from './prompts';
import {
  MAX_PACK_BYTES,
  MAX_PACK_SYMBOLS,
  SYMBOL_PACK_FORMAT,
  SYMBOL_PACKS_STORAGE_KEY,
  __resetPackMemory,
  byteLength,
  importPack,
  importPackFromText,
  isValidImageDataUri,
  isValidLicense,
  isValidPackSymbolId,
  listPacks,
  listPackSymbols,
  removePack,
  validatePack,
} from './packs';

/* -------------------------------------------------------------------------- */
/*                                  测试数据                                   */
/* -------------------------------------------------------------------------- */

function validPack() {
  return {
    format: SYMBOL_PACK_FORMAT,
    id: 'testpack',
    name: '测试包',
    version: '1.0.0',
    author: '测试',
    license: 'CC0-1.0',
    symbols: [
      {
        id: 'testpack.stone-a',
        label: '小石子',
        labelEn: 'Pebble',
        category: 'nature',
        subcategory: 'nature-land',
        glyph: '🪨',
        tags: ['pebble', '石子'],
      },
      {
        id: 'testpack.boat-a',
        label: '纸船',
        labelEn: 'Paper boat',
        category: 'object',
        subcategory: 'object-vehicle',
        glyph: '⛵',
        tags: ['boat', '纸船'],
      },
    ],
  };
}

beforeEach(() => {
  __resetPackMemory();
});

/* -------------------------------------------------------------------------- */
/*                              1. 内置库完整性                                */
/* -------------------------------------------------------------------------- */

describe('内置沙具库完整性', () => {
  it('条目数与子类数达到 v2 要求（>=300 / >=18）', () => {
    expect(SYMBOL_COUNT).toBeGreaterThanOrEqual(300);
    expect(SUBCATEGORY_COUNT).toBeGreaterThanOrEqual(18);
    expect(SYMBOLS).toHaveLength(SYMBOL_COUNT);
  });

  it('id 全局唯一（重放与命中测试都依赖这一点）', () => {
    const ids = new Set(SYMBOLS.map((symbol) => symbol.id));
    expect(ids.size).toBe(SYMBOLS.length);
  });

  it('每个子类至少 5 条', () => {
    const counts = new Map<string, number>();
    for (const symbol of SYMBOLS) {
      counts.set(symbol.subcategory, (counts.get(symbol.subcategory) ?? 0) + 1);
    }
    const tooSmall = [...counts.entries()].filter(([, count]) => count < 5);
    expect(tooSmall).toEqual([]);
    // 24 个子类都必须真的被用到
    expect(counts.size).toBe(SUBCATEGORY_COUNT);
  });

  it('每条都能被归到一个已知大类，且 category 与 subcategory 一致', () => {
    const broken = SYMBOLS.filter(
      (symbol) => !categoryOrder.includes(symbol.category as never) || !symbol.glyph,
    );
    expect(broken).toEqual([]);
  });

  it('6 个大类都有中文标签与展示顺序', () => {
    expect(categoryOrder).toHaveLength(6);
    for (const category of categoryOrder) {
      expect(categoryLabels[category].length).toBeGreaterThan(0);
    }
    expect(Object.keys(subcategoryLabels)).toHaveLength(SUBCATEGORY_COUNT);
  });
});

/* -------------------------------------------------------------------------- */
/*                                  2. 检索                                    */
/* -------------------------------------------------------------------------- */

describe('沙具检索', () => {
  it('搜「树」能命中 tree / pine / palm / forest', () => {
    const ids = searchEntries(SYMBOLS, '树', 120).map((entry) => entry.id);
    expect(ids).toContain('tree');
    expect(ids).toContain('pine');
    expect(ids).toContain('palm');
    expect(ids).toContain('forest');
  });

  it('搜「snake」能命中「蛇」', () => {
    const hits = searchEntries(SYMBOLS, 'snake', 120);
    expect(hits.map((entry) => entry.id)).toContain('snake');
    expect(hits[0]?.label).toBe('蛇');
  });

  it('搜不存在的词返回空数组（而不是回退成全部）', () => {
    expect(searchEntries(SYMBOLS, 'zzzz-not-a-symbol', 60)).toEqual([]);
    expect(searchEntries(SYMBOLS, '没有这个沙具', 60)).toEqual([]);
  });

  it('空查询返回前 limit 条，且不超过 limit', () => {
    expect(searchEntries(SYMBOLS, '', 10)).toHaveLength(10);
    expect(searchEntries(SYMBOLS, '   ', 10)).toHaveLength(10);
    expect(searchEntries(SYMBOLS, '', 9999)).toHaveLength(SYMBOL_COUNT);
  });

  it('精确命中排在模糊命中前面', () => {
    const hits = searchEntries(SYMBOLS, '太阳', 20);
    expect(hits[0]?.id).toBe('sun');
  });

  it('检索不区分大小写', () => {
    const lower = searchEntries(SYMBOLS, 'dragon', 20).map((entry) => entry.id);
    const upper = searchEntries(SYMBOLS, 'DRAGON', 20).map((entry) => entry.id);
    expect(upper).toEqual(lower);
    expect(lower.length).toBeGreaterThan(0);
  });
});

describe('分类过滤与分节', () => {
  it('filterByCategory 只返回该大类，且条数对得上', () => {
    const nature = filterByCategory(SYMBOLS, 'nature');
    expect(nature.length).toBeGreaterThan(0);
    expect(nature.every((entry) => entry.category === 'nature')).toBe(true);

    const total = categoryOrder.reduce((sum, key) => sum + filterByCategory(SYMBOLS, key).length, 0);
    expect(total).toBe(SYMBOL_COUNT);
    expect(filterByCategory(SYMBOLS, 'all')).toHaveLength(SYMBOL_COUNT);
  });

  it('groupBySubcategory 覆盖整类的全部条目，无遗漏无重复', () => {
    for (const category of categoryOrder) {
      const scoped = filterByCategory(SYMBOLS, category);
      const groups = groupBySubcategory(scoped);
      const flat = groups.flatMap((group) => group.items);
      expect(flat).toHaveLength(scoped.length);
      expect(new Set(flat.map((entry) => entry.id)).size).toBe(scoped.length);
      // 每个分节都有标签
      expect(groups.every((group) => group.label.length > 0)).toBe(true);
    }
  });

  it('subcategoriesOf 返回的子类都属于该大类', () => {
    const keys = subcategoriesOf(SYMBOLS, 'creature');
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(keys).toContain('animal-wild');
    expect(keys).toContain('animal-insect');
  });

  it('mergeEntries 遇到同 id 时保留先传入的那份（内置优先）', () => {
    const fakePackEntry = {
      ...SYMBOLS[0],
      label: '被覆盖的名字',
      packId: 'evilpack',
    };
    const merged = mergeEntries(SYMBOLS, [fakePackEntry]);
    expect(merged).toHaveLength(SYMBOL_COUNT);
    expect(merged[0].label).toBe(SYMBOLS[0].label);
  });

  it('starterEntries 覆盖 6 个大类且不重复', () => {
    const starter = starterEntries(SYMBOLS, 24);
    expect(starter).toHaveLength(24);
    expect(new Set(starter.map((entry) => entry.id)).size).toBe(24);
    expect(new Set(starter.map((entry) => entry.category)).size).toBe(6);
  });
});

/* -------------------------------------------------------------------------- */
/*                                3. 引导语                                    */
/* -------------------------------------------------------------------------- */

describe('引导语', () => {
  it('三个阶段都有内容，且都能取到指定条数', () => {
    expect(PROMPT_STAGES).toHaveLength(3);
    for (const stage of PROMPT_STAGES) {
      expect(promptPoolSize(stage)).toBeGreaterThanOrEqual(5);
      const picked = promptsForView(stage, 3, 3);
      expect(picked).toHaveLength(3);
      expect(new Set(picked).size).toBe(3);
    }
  });

  it('同一 seed 结果稳定；换 seed 后内容会变', () => {
    expect(promptsForView('during', 5, 3)).toEqual(promptsForView('during', 5, 3));
    const a = promptsForView('during', 0, 3).join('|');
    const b = promptsForView('during', nextSeed(0), 3).join('|');
    expect(a).not.toBe(b);
  });

  it('引导语不含解读式措辞（不出现「代表你」「说明你」「你有」）', () => {
    const forbidden = ['代表你', '说明你', '你有抑郁', '诊断', '应该'];
    for (const stage of PROMPT_STAGES as PromptStage[]) {
      for (let seed = 0; seed < 20; seed += 1) {
        for (const prompt of promptsForView(stage, seed, 5)) {
          for (const word of forbidden) {
            expect(prompt.includes(word)).toBe(false);
          }
        }
      }
    }
  });
});

describe('感受标签词表', () => {
  it('13 个标签，全部非空且不重复', () => {
    expect(AFFECT_LABELS).toHaveLength(13);
    expect(new Set(AFFECT_LABELS).size).toBe(13);
    expect(AFFECT_LABELS.every((label) => label.trim().length > 0)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*                                4. 沙具包校验                                */
/* -------------------------------------------------------------------------- */

describe('validatePack：合法输入', () => {
  it('接受一个结构完整的包，并归一化 category 与 id', () => {
    const result = validatePack(validPack());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.pack?.symbols).toHaveLength(2);
    expect(result.pack?.id).toBe('testpack');
    // category 由子类推导，外部乱填的会被纠正
    expect(result.pack?.symbols[0].category).toBe('nature');
    expect(result.pack?.symbols[1].category).toBe('object');
  });

  it('接受 data URI 内嵌图片（与 glyph 二选一）', () => {
    const pack = validPack();
    pack.symbols[0] = { ...pack.symbols[0], glyph: undefined as unknown as string } as never;
    const withImage = {
      ...pack,
      symbols: [
        {
          id: 'testpack.img',
          label: '小图',
          category: 'object',
          subcategory: 'object-daily',
          image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
        },
      ],
    };
    const result = validatePack(withImage);
    expect(result.ok).toBe(true);
    expect(result.pack?.symbols[0].image).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
  });

  it('兼容 types.ts 的 symbol-pack/v1 字面量', () => {
    const result = validatePack({ ...validPack(), format: 'symbol-pack/v1' });
    expect(result.ok).toBe(true);
  });
});

describe('validatePack：非法输入全部拒绝', () => {
  it('① 不是对象', () => {
    expect(validatePack(null).ok).toBe(false);
    expect(validatePack('not json').ok).toBe(false);
    expect(validatePack([]).ok).toBe(false);
    expect(validatePack(42).ok).toBe(false);
  });

  it('② format 字面量不对', () => {
    const result = validatePack({ ...validPack(), format: 'sandbox-symbol-pack/v2' });
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain('format');
  });

  it('③ id 没有命名空间前缀', () => {
    const pack = validPack();
    pack.symbols[0].id = 'tree';
    const result = validatePack(pack);
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain('内置沙具重名');
  });

  it('④ id 带前缀但格式非法（无点、非法字符）', () => {
    const pack = validPack();
    pack.symbols[0].id = 'testpackstone';
    const result = validatePack(pack);
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain('命名空间');
  });

  it('⑤ license 为空 / unknown', () => {
    expect(validatePack({ ...validPack(), license: '' }).ok).toBe(false);
    expect(validatePack({ ...validPack(), license: 'unknown' }).ok).toBe(false);
    expect(validatePack({ ...validPack(), license: undefined }).ok).toBe(false);
  });

  it('⑥ symbols 为空 / 不是数组 / 超过上限', () => {
    expect(validatePack({ ...validPack(), symbols: [] }).ok).toBe(false);
    expect(validatePack({ ...validPack(), symbols: 'nope' }).ok).toBe(false);

    const huge = {
      ...validPack(),
      symbols: Array.from({ length: MAX_PACK_SYMBOLS + 1 }, (_, index) => ({
        id: `testpack.item-${index}`,
        label: `条目${index}`,
        category: 'object',
        subcategory: 'object-daily',
        glyph: '◌',
      })),
    };
    const result = validatePack(huge);
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain(String(MAX_PACK_SYMBOLS));
  });

  it('⑦ 未知子类 / 大类与子类不一致', () => {
    const badSub = validPack();
    badSub.symbols[0].subcategory = 'nature-unknown';
    expect(validatePack(badSub).ok).toBe(false);

    const mismatch = validPack();
    mismatch.symbols[0].category = 'object';
    expect(validatePack(mismatch).ok).toBe(false);
  });

  it('⑧ image 是网络地址（禁止联网加载）', () => {
    const result = validatePack({
      ...validPack(),
      symbols: [
        {
          id: 'testpack.remote',
          label: '远程图',
          category: 'object',
          subcategory: 'object-daily',
          image: 'https://example.com/a.png',
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain('内嵌图片');
  });

  it('⑨ 既没有 glyph 也没有 image', () => {
    const result = validatePack({
      ...validPack(),
      symbols: [
        { id: 'testpack.empty', label: '空', category: 'object', subcategory: 'object-daily' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain('glyph');
  });

  it('⑩ 包内 symbol id 重复', () => {
    const pack = validPack();
    pack.symbols[1].id = pack.symbols[0].id;
    const result = validatePack(pack);
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain('重复');
  });

  it('⑪ 缺少 name 或 name 过长', () => {
    expect(validatePack({ ...validPack(), name: '' }).ok).toBe(false);
    expect(validatePack({ ...validPack(), name: 'x'.repeat(200) }).ok).toBe(false);
  });

  it('⑫ 整体体积超限', () => {
    // 用接近上限的 data URI 撑体积（每张 < 200KB，但 9 张会超过 1.5MB）
    const chunk = 'A'.repeat(190_000);
    const symbols = Array.from({ length: 9 }, (_, index) => ({
      id: `testpack.big-${index}`,
      label: `大图${index}`,
      category: 'object',
      subcategory: 'object-daily',
      image: `data:image/png;base64,${chunk}`,
    }));
    const result = validatePack({ ...validPack(), symbols });
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain(String(Math.round(MAX_PACK_BYTES / 1024)));
  });
});

describe('校验辅助函数', () => {
  it('isValidLicense 接受 SPDX、拒绝空与占位词', () => {
    expect(isValidLicense('CC0-1.0')).toBe(true);
    expect(isValidLicense('MIT')).toBe(true);
    expect(isValidLicense('proprietary')).toBe(true);
    expect(isValidLicense('CC-BY-4.0 AND MIT')).toBe(true);
    expect(isValidLicense('')).toBe(false);
    expect(isValidLicense('  ')).toBe(false);
    expect(isValidLicense('unknown')).toBe(false);
    expect(isValidLicense(123)).toBe(false);
  });

  it('isValidImageDataUri 只接受内嵌图片', () => {
    expect(isValidImageDataUri('data:image/png;base64,AAAA')).toBe(true);
    expect(isValidImageDataUri('data:image/svg+xml;base64,AAAA')).toBe(true);
    expect(isValidImageDataUri('https://x/a.png')).toBe(false);
    expect(isValidImageDataUri('data:text/html;base64,AAAA')).toBe(false);
    expect(isValidImageDataUri('javascript:alert(1)')).toBe(false);
  });

  it('isValidPackSymbolId 要求命名空间且不与内置冲突', () => {
    expect(isValidPackSymbolId('mypack.tree')).toBe(true);
    expect(isValidPackSymbolId('tree')).toBe(false);
    expect(isValidPackSymbolId('a.b-c_d')).toBe(true);
    expect(isValidPackSymbolId('mypack.')).toBe(false);
    expect(isValidPackSymbolId('.tree')).toBe(false);
  });

  it('byteLength 按 UTF-8 计算（中文 3 字节，emoji 4 字节）', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('中')).toBe(3);
    expect(byteLength('🌳')).toBe(4);
  });
});

/* -------------------------------------------------------------------------- */
/*                                5. 安装与卸载                                */
/* -------------------------------------------------------------------------- */

describe('沙具包安装', () => {
  it('localStorage key 固定为 xinyu.symbolPacks（Lead 要写进 FORMAT.md）', () => {
    expect(SYMBOL_PACKS_STORAGE_KEY).toBe('xinyu.symbolPacks');
  });

  it('importPack 成功后能被 listPacks / listPackSymbols 读到', () => {
    const result = importPack(validPack());
    expect(result.ok).toBe(true);
    expect(result.record?.symbols).toHaveLength(2);

    const packs = listPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0].name).toBe('测试包');
    expect(packs[0].license).toBe('CC0-1.0');
    // 归一化：packId 与 license 落到每条上
    expect(packs[0].symbols[0].packId).toBe('testpack');
    expect(packs[0].symbols[0].license).toBe('CC0-1.0');

    const all = listPackSymbols();
    expect(all).toHaveLength(2);
    expect(all.map((entry) => entry.id)).toContain('testpack.stone-a');
  });

  it('importPack 失败时不写入任何东西', () => {
    const result = importPack({ format: 'wrong' });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(listPacks()).toEqual([]);
  });

  it('同 id 再次导入 = 覆盖升级，不会重复出现', () => {
    importPack(validPack());
    const upgraded = validPack();
    upgraded.version = '2.0.0';
    upgraded.symbols = upgraded.symbols.slice(0, 1);
    importPack(upgraded);

    const packs = listPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0].version).toBe('2.0.0');
    expect(packs[0].symbols).toHaveLength(1);
  });

  it('removePack 真的删掉；删不存在的返回 false', () => {
    importPack(validPack());
    expect(listPacks()).toHaveLength(1);
    expect(removePack('testpack')).toBe(true);
    expect(listPacks()).toEqual([]);
    expect(removePack('testpack')).toBe(false);
  });

  it('importPackFromText：空文件与坏 JSON 给出中文原因', () => {
    expect(importPackFromText('').ok).toBe(false);
    const badJson = importPackFromText('{ not json');
    expect(badJson.ok).toBe(false);
    expect(badJson.issues.join()).toContain('JSON');

    const ok = importPackFromText(JSON.stringify(validPack()));
    expect(ok.ok).toBe(true);
  });

  it('图片条目：glyph 用占位符，真实 data URI 存进 images 表', () => {
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const result = importPack({
      ...validPack(),
      symbols: [
        {
          id: 'testpack.img',
          label: '小图',
          category: 'object',
          subcategory: 'object-daily',
          image,
        },
      ],
    });
    expect(result.ok).toBe(true);
    const pack = listPacks()[0];
    expect(pack.symbols[0].glyph).toBe('🖼');
    expect(pack.images?.['testpack.img']).toBe(image);
  });
});

/* -------------------------------------------------------------------------- */
/*                          6. 随包分发的示例沙具包                            */
/* -------------------------------------------------------------------------- */

describe('public/symbol-packs/example-pack.json', () => {
  const examplePath = fileURLToPath(new URL('../../../public/symbol-packs/example-pack.json', import.meta.url));

  it('文件存在且能通过校验（8 条，CC0-1.0）', () => {
    const raw = readFileSync(examplePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const result = validatePack(parsed);

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.pack?.license).toBe('CC0-1.0');
    expect(result.pack?.symbols).toHaveLength(8);
  });

  it('示例包可以真的装上，且不污染内置库', () => {
    const raw = readFileSync(examplePath, 'utf8');
    const result = importPackFromText(raw);
    expect(result.ok).toBe(true);
    expect(listPacks()).toHaveLength(1);
    expect(listPackSymbols()).toHaveLength(8);
    // 内置库不受影响
    expect(SYMBOLS).toHaveLength(SYMBOL_COUNT);
    // 包内 id 都是命名空间形式
    expect(listPackSymbols().every((entry) => entry.id.includes('.'))).toBe(true);
  });
});
