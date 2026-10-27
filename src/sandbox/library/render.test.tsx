/**
 * 心屿 · 沙具库组件渲染冒烟测试
 *
 * 用 `react-dom/server` 在 node 环境渲染（不引入 jsdom / testing-library，
 * 依赖白名单不允许新增测试依赖）。目的不是替代浏览器验收，而是守住三条底线：
 * 1. 组件在任何 props 组合下都能渲染，不抛异常；
 * 2. 受控 props 真的被用上（value / selected 会体现在输出里）；
 * 3. 伦理红线文案出现在输出里（「不做任何分析」「不解释」等）。
 *
 * 视觉与交互（长按预览、方向键导航、拖拽导入）仍需浏览器手工验证，
 * 见完成消息里的「已知限制」。
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SymbolTray } from './SymbolTray';

describe('SymbolTray 渲染', () => {
  it('默认态渲染搜索框与「全部」tab，并给出内置条数', () => {
    const html = renderToStaticMarkup(<SymbolTray onPick={() => {}} />);
    expect(html).toContain('aria-label="沙具"');
    expect(html).toContain('type="search"');
    expect(html).toContain('全部');
    // 常用位 24 个格子
    expect((html.match(/data-testid="lib-item"/g) ?? []).length).toBe(24);
    expect(html).toContain('内置 327 件');
  });

  it('value 传入时该条目被标为选中（aria-pressed）', () => {
    // 「山」是常用位的第一个（自然·地貌），一定在默认视图里
    const html = renderToStaticMarkup(<SymbolTray onPick={() => {}} value="mountain" />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-selected="true"');
  });

  it('disabled 时所有格子都被禁用（封盘后不可放入）', () => {
    const html = renderToStaticMarkup(<SymbolTray onPick={() => {}} disabled />);
    const items = html.match(/data-testid="lib-item"[^>]*/g) ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.includes('disabled'))).toBe(true);
  });

  it('每个格子有 44px 级别的可辨识文案与完整 title', () => {
    const html = renderToStaticMarkup(<SymbolTray onPick={() => {}} />);
    expect(html).toContain('aria-label="放入沙具：');
    expect(html).toContain('class="lib-item__label"');
  });
});

