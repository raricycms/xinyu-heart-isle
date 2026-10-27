/**
 * 心屿 · 沙具包（Symbol Pack）格式、校验与本地安装
 *
 * 设计目标（VISION.md §5.8）：让外部开发者能安全地扩展象征物库。
 * 安全边界：
 * 1. **不联网**：只允许 emoji/字符 glyph 或 `data:` 内嵌图片，
 *    出现 `http(s)://` 一律拒绝（契约 §5.4 数据不出本地）；
 * 2. **不撞内置**：包内 id 必须带命名空间（含 `.`），且不能与 `symbols.ts` 的 327 条重名；
 * 3. **不撑爆存储**：单包条数 ≤ 2000、单个 data URI ≤ 200KB、单包序列化 ≤ 1.5MB；
 * 4. **可删除**：`removePack` 整体移除，不留残渣。
 *
 * 存储：`localStorage['xinyu.symbolPacks']`，值为 `InstalledSymbolPack[]`。
 * 该 key 不在 `src/lib/storage.ts` 的 `STORAGE_KEYS` 里（公共层由 Lead 维护，本模块不修改），
 * 但读写复用 `src/lib/storage.ts` 导出的 `readJSON` / `writeJSON`，
 * 因此跨标签页同步、快照缓存失效与 `useCollection` 订阅都能正常工作。
 * 无 localStorage 时（单元测试 / 隐私模式）自动降级为进程内存储。
 */

import type { BaseRecord, SandboxSymbolEntry, SymbolSubcategory } from '@/lib/types';
import { STORAGE_KEYS, readJSON, writeJSON } from '@/lib/storage';
import {
  SYMBOLS,
  getSymbolById,
  subcategoryCategory,
  subcategoryLabels,
  type SymbolCategory,
} from '@/sandbox/symbols';

/* -------------------------------------------------------------------------- */
/*                                  常量定义                                   */
/* -------------------------------------------------------------------------- */

/**
 * localStorage key。
 *
 * 这里原来硬编码了字符串 `'xinyu.symbolPacks'`，同时在
 * `src/lib/storage.ts` 的 `STORAGE_KEYS.symbolPacks` 里也有一份。
 * 两处字面量一致，所以没出过问题 —— 但这是个**漂移隐患**：
 * 哪天 `NAMESPACE` 改成别的，或者 key 名字微调，
 * 只有一处会跟着变，另一处静默失效（读到的永远是空数组，
 * 用户会以为"装的包丢了"，而没有任何报错）。
 *
 * 现在直接引用 `STORAGE_KEYS`，只有一处定义。
 */
export const SYMBOL_PACKS_STORAGE_KEY = STORAGE_KEYS.symbolPacks;

/** 本模块的格式字面量 */
export const SYMBOL_PACK_FORMAT = 'sandbox-symbol-pack/v1';

/**
 * 也接受 `src/lib/types.ts` 里的 `SymbolPackManifest` 格式（`symbol-pack/v1`），
 * 便于与既有类型 / 将来的 CLI 校验器对齐。读取时统一归一化为 `SymbolPackFILE`。
 */
export const SYMBOL_PACK_MANIFEST_FORMAT = 'symbol-pack/v1';

export const MAX_PACK_SYMBOLS = 2000;
export const MAX_IMAGE_DATA_URI = 200_000;
export const MAX_PACK_BYTES = 1_500_000;
const MAX_LABEL = 40;
const MAX_TAGS = 16;
const MAX_TAG_LENGTH = 24;
const MAX_NAME = 80;

/** 已知授权标识（SPDX 常用集 + proprietary）。也允许符合 SPDX 表达式的其它标识。 */
const KNOWN_LICENSES = new Set([
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'Unlicense',
  'proprietary',
]);

const LICENSE_REJECTED = new Set(['unknown', 'none', 'todo', 'n/a', 'na', '-', 'null', 'undefined']);

const SPDX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+-]*(?:(?: AND | OR | WITH )[A-Za-z0-9][A-Za-z0-9.+-]*)*$/;

/** 包内 symbol id：必须至少有一个 `.` 分隔的命名空间 */
const PACK_SYMBOL_ID = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;

/** 内置库的大类集合 */
const KNOWN_CATEGORIES = new Set<string>([
  'nature',
  'creature',
  'person',
  'building',
  'object',
  'abstract',
]);

const KNOWN_SUBCATEGORIES = new Set<string>(Object.keys(subcategoryLabels));

/* -------------------------------------------------------------------------- */
/*                                    类型                                     */
/* -------------------------------------------------------------------------- */

/** 包内单条沙具（原始声明，尚未归一化） */
export interface SymbolPackSymbol {
  /** 必须带命名空间，例如 `mypack.tree` */
  id: string;
  label: string;
  labelEn?: string;
  category: string;
  subcategory: string;
  /** emoji 或单字符；与 `image` 二选一 */
  glyph?: string;
  /** `data:image/*;base64,...`；禁止 http(s) URL */
  image?: string;
  tags?: string[];
}

/** 沙具包文件 v1 */
export interface SymbolPackFile {
  format: typeof SYMBOL_PACK_FORMAT | typeof SYMBOL_PACK_MANIFEST_FORMAT;
  /** 可选：包 id；缺省时从 symbol id 的公共前缀推导 */
  id?: string;
  name: string;
  version?: string;
  license: string;
  author?: string;
  description?: string;
  homepage?: string;
  symbols: SymbolPackSymbol[];
}

/** 已安装的包（localStorage 里的记录）。`id` 即包 id，`at` 为安装时间。 */
export interface InstalledSymbolPack extends BaseRecord {
  name: string;
  version: string;
  license: string;
  author: string;
  description?: string;
  /**
   * 归一化后的沙具条目（已带 packId / category / license）。
   *
   * 注意：`SandboxSymbolEntry` 是公共层的冻结类型（没有图片字段），
   * 所以以图代替 emoji 的条目在这里只放占位 glyph `🖼`，
   * 真正的 data URI 放在 `images[symbolId]` 里，渲染时由
   * `imageForSymbol()` / `packImageMap()` 查表。
   */
  symbols: SandboxSymbolEntry[];
  /** symbolId -> data URI（仅含用图片的条目） */
  images?: Record<string, string>;
}

export interface PackValidation {
  ok: boolean;
  issues: string[];
  pack?: SymbolPackFile;
}

export interface PackImportResult {
  ok: boolean;
  issues: string[];
  record?: InstalledSymbolPack;
}

/* -------------------------------------------------------------------------- */
/*                                 存储适配层                                  */
/* -------------------------------------------------------------------------- */

/** 无 localStorage 时的进程内降级存储（单元测试 / 隐私模式） */
let memoryPacks: InstalledSymbolPack[] = [];

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

/** 读取已安装包（不含排序保证；按安装时间倒序由 `listPacks` 处理） */
function readPacks(): InstalledSymbolPack[] {
  if (!hasLocalStorage()) return [...memoryPacks];
  const list = readJSON<InstalledSymbolPack[]>(SYMBOL_PACKS_STORAGE_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is InstalledSymbolPack =>
      !!item && typeof item === 'object' && typeof item.id === 'string' && Array.isArray(item.symbols),
  );
}

function writePacks(list: InstalledSymbolPack[]): void {
  if (!hasLocalStorage()) {
    memoryPacks = [...list];
    return;
  }
  writeJSON(SYMBOL_PACKS_STORAGE_KEY, list);
}

/* -------------------------------------------------------------------------- */
/*                                  校验工具                                   */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 校验授权标识：SPDX 标识、SPDX 表达式或 `proprietary` */
export function isValidLicense(license: unknown): boolean {
  if (!nonEmptyString(license)) return false;
  const value = license.trim();
  if (LICENSE_REJECTED.has(value.toLowerCase())) return false;
  if (KNOWN_LICENSES.has(value)) return true;
  if (value.length > 80) return false;
  return SPDX_PATTERN.test(value);
}

/** 校验 data URI 图片：只允许内嵌图片，不允许任何网络地址 */
export function isValidImageDataUri(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length > MAX_IMAGE_DATA_URI) return false;
  if (/^https?:/i.test(value.trim())) return false;
  return /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(value.trim());
}

/** 校验包内 symbol id：必须带命名空间且不与内置库冲突 */
export function isValidPackSymbolId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const value = id.trim();
  if (!PACK_SYMBOL_ID.test(value)) return false;
  if (getSymbolById(value)) return false;
  return true;
}

/** 从 symbol id 的公共命名空间前缀推导包 id；失败时用名称生成稳定 slug */
export function derivePackId(pack: Pick<SymbolPackFile, 'name' | 'symbols' | 'id'>): string {
  if (nonEmptyString(pack.id)) return slug(pack.id);
  const prefixes = new Set<string>();
  for (const symbol of pack.symbols) {
    if (typeof symbol?.id !== 'string') continue;
    const [prefix] = symbol.id.split('.');
    if (prefix) prefixes.add(prefix.toLowerCase());
  }
  if (prefixes.size === 1) {
    const [only] = [...prefixes];
    return slug(only);
  }
  return slug(pack.name) || 'pack';
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/* -------------------------------------------------------------------------- */
/*                                    校验                                     */
/* -------------------------------------------------------------------------- */

/**
 * 校验一份沙具包。**不抛异常**，全部问题以 `issues` 文本返回（中文，可直接展示）。
 *
 * 校验项：
 * - `format` 字面量（`sandbox-symbol-pack/v1`，兼容 `symbol-pack/v1`）
 * - `name` 非空且 ≤ 80 字；`license` 为 SPDX 标识或 `proprietary`
 * - `symbols` 为数组，1 ~ 2000 条
 * - 每条：id 带命名空间且不撞内置库 / 包内不重复；label 非空；
 *   subcategory 为 24 子类之一；glyph 或 data URI image 至少一项；
 *   image 不得是网络地址；tags 为字符串数组
 * - 整体序列化体积 ≤ 1.5MB
 *
 * @returns `ok` 为 true 时才给出归一化后的 `pack`（字段已裁剪、去空白）。
 */
export function validatePack(input: unknown): PackValidation {
  const issues: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, issues: ['文件内容不是一个 JSON 对象。'] };
  }

  const format = input.format;
  if (format !== SYMBOL_PACK_FORMAT && format !== SYMBOL_PACK_MANIFEST_FORMAT) {
    issues.push(`format 必须是 "${SYMBOL_PACK_FORMAT}"。`);
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) issues.push('缺少包名称 name。');
  else if (name.length > MAX_NAME) issues.push(`包名称过长（上限 ${MAX_NAME} 字）。`);

  if (!isValidLicense(input.license)) {
    issues.push('license 必须是 SPDX 标识（如 CC0-1.0 / MIT / CC-BY-4.0）或 proprietary。');
  }

  const rawSymbols = input.symbols;
  if (!Array.isArray(rawSymbols)) {
    issues.push('symbols 必须是数组。');
    return { ok: false, issues };
  }
  if (rawSymbols.length === 0) issues.push('这个包里没有沙具（symbols 为空）。');
  if (rawSymbols.length > MAX_PACK_SYMBOLS) {
    issues.push(`沙具数量超过上限 ${MAX_PACK_SYMBOLS} 条。`);
  }

  const seenIds = new Set<string>();
  const normalized: SymbolPackSymbol[] = [];

  rawSymbols.slice(0, MAX_PACK_SYMBOLS + 1).forEach((raw, index) => {
    const at = `第 ${index + 1} 条`;
    if (!isRecord(raw)) {
      issues.push(`${at}不是对象。`);
      return;
    }
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!isValidPackSymbolId(id)) {
      if (getSymbolById(id)) issues.push(`${at}的 id「${id}」与内置沙具重名，请加命名空间前缀。`);
      else issues.push(`${at}的 id「${id}」不合法：必须形如「mypack.tree」，即至少带一个命名空间前缀。`);
      return;
    }
    if (seenIds.has(id)) {
      issues.push(`${at}的 id「${id}」在包内重复。`);
      return;
    }
    seenIds.add(id);

    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    if (!label) {
      issues.push(`${at}（${id}）缺少 label。`);
      return;
    }
    if (label.length > MAX_LABEL) {
      issues.push(`${at}（${id}）的 label 超过 ${MAX_LABEL} 字。`);
      return;
    }

    const subcategory = typeof raw.subcategory === 'string' ? raw.subcategory.trim() : '';
    if (!KNOWN_SUBCATEGORIES.has(subcategory)) {
      issues.push(`${at}（${id}）的 subcategory「${subcategory}」不是已知子类。`);
      return;
    }

    const declaredCategory = typeof raw.category === 'string' ? raw.category.trim() : '';
    if (declaredCategory && !KNOWN_CATEGORIES.has(declaredCategory)) {
      issues.push(`${at}（${id}）的 category「${declaredCategory}」不是已知大类。`);
      return;
    }
    const derivedCategory = subcategoryCategory[subcategory as SymbolSubcategory];
    if (declaredCategory && declaredCategory !== derivedCategory) {
      issues.push(
        `${at}（${id}）的 category「${declaredCategory}」与子类「${subcategory}」不一致（应为「${derivedCategory}」）。`,
      );
      return;
    }

    const glyph = typeof raw.glyph === 'string' ? raw.glyph.trim() : '';
    const image = typeof raw.image === 'string' ? raw.image.trim() : '';
    if (!glyph && !image) {
      issues.push(`${at}（${id}）需要 glyph 或 image 其中一个。`);
      return;
    }
    if (glyph.length > 16) {
      issues.push(`${at}（${id}）的 glyph 太长，请只放一个字符/emoji。`);
      return;
    }
    if (image && !isValidImageDataUri(image)) {
      issues.push(`${at}（${id}）的 image 必须是以 data:image/ 开头的内嵌图片（不支持网络地址）。`);
      return;
    }

    const tags: string[] = [];
    if (raw.tags !== undefined) {
      if (!Array.isArray(raw.tags)) {
        issues.push(`${at}（${id}）的 tags 必须是字符串数组。`);
        return;
      }
      for (const tag of raw.tags) {
        if (typeof tag !== 'string') {
          issues.push(`${at}（${id}）的 tags 里含有非字符串项。`);
          return;
        }
        const value = tag.trim();
        if (!value) continue;
        if (value.length > MAX_TAG_LENGTH) {
          issues.push(`${at}（${id}）的检索词「${value}」超过 ${MAX_TAG_LENGTH} 字。`);
          return;
        }
        if (tags.length < MAX_TAGS && !tags.includes(value)) tags.push(value);
      }
    }

    const labelEn = typeof raw.labelEn === 'string' ? raw.labelEn.trim() : '';
    normalized.push({
      id,
      label,
      ...(labelEn ? { labelEn: labelEn.slice(0, MAX_LABEL) } : {}),
      // category 由子类唯一决定，避免外部数据出现「大类与子类不一致」
      category: derivedCategory,
      subcategory,
      ...(glyph ? { glyph } : {}),
      ...(image ? { image } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    });
  });

  if (issues.length > 0) return { ok: false, issues };

  const pack: SymbolPackFile = {
    format: SYMBOL_PACK_FORMAT,
    id: derivePackId({
      id: typeof input.id === 'string' ? input.id : undefined,
      name,
      symbols: normalized,
    }),
    name,
    version: nonEmptyString(input.version) ? input.version.trim().slice(0, 24) : '1.0.0',
    license: String(input.license).trim(),
    author: nonEmptyString(input.author) ? input.author.trim().slice(0, 60) : '未署名',
    ...(nonEmptyString(input.description)
      ? { description: String(input.description).trim().slice(0, 400) }
      : {}),
    ...(nonEmptyString(input.homepage) ? { homepage: String(input.homepage).trim().slice(0, 200) } : {}),
    symbols: normalized,
  };

  const size = byteLength(JSON.stringify(pack));
  if (size > MAX_PACK_BYTES) {
    issues.push(
      `这个包约 ${Math.round(size / 1024)}KB，超过 ${Math.round(MAX_PACK_BYTES / 1024)}KB 上限。建议缩小内嵌图片。`,
    );
    return { ok: false, issues };
  }

  return { ok: true, issues: [], pack };
}

/** 估算 UTF-8 字节数（不依赖 Buffer / TextEncoder 的浏览器实现差异） */
export function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1; // 代理对合起来算 4 字节
    } else bytes += 3;
  }
  return bytes;
}

/* -------------------------------------------------------------------------- */
/*                                  归一化                                     */
/* -------------------------------------------------------------------------- */

/** 把校验通过的包转成可安装记录（symbols 已归一化为 `SandboxSymbolEntry`） */
export function toInstalledPack(pack: SymbolPackFile, installedAt: string): InstalledSymbolPack {
  const packId = derivePackId(pack);
  const images: Record<string, string> = {};
  const symbols: SandboxSymbolEntry[] = pack.symbols.map((symbol) => {
    if (symbol.image) images[symbol.id] = symbol.image;
    return {
      id: symbol.id,
      label: symbol.label,
      ...(symbol.labelEn ? { labelEn: symbol.labelEn } : {}),
      category: symbol.category,
      subcategory: symbol.subcategory as SymbolSubcategory,
      // 图片条目的 glyph 用占位符，真实图在 images 表里
      glyph: symbol.glyph ?? '🖼',
      ...(symbol.tags ? { tags: symbol.tags } : {}),
      packId,
      license: pack.license,
    };
  });

  return {
    id: packId,
    at: installedAt,
    name: pack.name,
    version: pack.version ?? '1.0.0',
    license: pack.license,
    author: pack.author ?? '未署名',
    ...(pack.description ? { description: pack.description } : {}),
    symbols,
    ...(Object.keys(images).length > 0 ? { images } : {}),
  };
}

/** 已安装包里的 symbolId -> data URI 映射（合并所有包） */
export function packImageMap(packs: readonly InstalledSymbolPack[] = listPacks()): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pack of packs) {
    if (!pack.images) continue;
    Object.assign(map, pack.images);
  }
  return map;
}

/** 单条沙具的图片（没有则 undefined） */
export function imageForSymbol(
  symbolId: string,
  packs: readonly InstalledSymbolPack[] = listPacks(),
): string | undefined {
  for (const pack of packs) {
    const image = pack.images?.[symbolId];
    if (image) return image;
  }
  return undefined;
}

/** 从已安装包中取出全部沙具条目（扁平） */
export function symbolsFromPacks(packs: readonly InstalledSymbolPack[]): SandboxSymbolEntry[] {
  return packs.flatMap((pack) => pack.symbols);
}

/* -------------------------------------------------------------------------- */
/*                                本地安装 API                                 */
/* -------------------------------------------------------------------------- */

/** 已安装的包，按安装时间倒序 */
export function listPacks(): InstalledSymbolPack[] {
  return readPacks().sort((a, b) => b.at.localeCompare(a.at));
}

/** 已安装包提供的全部沙具 */
export function listPackSymbols(): SandboxSymbolEntry[] {
  return symbolsFromPacks(listPacks());
}

/**
 * 安装一个沙具包（同 id 覆盖，即「升级」）。
 * 入参是**已解析的 JSON 值**；从文件读取请用 `importPackFromText`。
 */
export function importPack(input: unknown): PackImportResult {
  const validation = validatePack(input);
  if (!validation.ok || !validation.pack) {
    return { ok: false, issues: validation.issues };
  }
  const record = toInstalledPack(validation.pack, new Date().toISOString());
  const rest = readPacks().filter((pack) => pack.id !== record.id);
  const next = [...rest, record];
  try {
    writePacks(next);
  } catch (error) {
    return {
      ok: false,
      issues: [`写入本地存储失败：${error instanceof Error ? error.message : String(error)}`],
    };
  }
  return { ok: true, issues: [], record };
}

/** 从文件文本安装（JSON.parse 失败也会给出中文 issue） */
export function importPackFromText(text: string): PackImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, issues: ['文件是空的。'] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, issues: ['不是有效的 JSON 文件。'] };
  }
  return importPack(parsed);
}

/** 卸载一个包；返回是否真的删掉了 */
export function removePack(id: string): boolean {
  const before = readPacks();
  const after = before.filter((pack) => pack.id !== id);
  if (after.length === before.length) return false;
  writePacks(after);
  return true;
}

/** 清空全部第三方包（内置库不受影响） */
export function clearPacks(): void {
  writePacks([]);
}

/** 供测试重置进程内降级存储 */
export function __resetPackMemory(): void {
  memoryPacks = [];
}

/* -------------------------------------------------------------------------- */
/*                                  只读参考                                   */
/* -------------------------------------------------------------------------- */

/** 内置库条目数，供 UI 文案「内置 327 件」使用 */
export const BUILTIN_SYMBOL_COUNT = SYMBOLS.length;

/** 单条沙具的展示 glyph：优先 glyph，其次图片占位，最后中性符号 */
export function entryGlyph(entry: SandboxSymbolEntry): string {
  if (entry.glyph) return entry.glyph;
  return '◌';
}

/** 沙具的大类标签路径，例如「自然 · 植物」 */
export function entryCategoryLabel(entry: SandboxSymbolEntry): string {
  const sub = subcategoryLabels[entry.subcategory] ?? '其它';
  const category = entry.category as SymbolCategory;
  return `${categoryLabelOf(category)} · ${sub}`;
}

function categoryLabelOf(category: SymbolCategory): string {
  return (
    {
      nature: '自然',
      creature: '生灵',
      person: '人物',
      building: '建筑',
      object: '物件',
      abstract: '抽象',
    } as Record<SymbolCategory, string>
  )[category] ?? '其它';
}
