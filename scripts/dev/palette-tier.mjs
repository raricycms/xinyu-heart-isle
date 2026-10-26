/**
 * 三级灰阶重解：保证「都过 AA」且「彼此可辨」。
 *
 * 问题：把 ink-300/400/500 各自压暗到刚好 4.5:1，三者会挤在同一个灰上
 * （#666b6c / #656b6d / #626c6f），视觉层级消失 —— 修了 a11y 却毁了设计。
 *
 * 解法：给三级**指定不同的对比度档位**，反解出对应的灰。
 * 正文小字统一用最深的 ink-500，轻微辅助信息用 ink-400，
 * ink-300 只用于装饰（边框/图标），不再承担文字。
 */

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
const luminance = ([r, g, b]) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
function contrast(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

const PAGE = [0xf6, 0xf3, 0xec];      // 最浅背景就是最严苛的（深字在浅底上）
const SUNKEN = [0xef, 0xea, 0xde];    // 比 page 稍深，是对比最难的背景

/** 找「在该背景上达到 target 的最亮灰」，带一点蓝灰偏色以贴合站点色相 */
function solveGray(target, bg) {
  let lo = 0, hi = 255;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    // 站点灰是冷灰：G 略高、R 略低
    const cand = [mid - 2, mid + 2, mid + 3];
    if (contrast(cand, bg) >= target) lo = mid;
    else hi = mid;
  }
  return rgbToHex([lo - 2, lo + 2, lo + 3]);
}

console.log('=== 三级灰阶（按最严苛背景 sunken 反解，保证全背景达标）===\n');
console.log('目标档位：ink-500 = 7.0:1（正文小字，最强）');
console.log('           ink-400 = 5.5:1（次要文字）');
console.log('           ink-300 = 4.6:1（最弱仍 AA，仅少量使用）\n');

const tier = { 'ink-500': 7.0, 'ink-400': 5.5, 'ink-300': 4.6 };
const out = {};
for (const [name, target] of Object.entries(tier)) {
  const hex = solveGray(target, SUNKEN);
  const rgb = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const onPage = contrast(rgb, PAGE);
  const onWhite = contrast(rgb, [255, 255, 255]);
  out[name] = hex;
  console.log(
    `${name}  ${hex}   sunken ${contrast(rgb, SUNKEN).toFixed(2)}  page ${onPage.toFixed(2)}  white ${onWhite.toFixed(2)}  ${onPage >= 4.5 ? '✓' : '✗'}`,
  );
}

/* 检查三者是否有足够视觉区分（相邻亮度差） */
console.log('\n=== 区分度检查 ===');
const names = ['ink-500', 'ink-400', 'ink-300'];
for (let i = 0; i < names.length - 1; i += 1) {
  const a = out[names[i]], b = out[names[i + 1]];
  const la = luminance([parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)]);
  const lb = luminance([parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)]);
  const delta = Math.abs(la - lb) * 100;
  console.log(`${names[i]} vs ${names[i + 1]}: 相对亮度差 ${delta.toFixed(2)}%  ${delta > 1.5 ? '✓ 可辨' : '✗ 太接近'}`);
}

/* ink-300 改为纯装饰用色（边框/图标），不承担文字 */
console.log('\n=== 语义色修正（只在必要时压暗）===');
const SEMANTIC = {
  'teal-500': ['#4d7d70', 4.5],
  'watch-600': ['#997335', 4.5],
  'good-600': ['#4a7553', 4.5],
  'warn-600': ['#a25f36', 4.5],
};
function darken(hex, target) {
  const base = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const k = (lo + hi) / 2;
    const cand = base.map((v) => v * k);
    const ok = [PAGE, SUNKEN, [0xff, 0xff, 0xf9], [255, 255, 255]].every((bg) => contrast(cand, bg) >= target);
    if (ok) lo = k; else hi = k;
  }
  return rgbToHex(base.map((v) => v * lo));
}
for (const [name, [hex, target]] of Object.entries(SEMANTIC)) {
  const solved = darken(hex, target);
  const rgb = [parseInt(solved.slice(1, 3), 16), parseInt(solved.slice(3, 5), 16), parseInt(solved.slice(5, 7), 16)];
  const worst = Math.min(...[PAGE, SUNKEN, [0xff, 0xff, 0xf9], [255, 255, 255]].map((bg) => contrast(rgb, bg)));
  console.log(`  --${name}: ${solved};  /* 原 ${hex}，最差 ${worst.toFixed(2)} */`);
}
