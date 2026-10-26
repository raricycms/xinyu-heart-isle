/**
 * 对比度计算器（WCAG 2.1）。
 *
 * 为什么需要脚本：手算 0.2126R+0.7152G+0.0722B 加 gamma 反解很容易错一位，
 * 而 a11y 审计会拿真实浏览器算的值来比对，差 0.01 就可能从 4.49 变成 4.51。
 * 这里用与浏览器一致的公式，先把目标色算准再改 CSS。
 */

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/* --------------------------- 当前 site 的背景色 --------------------------- */
const BACKGROUNDS = {
  surface: hexToRgb('#fffdf9'),
  page: hexToRgb('#f6f3ec'),
  sunken: hexToRgb('#efeade'),
  raised: hexToRgb('#ffffff'),
};

/* ------------------------------ 当前前景色 ------------------------------- */
const CURRENT = {
  'ink-900': '#23282a',
  'ink-700': '#3f484b',
  'ink-500': '#667073',
  'ink-400': '#8b9497',
  'ink-300': '#aeb6b8',
  'teal-600': '#4d7d70',
  'good-600': '#4a7553',
  'watch-600': '#997335',
  'warn-600': '#a25f36',
  'alert-600': '#8f463b',
};

console.log('=== 当前色板对比度（AA 正文要求 ≥ 4.5，大字 ≥ 3.0）===');
console.log('前景'.padEnd(12) + Object.keys(BACKGROUNDS).map((k) => k.padStart(12)).join(''));
for (const [name, hex] of Object.entries(CURRENT)) {
  const row = Object.values(BACKGROUNDS).map((bg) => {
    const ratio = contrast(hexToRgb(hex), bg);
    const mark = ratio >= 4.5 ? '✓' : ratio >= 3 ? '~' : '✗';
    return `${ratio.toFixed(2)}${mark}`.padStart(12);
  });
  console.log(name.padEnd(12) + row.join(''));
}

/* ----------------------- 反解：满足 4.5:1 的最亮灰 ----------------------- */
console.log('\n=== 反解：在每种背景上达到 4.5:1 的最亮中性灰 ===');
for (const [bgName, bg] of Object.entries(BACKGROUNDS)) {
  // 二分找最亮的灰（同 R=G=B 附近微调色调）
  let lo = 0;
  let hi = 255;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const candidate = [mid, mid + 3, mid + 4]; // 略偏蓝灰，与站点色相协调
    if (contrast(candidate, bg) >= 4.5) lo = mid;
    else hi = mid;
  }
  const best = [lo, lo + 3, lo + 4];
  console.log(
    `${bgName.padEnd(9)} 最亮可用灰 ${rgbToHex(best)}  对比度 ${contrast(best, bg).toFixed(2)}`,
  );
}

/* --------------------------- 候选新色板 -------------======================== */
const CANDIDATES = {
  'ink-500': ['#4f595c', '#515b5e', '#545e61'],
  'ink-400': ['#5f696c', '#626c6f', '#646e71'],
};

console.log('\n=== 候选值在三种背景上的对比度 ===');
for (const [name, list] of Object.entries(CANDIDATES)) {
  for (const hex of list) {
    const ratios = Object.values(BACKGROUNDS).map((bg) => contrast(hexToRgb(hex), bg).toFixed(2));
    const worst = Math.min(...ratios.map(Number));
    console.log(
      `${name} ${hex}  surface ${ratios[0]}  page ${ratios[1]}  sunken ${ratios[2]}  raised ${ratios[3]}  最差 ${worst.toFixed(2)} ${worst >= 4.5 ? '✓' : '✗'}`,
    );
  }
}

/* -------------------- 语义色（good/watch/warn/alert）600 档 -------------------- */
console.log('\n=== 语义色 600 在 surface 上的对比度（用于文字）===');
for (const name of ['teal-600', 'good-600', 'watch-600', 'warn-600', 'alert-600']) {
  const hex = CURRENT[name];
  const onSurface = contrast(hexToRgb(hex), BACKGROUNDS.surface);
  console.log(`${name.padEnd(11)} ${hex}  ${onSurface.toFixed(2)} ${onSurface >= 4.5 ? '✓' : '✗ 需加深'}`);
}
