/**
 * 心屿 · 沙具库模块出口
 *
 * 产品实际使用的只有 `SymbolTray`（沙具库主界面）和 `usePackImageMap`（图片映射）。
 * 其余是供外部按 `docs/FORMAT.md` 接入的公共 API（`PackManager` 等）。
 */

export { SymbolTray, glyphOf, type SymbolTrayProps } from './SymbolTray';
export { PackManager, type PackManagerProps } from './PackManager';

export {
  searchEntries,
  filterByCategory,
  groupBySubcategory,
  subcategoriesOf,
  mergeEntries,
  starterEntries,
  scoreEntry,
  expandTokens,
} from './search';


export {
  SYMBOL_PACK_FORMAT,
  SYMBOL_PACK_MANIFEST_FORMAT,
  SYMBOL_PACKS_STORAGE_KEY,
  MAX_PACK_SYMBOLS,
  MAX_IMAGE_DATA_URI,
  MAX_PACK_BYTES,
  validatePack,
  isValidLicense,
  isValidImageDataUri,
  isValidPackSymbolId,
  derivePackId,
  toInstalledPack,
  symbolsFromPacks,
  listPacks,
  listPackSymbols,
  importPack,
  importPackFromText,
  removePack,
  clearPacks,
  packImageMap,
  imageForSymbol,
  entryGlyph,
  entryCategoryLabel,
  byteLength,
  BUILTIN_SYMBOL_COUNT,
  type SymbolPackFile,
  type SymbolPackSymbol,
  type InstalledSymbolPack,
  type PackValidation,
  type PackImportResult,
} from './packs';

export { usePacks, usePackSymbols, usePackImageMap } from './usePacks';
