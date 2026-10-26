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
 */
const imageCache = new Map<string, HTMLImageElement>();

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
    if (cached.complete && cached.naturalWidth > 0) return cached;
    // 还在加载：挂上回调，避免重复 new
    if (onReady) cached.addEventListener('load', onReady, { once: true });
    return cached;
  }
  const image = new Image();
  image.decoding = 'async';
  if (onReady) image.addEventListener('load', onReady, { once: true });
  image.src = dataUrl;
  imageCache.set(dataUrl, image);
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
