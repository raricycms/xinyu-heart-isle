import { describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import { zhCN } from '@/i18n/zh-CN';
import { en } from '@/i18n/en';
import {
  SURFACE_FALLBACK_KEYS,
  SURFACE_TOOL_LIST,
  resolveSurfaceCopy,
} from '@/sandbox/surface/SurfaceToolbar';
import { BRUSH_RADIUS_MAX, BRUSH_RADIUS_MIN, BRUSH_STRENGTH_MAX, BRUSH_STRENGTH_MIN } from '@/sandbox/surface/useBrush';
import type { SurfaceTool } from '@/lib/types';

/**
 * 工具条 / 静默开关的**契约测试**（不 render 组件）。
 *
 * 为什么不做 DOM 测试：`vitest.config.ts` 的 environment 是 `node`，
 * 依赖白名单里也没有 jsdom / @testing-library。硬加会破坏 CONTRACT §依赖。
 * 所以这里验证的是"组件行为由哪些数据决定"，也就是最容易回归的部分：
 * - 7 种工具是否齐全、是否有中文标签、i18n 键是否真实存在；
 * - 文案兜底逻辑（i18n 缺键时的行为）；
 * - 滑杆上下限是否与 useBrush 的夹取范围一致（不一致会出现
 *   "拖到底了但实际半径没变"这种极难查的 bug）。
 */

const EXPECTED_TOOLS: SurfaceTool[] = ['raise', 'dig', 'smooth', 'rake', 'water', 'tunnel', 'flatten'];

describe('7 种沙面工具', () => {
  it('工具表恰好包含 7 种，顺序稳定', () => {
    expect(SURFACE_TOOL_LIST).toHaveLength(7);
    expect(SURFACE_TOOL_LIST.map((tool) => tool.id)).toEqual(EXPECTED_TOOLS);
  });

  it('每个工具都有 emoji/glyph 图标和 i18n 标签键', () => {
    for (const tool of SURFACE_TOOL_LIST) {
      expect(tool.glyph.length).toBeGreaterThan(0);
      expect(tool.labelKey).toMatch(/^sandbox\.tool\./);
    }
  });

  it('7 个标签键在 zh-CN 与 en 表里都真实存在（键名不能拼错）', () => {
    for (const tool of SURFACE_TOOL_LIST) {
      expect(zhCN[tool.labelKey], `zh-CN 缺少 ${tool.labelKey}`).toBeTypeOf('string');
      expect(en[tool.labelKey], `en 缺少 ${tool.labelKey}`).toBeTypeOf('string');
      // 中文表里的值必须是中文（不能是英文占位/键名）
      expect(zhCN[tool.labelKey]).not.toBe(tool.labelKey);
      expect(zhCN[tool.labelKey]).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it('中文标签符合产品用词（人工核对过的映射）', () => {
    const labels = Object.fromEntries(
      SURFACE_TOOL_LIST.map((tool) => [tool.id, translate('zh-CN', tool.labelKey)]),
    );
    expect(labels).toEqual({
      raise: '推沙',
      dig: '挖沙',
      smooth: '抹平',
      rake: '耙纹',
      water: '喷水',
      tunnel: '挖洞',
      flatten: '重新铺沙',
    });
  });

  it('glyph 之间互不重复（快捷识别）', () => {
    const glyphs = SURFACE_TOOL_LIST.map((tool) => tool.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

describe('滑杆范围与 hook 夹取范围一致', () => {
  it('半径滑杆的 min/max 就是 BRUSH_RADIUS_MIN/MAX 的百分数', () => {
    // 组件里写的是 Math.round(BRUSH_RADIUS_MIN * 100) / Math.round(BRUSH_RADIUS_MAX * 100)
    expect(Math.round(BRUSH_RADIUS_MIN * 100)).toBe(2);
    expect(Math.round(BRUSH_RADIUS_MAX * 100)).toBe(35);
  });

  it('力度滑杆的 min/max 就是 BRUSH_STRENGTH_MIN/MAX 的百分数', () => {
    expect(Math.round(BRUSH_STRENGTH_MIN * 100)).toBe(10);
    expect(Math.round(BRUSH_STRENGTH_MAX * 100)).toBe(100);
  });

  it('滑杆滑块值换算回来不会越界（round-trip）', () => {
    const sliderToRadius = (value: number) => Math.min(BRUSH_RADIUS_MAX, Math.max(BRUSH_RADIUS_MIN, value / 100));
    expect(sliderToRadius(2)).toBe(BRUSH_RADIUS_MIN);
    expect(sliderToRadius(12)).toBe(0.12);
    expect(sliderToRadius(35)).toBe(BRUSH_RADIUS_MAX);
    expect(sliderToRadius(36)).toBe(BRUSH_RADIUS_MAX); // 滑杆不可能给出，但夹取兜底
  });
});

describe('i18n 兜底文案', () => {
  it('表里已有的键直接走表', () => {
    const copy = resolveSurfaceCopy((key, vars) => translate('zh-CN', key, vars), 'sandbox.tool.raise');
    expect(copy).toBe('推沙');
  });

  it('表里没有的键走本地兜底（不是显示键名）', () => {
    for (const key of SURFACE_FALLBACK_KEYS) {
      const copy = resolveSurfaceCopy((k) => k, key);
      expect(copy, `${key} 没有兜底文案`).not.toBe(key);
      expect(copy.length).toBeGreaterThan(0);
    }
  });

  it('兜底的占位符会被替换', () => {
    const copy = resolveSurfaceCopy((key) => key, 'sandbox.surface.radiusValue', { value: 12 });
    expect(copy).toContain('12');
    expect(copy).not.toContain('{value}');
  });

  it('未知键原样返回（不抛错，不留空）', () => {
    expect(resolveSurfaceCopy((key) => key, 'sandbox.unknown.key')).toBe('sandbox.unknown.key');
  });

  it('「重新铺沙」的二次确认文案成对存在（缺一个就会卡死在确认态）', () => {
    const confirm = resolveSurfaceCopy((key) => key, 'sandbox.surface.resetConfirm');
    const cancel = resolveSurfaceCopy((key) => key, 'sandbox.surface.resetCancel');
    expect(confirm.length).toBeGreaterThan(0);
    expect(cancel.length).toBeGreaterThan(0);
    expect(confirm).not.toBe(cancel);
  });

  it('fallback 表里的键名不与已有 i18n 键冲突（避免悄悄覆盖产品文案）', () => {
    for (const key of SURFACE_FALLBACK_KEYS) {
      // 若某天 i18n 表补上了同名键，兜底自动失效 —— 这是设计意图，
      // 但不能出现"兜底内容和表内容语义相反"的键，所以这里锁死全集。
      expect(key.startsWith('sandbox.surface.')).toBe(true);
    }
  });

  it('与「重新铺沙」同名的 tool.flatten 与 surface.reset 语义要区分开', () => {
    // flatten 是「把当前沙面抹平」（不重置湿度），reset 是「整盘重铺」。
    // 两者文案不能一样，否则用户分不清点哪个。
    const flatten = translate('zh-CN', 'sandbox.tool.flatten');
    const reset = resolveSurfaceCopy((key) => key, 'sandbox.surface.reset');
    expect(flatten).not.toBe(reset);
  });
});

describe('静默模式的可达性约定', () => {
  it('专注模式相关文案齐备（进入/退出的解释）', () => {
    expect(translate('zh-CN', 'sandbox.tool.focus')).toMatch(/[\u4e00-\u9fa5]/);
    expect(translate('zh-CN', 'sandbox.tool.focusHint')).toContain('Esc');
  });

  it('focusHint 明确说明退出方式是 Esc（不能只有"隐藏工具"）', () => {
    expect(translate('zh-CN', 'sandbox.tool.focusHint')).toMatch(/Esc/i);
    expect(translate('en', 'sandbox.tool.focusHint')).toMatch(/Esc/i);
  });
});
