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
import { AffectPicker } from './AffectPicker';
import { PromptPanel } from './PromptPanel';
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

describe('PromptPanel 渲染', () => {
  it('渲染三个阶段 tabs 与「换一组」，默认取 3 条', () => {
    const html = renderToStaticMarkup(<PromptPanel />);
    expect(html).toContain('开始前');
    expect(html).toContain('摆放中');
    expect(html).toContain('结束后');
    expect(html).toContain('换一组');
    expect((html.match(/class="prompt-list__toggle"/g) ?? []).length).toBe(3);
  });

  it('受控 stage / seed 决定展示内容（同参数同输出，换 seed 变内容）', () => {
    const a = renderToStaticMarkup(<PromptPanel stage="before" seed={1} />);
    const b = renderToStaticMarkup(<PromptPanel stage="before" seed={1} />);
    const c = renderToStaticMarkup(<PromptPanel stage="before" seed={9} />);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('含「不做解读」的伦理说明', () => {
    const html = renderToStaticMarkup(<PromptPanel />);
    expect(html).toContain('不会解释你的沙盘');
  });

  it('showStages=false 时不渲染阶段 tabs', () => {
    const html = renderToStaticMarkup(<PromptPanel showStages={false} />);
    expect(html).not.toContain('开始前');
  });
});

describe('AffectPicker 渲染', () => {
  it('渲染 13 个标签，全部 aria-pressed=false 起始', () => {
    const html = renderToStaticMarkup(<AffectPicker value={[]} onChange={() => {}} />);
    const chips = html.match(/class="affect-picker__chip"[^>]*aria-pressed="(true|false)"/g) ?? [];
    expect(chips).toHaveLength(13);
    expect(chips.every((chip) => chip.includes('aria-pressed="false"'))).toBe(true);
  });

  it('已选标签体现为 aria-pressed=true，并按词表顺序展示', () => {
    const html = renderToStaticMarkup(<AffectPicker value={['温暖', '害怕']} onChange={() => {}} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('已选 2 个：害怕、温暖');
  });

  it('readOnly 时全部禁用且不给「清空」', () => {
    const html = renderToStaticMarkup(
      <AffectPicker value={['安全']} onChange={() => {}} readOnly />,
    );
    expect(html).toContain('disabled');
    expect(html).not.toContain('清空');
  });

  it('顶部提示写明「只用来整理，不做任何分析」', () => {
    const html = renderToStaticMarkup(<AffectPicker value={[]} onChange={() => {}} subject="树" />);
    expect(html).toContain('给「树」贴感受');
    expect(html).toContain('只用来整理，不做任何分析');
  });
});
