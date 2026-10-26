/**
 * 色板反解器：给定目标对比度，解出满足要求且**视觉变化最小**的颜色。
 *
 * 目标：修 a11y 但不能把「安静温和」的设计感改没了。
 * 所以策略是「在保持色相与饱和度的前提下只压亮度」，而不是随便换色。
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
const hexToRgb = (h) => {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

const BG = {
  surface: hexToRgb('#fffdf9'),
  page: hexToRgb('#f6f3ec'),
  sunken: hexToRgb('#efeade'),
  raised: hexToRgb('#ffffff'),
};

/**
 * 沿亮度方向缩放（保持色相比例），直到在**所有**背景上都达标。
 * scale<1 变暗、>1 变亮；我们只用变暗。
 */
function solveDarken(hex, backgrounds, target) {
  const base = hexToRgb(hex);
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i += 1) {
    const k = (lo + hi) / 2;
    const cand = base.map((v) => v * k);
    const ok = Object.values(backgrounds).every((bg) => contrast(cand, bg) >= target);
    if (ok) lo = k; else hi = k;
  }
  const best = base.map((v) => v * lo);
  return rgbToHex(best);
}

const TARGET = 4.5;

const TOKENS = {
  'ink-300': '#aeb6b8',
  'ink-400': '#8b9497',
  'ink-500': '#667073',
  'teal-500': '#4d7d70',
  'teal-600': '#3d655a',
  'good-600': '#4a7553',
  'watch-600': '#997335',
  'warn-600': '#a25f36',
  'alert-600': '#8f463b',
};

console.log('=== 反解：保持色相，压暗到所有背景 ≥4.5:1 ===\n');
const results = {};
for (const [name, hex] of Object.entries(TOKENS)) {
  const before = Object.entries(BG).map(([k, bg]) => `${k.slice(0, 3)} ${contrast(hexToRgb(hex), bg).toFixed(2)}`);
  const solved = solveDarken(hex, BG, TARGET);
  const after = Object.entries(BG).map(([k, bg]) => `${k.slice(0, 3)} ${contrast(hexToRgb(solved), bg).toFixed(2)}`);
  const worstAfter = Math.min(...Object.values(BG).map((bg) => contrast(hexToRgb(solved), bg)));
  results[name] = { before: hex, after: solved, worst: worstAfter };
  console.log(`${name.padEnd(10)} ${hex} -> ${solved}   最差 ${worstAfter.toFixed(2)} ${worstAfter >= TARGET ? '✓' : '✗'}`);
  console.log(`   前: ${before.join('  ')}`);
  console.log(`   后: ${after.join('  ')}\n`);
}

/* ---------------- 大字 / 非正文：只需 3:1，保留更亮的层级 ---------------- */
console.log('=== 3:1 档（仅用于大字或纯装饰，不进正文）===\n');
for (const [name, hex] of Object.entries({ 'ink-300': '#aeb6b8' })) {
  const solved = solveDarken(hex, BG, 3.0);
  const worst = Math.min(...Object.values(BG).map((bg) => contrast(hexToRgb(solved), bg)));
  console.log(`${name} ${hex} -> ${solved}  最差 ${worst.toFixed(2)}`);
}

/* ---------------------- 输出可直接粘进 global.css 的片段 ---------------------- */
console.log('\n=== 建议替换（global.css :root 文字区块）===\n');
const lines = [];
for (const [name, r] of Object.entries(results)) {
  if (['teal-500', 'good-600', 'watch-600', 'warn-600', 'alert-600'].includes(name)) continue;
  lines.push(`  --${name}: ${r.after};`);
}
console.log(lines.join('\n'));

console.log('\n=== 语义色（用于文字时）===\n');
for (const name of ['teal-500', 'good-600', 'watch-600', 'warn-600', 'alert-600']) {
  console.log(`  --${name}: ${results[name].after};  /* 原 ${results[name].before} */`);
}
