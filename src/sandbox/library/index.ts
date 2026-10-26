/**
 * 心屿 · 沙具库模块出口
 *
 * Lead 集成时 `import { SymbolTray, PromptPanel, AffectPicker, PackManager } from '@/sandbox/library'`
 * 即可（样式 `src/styles/sandbox-library.css` 由入口组件统一引入一次）。
 */

export { SymbolTray, glyphOf, type SymbolTrayProps } from './SymbolTray';
export { PromptPanel, type PromptPanelProps } from './PromptPanel';
export { AffectPicker, type AffectPickerProps } from './AffectPicker';
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
  PROMPT_STAGES,
  promptPoolSize,
  promptsForView,
  nextSeed,
  type PromptStage,
} from './prompts';

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
