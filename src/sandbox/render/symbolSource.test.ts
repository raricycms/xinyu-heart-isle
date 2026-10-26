/**
 * 图片型沙具在三种渲染器里的解析。
 *
 * 背景：内置 327 个沙具都是字形驱动，但用户导入的沙具包可以带 `image`。
 * 这类沙具没有有意义的字形，如果渲染层只画字形，用户导入的图就白导了。
 * 本文件锁住三条不变量：
 *   1. `imageFor()` 只对非空字符串返回真值；
 *   2. 没有图片时 `glyphFor()` 一定给出可画的东西（不返回空串）；
 *   3. `imageReady()` 在图片未解码完成时返回 false —— 调用方据此走字形兜底。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GLYPH_FALLBACK,
  __resetImageCache,
  glyphFor,
  hasImage,
  imageFor,
  imageReady,
  labelFor,
  loadImage,
} from '@/sandbox/render/symbolSource';
import { SYMBOLS } from '@/sandbox/symbols';

afterEach(() => {
  __resetImageCache();
  vi.unstubAllGlobals();
});

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

describe('imageFor / hasImage', () => {
  it('没有 imageMap 时返回 undefined', () => {
    expect(imageFor('tree')).toBeUndefined();
    expect(hasImage('tree')).toBe(false);
  });

  it('imageMap 里没有该 id 时返回 undefined', () => {
    const map = { 'pack.other': DATA_URL };
    expect(imageFor('tree', map)).toBeUndefined();
    expect(hasImage('tree', map)).toBe(false);
  });

  it('命中时返回 dataURL', () => {
    const map = { 'pack.tree': DATA_URL };
    expect(imageFor('pack.tree', map)).toBe(DATA_URL);
    expect(hasImage('pack.tree', map)).toBe(true);
  });

  it('空字符串按「没有图片」处理（避免 drawImage 静默失败）', () => {
    const map = { 'pack.tree': '' };
    expect(imageFor('pack.tree', map)).toBeUndefined();
    expect(hasImage('pack.tree', map)).toBe(false);
  });
});

describe('glyphFor', () => {
  it('内置沙具返回它自己的字形', () => {
    const first = SYMBOLS[0];
    expect(glyphFor(first.id)).toBe(first.glyph);
  });

  it('未知 id 返回兜底符号，绝不返回空串', () => {
    const glyph = glyphFor('pack.does-not-exist');
    expect(glyph).toBe(GLYPH_FALLBACK);
    expect(glyph.trim().length).toBeGreaterThan(0);
  });

  it('全部内置沙具都能给出非空字形', () => {
    const empty = SYMBOLS.filter((entry) => glyphFor(entry.id).trim().length === 0);
    expect(empty).toEqual([]);
  });
});

describe('labelFor', () => {
  it('内置沙具用中文名', () => {
    const first = SYMBOLS[0];
    expect(labelFor(first.id)).toBe(first.label);
  });

  it('未知 id 退回 id 本身（而不是「未知」这种无信息文本）', () => {
    expect(labelFor('pack.my-tree')).toBe('pack.my-tree');
  });
});

describe('loadImage / imageReady', () => {
  it('无 Image 全局时安全返回 undefined（SSR / 测试环境）', () => {
    vi.stubGlobal('Image', undefined);
    expect(loadImage(DATA_URL)).toBeUndefined();
    expect(imageReady(undefined)).toBe(false);
  });

  it('同一 dataURL 只 new 一次 Image（缓存生效）', () => {
    let created = 0;
    class FakeImage {
      complete = false;
      naturalWidth = 0;
      decoding = '';
      src = '';
      private handlers: Array<() => void> = [];
      constructor() {
        created += 1;
      }
      addEventListener(fn: () => void) {
        this.handlers.push(fn);
      }
      fire() {
        this.handlers.forEach((fn) => fn());
      }
    }
    vi.stubGlobal('Image', FakeImage as unknown as typeof globalThis.Image);

    const a = loadImage(DATA_URL);
    const b = loadImage(DATA_URL);
    expect(created).toBe(1);
    expect(a).toBe(b);
  });

  it('未 complete 的图片 imageReady 为 false，complete 且有宽度后为 true', () => {
    class FakeImage {
      complete = false;
      naturalWidth = 0;
      decoding = '';
      src = '';
      addEventListener() {}
    }
    vi.stubGlobal('Image', FakeImage as unknown as typeof globalThis.Image);
    const image = loadImage(DATA_URL) as unknown as FakeImage;
    expect(imageReady(image as never)).toBe(false);
    image.complete = true;
    image.naturalWidth = 64;
    expect(imageReady(image as never)).toBe(true);
  });

  it('complete 但宽度为 0 视为未就绪（解码失败的坏图）', () => {
    class FakeImage {
      complete = true;
      naturalWidth = 0;
      decoding = '';
      src = '';
      addEventListener() {}
    }
    vi.stubGlobal('Image', FakeImage as unknown as typeof globalThis.Image);
    const image = loadImage(DATA_URL);
    expect(imageReady(image)).toBe(false);
  });
});
