/**
 * 心屿 · 沙具包订阅钩子
 *
 * 存储层复用 `src/lib/storage.ts` 的 `useCollection`（同 key 的写入会触发
 * 快照失效 + 跨标签页同步），因此第三方包的安装/卸载能实时反映到 UI。
 */

import { useMemo } from 'react';
import type { SandboxSymbolEntry } from '@/lib/types';
import { useCollection } from '@/lib/storage';
import {
  SYMBOL_PACKS_STORAGE_KEY,
  listPackSymbols,
  packImageMap,
  type InstalledSymbolPack,
} from './packs';

/** 已安装沙具包（按安装时间倒序） */
export function usePacks(): InstalledSymbolPack[] {
  return useCollection<InstalledSymbolPack>(SYMBOL_PACKS_STORAGE_KEY);
}

/** 已安装包提供的全部沙具条目（扁平、去重前） */
export function usePackSymbols(): SandboxSymbolEntry[] {
  const packs = usePacks();
  return useMemo(() => {
    void packs; // 依赖即触发重算
    return listPackSymbols();
  }, [packs]);
}

/** 已安装包的图片表：symbolId -> data URI */
export function usePackImageMap(): Record<string, string> {
  const packs = usePacks();
  return useMemo(() => packImageMap(packs), [packs]);
}
