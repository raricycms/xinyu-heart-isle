/**
 * 沙具「字形 or 图片」解析。
 *
 * 背景：内置 327 个沙具全部由字形（emoji / 符号）驱动，
 * 但用户导入的沙具包可以携带真实图片（`sandbox-symbol-pack/v1` 的 `image` 字段）。
 * 图片型沙具**没有有意义的字形**，如果渲染层只管 `symbolGlyph()`，
 * 它们就会在沙盘上退化成一个占位符 —— 用户花力气导入的图片白导了。
 *
 * 三个渲染器（dom2d / iso2d / three）都从这里取，保证视觉一致。
 *
 * 注意：这个模块**不引入 React**，也不读 localStorage，
 * 便于 iso2d / three 的绘制循环（以及单元测试）直接使用。
 */
import { symbolGlyph, symbolLabel } from '@/sandbox/symbols';

/** 内置沙具缺字形时的兜底符号 */
export const GLYPH_FALLBACK = '◌';

/** `symbols.ts` 对未知 id 返回的占位标签 */
const UNKNOWN_LABEL = '未知';

/**
 * 沙具的展示字形。
 *
 * `symbolGlyph()` 对未知 id 已返回 `'◌'`，这里只需保证不返回空串
 * （空串会让 `fillText` 静默画不出东西，比占位符更难排查）。
 */
export function glyphFor(symbolId: string): string {
  const glyph = symbolGlyph(symbolId);
  return glyph && glyph.trim().length > 0 ? glyph : GLYPH_FALLBACK;
}

/**
 * 沙具的展示文字：优先中文名；未知 id 时退回 id 本身，
 * 这样沙具包里的自定义符号至少能显示成 `pack.tree` 而不是「未知」。
 */
export function labelFor(symbolId: string): string {
  const label = symbolLabel(symbolId);
  return label && label !== UNKNOWN_LABEL ? label : symbolId;
}

/** 该沙具是否有可用图片 */
export function hasImage(symbolId: string, imageMap?: Record<string, string>): boolean {
  return Boolean(imageMap && imageMap[symbolId]);
}

/**
 * 取沙具的图片 dataURL，没有则返回 `undefined`。
 *
 * 返回 `undefined`（而不是空串）是为了让调用方能用 `if (!image)` 判断，
 * 空串在 Canvas `drawImage` 里会静默失败并打一条难懂的报错。
 */
export function imageFor(symbolId: string, imageMap?: Record<string, string>): string | undefined {
  const value = imageMap?.[symbolId];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * canvas 图片缓存。
 *
 * 为什么需要：`drawImage` 接收 `HTMLImageElement`，而 `imageMap` 里存的是 dataURL。
 * 每个 dataURL 都要先 `new Image()` 解码；如果不缓存，拖动一次沙盘就会
 * 反复解码同一张图几十次，肉眼可见地卡。
 *
 * 缓存以 dataURL 为 key（同一符号的 id 可能变，但图片内容不变）。
 *
 * ── 为什么必须有上限 ────────────────────────────────────────────
 *
 * 这里存的是**已解码的 HTMLImageElement**，占的是位图内存，
 * 不是 dataURL 字符串那点体积：一张 512×512 的 RGBA 图约 1MB，
 * 而沙具包允许单张 dataURL 到 200KB —— 解码后往往膨胀好几倍。
 *
 * 没有上限时，一个含上千张图片的沙具包（MAX_PACK_SYMBOLS = 2000）
 * 逐页翻过去，缓存只增不减。用户症状是"用久了标签页变卡/崩"，
 * 而且**换一个会话不会好** —— 模块级 Map 活在整页生命周期里。
 *
 * 这正是 `docs/TESTING.md` §6.2.4 担心的形状。
 *
 * 用 LRU 而不是直接 limit：换出"最久没画过"的图，代价最小。
 * `Map` 的迭代顺序就是插入顺序，删了再 set 就能把它挪到末尾，
 * 不需要额外的双向链表。
 */
const IMAGE_CACHE_LIMIT = 64;
const imageCache = new Map<string, HTMLImageElement>();

/**
 * 把一张图放进缓存，超出上限时淘汰最久未使用的。
 *
 * 注意：**不要淘汰还没加载完的图**。它身上挂着 `onReady` 回调，
 * 删掉它就等于让那次重绘请求永远收不到通知 —— 画面会停在首帧，
 * 用户以为图片坏了。所以先从最老的开始找，跳过未完成的。
 */
function cacheImage(dataUrl: string, image: HTMLImageElement): void {
  imageCache.set(dataUrl, image);
  if (imageCache.size <= IMAGE_CACHE_LIMIT) return;

  for (const [key, value] of imageCache) {
    if (imageCache.size <= IMAGE_CACHE_LIMIT) break;
    if (key === dataUrl) continue;
    /* 还在解码的留着（见上面注释） */
    if (!(value.complete && value.naturalWidth > 0)) continue;
    imageCache.delete(key);
  }
}

/** 命中时把它挪到队尾（LRU 的"最近使用"） */
function touchImage(dataUrl: string, image: HTMLImageElement): void {
  imageCache.delete(dataUrl);
  imageCache.set(dataUrl, image);
}

/**
 * 取（或开始加载）一张图片。
 *
 * 首次调用返回的 `HTMLImageElement` 通常还没 `complete`，
 * 绘制方应检查 `.complete && .naturalWidth > 0` 再 `drawImage`，
 * 并在 `onload` 里请求重绘（`onReady` 回调）。
 */
export function loadImage(
  dataUrl: string,
  onReady?: () => void,
): HTMLImageElement | undefined {
  if (typeof Image === 'undefined') return undefined;
  const cached = imageCache.get(dataUrl);
  if (cached) {
    /* 命中即刷新"最近使用"顺序，否则 LRU 会退化成 FIFO */
    touchImage(dataUrl, cached);
    if (cached.complete && cached.naturalWidth > 0) return cached;
    // 还在加载：挂上回调，避免重复 new
    if (onReady) cached.addEventListener('load', onReady, { once: true });
    return cached;
  }
  const image = new Image();
  image.decoding = 'async';
  if (onReady) image.addEventListener('load', onReady, { once: true });
  image.src = dataUrl;
  cacheImage(dataUrl, image);
  return image;
}

/** 图片是否可以直接 `drawImage` */
export function imageReady(image: HTMLImageElement | undefined): image is HTMLImageElement {
  return Boolean(image && image.complete && image.naturalWidth > 0);
}

/** 仅供测试：清空缓存 */
export function __resetImageCache(): void {
  imageCache.clear();
}
