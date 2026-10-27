/**
 * 沙盘视图变换（缩放 / 平移 / 旋转）
 *
 * VISION §5.7 把「移动端手势：双指缩放/旋转、长按菜单」列为 P0，
 * 而 v2.0 收尾时才发现只有「长按」—— 缩放和旋转从来没实现过。
 * 沙盘在手机上摆满 327 个沙具时，不能放大就等于不能用。
 *
 * ── 设计上的一条硬约束 ────────────────────────────────────────
 *
 * **视图旋转不能影响数据语义。**
 *
 * 九宫格区域统计（`zoneOf`）按 x/y 三分。如果用户把视图转 90° 再摆，
 * 他会以为自己在「左上」，而数据记在「右上」—— 方位在沙盘里是有临床
 * 意义的（左上/右下不是随意分区），这种错位比不能旋转坏得多。
 *
 * 所以这里的旋转是**纯视觉**的：`items` 的 x/y 永远是未旋转的托盘坐标，
 * 只有屏幕呈现被转。为了让用户不会误解，旋转时角上会出现方位罗盘
 * （见 `ViewCompass`），把「哪边是上」明确画出来。
 *
 * ── 为什么用 CSS transform 而不是改渲染器 ──────────────────────
 *
 * 三种渲染器（dom2d / iso2d / three）各自坐标系完全不同。在渲染器里
 * 各实现一遍缩放旋转 = 三份逻辑三份 bug，而且 iso2d 是 Canvas 手绘、
 * three 是 WebGL，改造成本和风险都高。
 *
 * 把变换放在**包裹层**上，一次实现三种渲染器全受益，且天然满足
 * 上面那条硬约束：变换只作用于像素，数据模型的坐标不受影响。
 *
 * 代价是拖拽/落点需要反过来做一次逆变换（`screenToSandbox`），
 * 这比改三个渲染器便宜得多。
 */

import type { RefObject } from 'react';

/** 缩放范围。1 = 适配画布；上限 4 倍够看清单个沙具，下限 0.6 留一点余量。 */
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 4;

/**
 * 旋转吸附角度（度）。
 *
 * 自由旋转会让「我记得它在左上」变得不可靠，而沙盘方位有语义。
 * 吸附到 90° 的倍数，让视图只有四个确定朝向，用户能用直觉记住。
 * 量化的另一个好处：`zoneOf` 换算时只需要处理 0/90/180/270 四种情况。
 */
export const ROTATION_STEPS = [0, 90, 180, 270] as const;

/** 视图变换状态 */
export interface ViewTransform {
  scale: number;
  /** 平移，单位是渲染区域的百分比（0.1 = 移动了 10% 宽度） */
  tx: number;
  ty: number;
  /** 旋转角度（度），只取 ROTATION_STEPS 里的值 */
  rotate: number;
}

export const DEFAULT_TRANSFORM: ViewTransform = {
  scale: 1,
  tx: 0,
  ty: 0,
  rotate: 0,
};

export function clampScale(scale: number): number {
  /*
   * 只有 NaN 需要退回 1 —— 它没有大小可言，夹取也救不回来，
   * 而 `scale(NaN)` 会让整条 CSS transform 声明失效（又是一个静默失败）。
   *
   * +Infinity / -Infinity **必须**走正常夹取路径得到 MAX/MIN：
   * 手指飞快张开时 `next.distance / prev.distance` 理论上可以是 Infinity
   * （prev.distance 极小时），把它当成「超大缩放」夹到上限才是对的；
   * 用 `!isFinite` 一刀切退回 1，会让一次极快的张开把缩放**重置**，
   * 用户看到的是「放大到一半突然弹回原大小」。
   * 这条是单测抓出来的。
   */
  if (Number.isNaN(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** 把任意角度吸附到最近的 90° 倍数 */
export function snapRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const normalized = ((deg % 360) + 360) % 360;
  const index = Math.round(normalized / 90) % 4;
  return ROTATION_STEPS[index] ?? 0;
}

/** 生成 CSS transform 字符串。平移用百分比，缩放和旋转原点都是中心。 */
export function toCssTransform(view: ViewTransform): string {
  const parts: string[] = [];
  // 顺序有意义：先平移再旋转，用户拖动的手感才和屏幕方向一致。
  if (view.tx !== 0 || view.ty !== 0) {
    parts.push(`translate(${(view.tx * 100).toFixed(3)}%, ${(view.ty * 100).toFixed(3)}%)`);
  }
  if (view.rotate !== 0) parts.push(`rotate(${view.rotate}deg)`);
  if (view.scale !== 1) parts.push(`scale(${view.scale.toFixed(4)})`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * 屏幕坐标 → 沙盘归一化坐标。
 *
 * 这是整个视图变换里**唯一容易出错**的地方，也是必须和渲染器共用同一份
 * 实现的原因：如果这里算错，笔刷画在错的位置、拖拽落点偏移、点击选中的
 * 是旁边那个摆件 —— 而且全部是「看起来能用、仔细用就错」的形态，
 * 自动化测试很难抓到。
 *
 * 变换顺序（与 `toCssTransform` 相反，矩阵逆运算）：
 *   1. 把点从屏幕移到元素中心（transform-origin 是中心）
 *   2. 除以缩放
 *   3. 反向旋转
 *   4. 减掉平移
 *   5. 移回左上角、归一化
 *
 * @param clientX 屏幕坐标 X（`event.clientX`）
 * @param clientY 屏幕坐标 Y
 * @param rect    渲染区域的 `getBoundingClientRect()`
 * @param view    当前视图变换
 */
export function screenToSandbox(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  view: ViewTransform,
): { x: number; y: number } {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  // 1. 相对中心
  let dx = clientX - centerX;
  let dy = clientY - centerY;

  // 2. 除以缩放
  const scale = clampScale(view.scale);
  dx /= scale;
  dy /= scale;

  // 3. 反向旋转（CSS 的 rotate 是顺时针，逆变换是逆时针）
  if (view.rotate !== 0) {
    const rad = (-view.rotate * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    dx = rx;
    dy = ry;
  }

  // 4. 减掉平移（平移用的是百分比，相对元素自身尺寸）
  dx -= view.tx * rect.width;
  dy -= view.ty * rect.height;

  // 5. 回左上角并归一化
  const x = (dx + rect.width / 2) / rect.width;
  const y = (dy + rect.height / 2) / rect.height;

  return { x, y };
}

/**
 * 双指手势 → 视图变换增量。
 *
 * 用「上一次的两指状态」和「这一次的两指状态」求增量，
 * 而不是从手势开始累计 —— 增量式不会因为丢帧而跳变。
 */
export interface PointerPair {
  /** 两指中点（屏幕坐标） */
  midX: number;
  midY: number;
  /** 两指距离 */
  distance: number;
  /** 两指连线角度（度） */
  angle: number;
}

export function pointerPair(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
): PointerPair {
  const midX = (a.clientX + b.clientX) / 2;
  const midY = (a.clientY + b.clientY) / 2;
  const dx = b.clientX - a.clientX;
  const dy = b.clientY - a.clientY;
  return {
    midX,
    midY,
    distance: Math.hypot(dx, dy),
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/**
 * 由前后两帧的手势状态算出视图增量。
 *
 * @param prev   上一帧
 * @param next   这一帧
 * @param start  手势开始时的视图（缩放要基于它，避免连续乘法累积误差）
 * @param rect   渲染区域尺寸（平移百分比需要）
 */
export function applyPinch(
  prev: PointerPair,
  next: PointerPair,
  start: ViewTransform,
  rect: { width: number; height: number },
): ViewTransform {
  // 缩放：用面积比而不是距离比，手感更接近系统级手势
  const ratio = prev.distance > 1 ? next.distance / prev.distance : 1;
  const scale = clampScale(start.scale * ratio);

  // 旋转：先看角度差，超过 25° 才认为用户想转（避免缩放时手抖误触）
  let deltaAngle = next.angle - prev.angle;
  // 处理 ±180 跨界
  if (deltaAngle > 180) deltaAngle -= 360;
  if (deltaAngle < -180) deltaAngle += 360;

  let rotate = start.rotate;
  if (Math.abs(deltaAngle) > 25) {
    rotate = snapRotation(start.rotate + deltaAngle);
  }

  // 平移：手指中点移动了多少
  const tx = rect.width > 0 ? start.tx + (next.midX - prev.midX) / rect.width : start.tx;
  const ty = rect.height > 0 ? start.ty + (next.midY - prev.midY) / rect.height : start.ty;

  return { scale, tx, ty, rotate };
}

/** 桌面端：Ctrl/⌘ + 滚轮缩放 */
export function applyWheelZoom(
  view: ViewTransform,
  deltaY: number,
): ViewTransform {
  // 指数缩放，手感线性
  const factor = Math.exp(-deltaY * 0.002);
  return { ...view, scale: clampScale(view.scale * factor) };
}

/** 复位 */
export function resetTransform(): ViewTransform {
  return { ...DEFAULT_TRANSFORM };
}

/** 是否为默认视图（用于显示/隐藏「复位」按钮） */
export function isDefaultView(view: ViewTransform): boolean {
  return view.scale === 1 && view.tx === 0 && view.ty === 0 && view.rotate === 0;
}

/** 方位罗盘上的四个字，按 rotate 换算「屏幕上方」对应托盘的哪一边 */
export function compassLabels(rotate: number): { top: string; right: string; bottom: string; left: string } {
  // 托盘基准方位：上=北
  const base = ['北', '东', '南', '西'];
  const steps = (snapRotation(rotate) / 90) % 4;
  return {
    top: base[steps] ?? '北',
    right: base[(steps + 1) % 4] ?? '东',
    bottom: base[(steps + 2) % 4] ?? '南',
    left: base[(steps + 3) % 4] ?? '西',
  };
}

/** 供 ref 读取的元素 ref 类型别名，方便调用方声明 */
export type StageRef = RefObject<HTMLDivElement | null>;
