/**
 * 心屿 · 沙面笔刷引擎（L2 高度场雕刻）
 *
 * VISION.md §5.1 的设计落点：
 * - **推沙（raise）/ 挖沙（dig）**：沿笔刷路径抬升/下压，笔刷内软化衰减；
 * - **抹平（smooth）**：向邻域均值收敛；
 * - **耙纹（rake）**：一笔多线，产生平行沟槽；
 * - **喷水（water）**：提高局部湿度，湿沙允许更陡的休止角；
 * - **抹平全场（flatten）**：回到基准面；
 * - **隧道（tunnel）**：在湿沙上挖出贯通的低矮通道。
 *
 * 所有函数都是**纯函数**：返回新的 `SurfaceState`，不修改入参。
 * 这一层不接触 DOM，单元测试可直接覆盖。
 */

import type { SurfaceTool } from '@/lib/types';
import {
  SURFACE_BASE_LEVEL,
  cloneSurfaceState,
  createSurfaceState,
  getHeight,
  relax,
  type HeightField,
  type SurfaceState,
} from './surfaceCodec';

/** 笔刷参数 */
export interface BrushOptions {
  /** 笔刷中心（归一化 0~1） */
  x: number;
  y: number;
  /** 笔刷半径（归一化，相对画布宽度） */
  radius: number;
  /** 力度 0~1 */
  strength: number;
  /** 本次笔画已走过的路径长度系数（用于耙纹相位） */
  phase?: number;
}

const HEIGHT_MIN = 0;
const HEIGHT_MAX = 255;

function clampByte(value: number): number {
  return Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.round(value)));
}

/**
 * 笔刷权重：中心 1，边缘 0，用 smoothstep 让边缘柔和。
 * 返回 0~1。
 */
function brushWeight(distance: number, radius: number): number {
  if (radius <= 0) return 0;
  const t = distance / radius;
  if (t >= 1) return 0;
  // smoothstep: 3t² - 2t³，反向使用使中心为 1
  const s = 1 - t;
  return s * s * (3 - 2 * s);
}

/** 把归一化坐标换算成格坐标 */
function toGrid(field: HeightField, x: number, y: number): { cx: number; cy: number } {
  return {
    cx: x * (field.cols - 1),
    cy: y * (field.rows - 1),
  };
}

function toGridRadius(field: HeightField, radius: number): number {
  // 用较长的一边保证圆形笔刷在非正方形网格里也不变形
  return Math.max(1, radius * Math.max(field.cols, field.rows));
}

/** 遍历笔刷覆盖的格子 */
function forEachInBrush(
  field: HeightField,
  options: BrushOptions,
  visit: (index: number, col: number, row: number, weight: number) => void,
): void {
  const { cx, cy } = toGrid(field, options.x, options.y);
  const r = toGridRadius(field, options.radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(field.cols - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(field.rows - 1, Math.ceil(cy + r));
  for (let row = y0; row <= y1; row += 1) {
    for (let col = x0; col <= x1; col += 1) {
      const dx = col - cx;
      const dy = row - cy;
      const distance = Math.hypot(dx, dy);
      const weight = brushWeight(distance, r);
      if (weight > 0) visit(row * field.cols + col, col, row, weight);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                                  单项操作                                   */
/* -------------------------------------------------------------------------- */

/** 推沙：抬升（有上限，避免无限堆高） */
export function raiseSand(state: SurfaceState, options: BrushOptions): SurfaceState {
  const next = cloneSurfaceState(state);
  const data = next.height.data;
  const amount = 46 * Math.max(0.05, Math.min(1, options.strength));
  // 湿沙更容易堆高（湿沙的支撑力更强）
  const wetBoost = next.state === 'wet' ? 1.35 : 1;
  forEachInBrush(next.height, options, (index, _col, _row, weight) => {
    data[index] = clampByte(data[index] + amount * weight * wetBoost);
  });
  return imposeRestAngle(next);
}

/** 挖沙：下压（可挖到底露出蓝底，即 0 高度） */
export function digSand(state: SurfaceState, options: BrushOptions): SurfaceState {
  const next = cloneSurfaceState(state);
  const data = next.height.data;
  const amount = 52 * Math.max(0.05, Math.min(1, options.strength));
  forEachInBrush(next.height, options, (index, _col, _row, weight) => {
    data[index] = clampByte(data[index] - amount * weight);
  });
  return imposeRestAngle(next);
}

/** 抹平：向邻域均值收敛（不改变整体高度） */
export function smoothSand(state: SurfaceState, options: BrushOptions): SurfaceState {
  const next = cloneSurfaceState(state);
  const field = next.height;
  const { data } = field;
  const source = new Uint8Array(data);
  const sourceField: HeightField = { cols: field.cols, rows: field.rows, data: source };
  const strength = Math.max(0.05, Math.min(1, options.strength));

  forEachInBrush(field, options, (index, col, row, weight) => {
    let sum = 0;
    let count = 0;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        sum += getHeight(sourceField, col + dc, row + dr);
        count += 1;
      }
    }
    const mean = sum / count;
    data[index] = clampByte(source[index] + (mean - source[index]) * weight * strength);
  });
  return next;
}

/** 耙纹：一笔多线，产生平行沟槽（干沙明显，湿沙浅） */
export function rakeSand(state: SurfaceState, options: BrushOptions): SurfaceState {
  const next = cloneSurfaceState(state);
  const data = next.height.data;
  const field = next.height;
  const { cx, cy } = toGrid(field, options.x, options.y);
  const r = toGridRadius(field, options.radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(field.cols - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r * 0.6));
  const y1 = Math.min(field.rows - 1, Math.ceil(cy + r * 0.6));
  const ripple = next.state === 'wet' ? 7 : 13;
  const depth = 9 * Math.max(0.05, Math.min(1, options.strength));
  // 齿间距：干沙更密
  const gap = next.state === 'wet' ? 6 : 4;

  for (let row = y0; row <= y1; row += 1) {
    for (let col = x0; col <= x1; col += 1) {
      const distance = Math.hypot(col - cx, row - cy);
      const weight = brushWeight(distance, r);
      if (weight <= 0) continue;
      const tooth = ((row + Math.floor((options.phase ?? 0) * 4)) % gap) === 0 ? 1 : -0.28;
      const index = row * field.cols + col;
      data[index] = clampByte(data[index] + tooth * depth * weight + Math.sin(col * 0.4) * ripple * 0.05);
    }
  }
  return next;
}

/** 喷水：提高局部湿度，湿沙可塑但会略微下沉 */
export function waterSand(state: SurfaceState, options: BrushOptions): SurfaceState {
  const next = cloneSurfaceState(state);
  const { height, wetness } = next;
  const data = height.data;
  const wet = wetness;
  const amount = 120 * Math.max(0.05, Math.min(1, options.strength));

  forEachInBrush(height, options, (index, _col, _row, weight) => {
    wet[index] = clampByte(wet[index] + amount * weight);
    // 喷水会让沙面略微沉降（水填满颗粒间隙）
    data[index] = clampByte(data[index] - 6 * weight);
  });

  // 只要笔刷中心湿了，就视为进入湿沙状态
  const centerCol = Math.round(options.x * (height.cols - 1));
  const centerRow = Math.round(options.y * (height.rows - 1));
  const centerIndex = centerRow * height.cols + centerCol;
  if (wet[centerIndex] > 96) next.state = 'wet';
  next.waterAdded = state.waterAdded + 1;
  return next;
}

/** 全网抹平：回到基准面（沙盘里的「重新铺沙」） */
export function flattenSand(state: SurfaceState, keepWetness = false): SurfaceState {
  const next = cloneSurfaceState(state);
  next.height = {
    cols: state.height.cols,
    rows: state.height.rows,
    data: new Uint8Array(state.height.data.length).fill(SURFACE_BASE_LEVEL),
  };
  if (!keepWetness) next.wetness = new Uint8Array(state.wetness.length);
  return next;
}

/** 隧道：在指定点挖出贯通沙脊的低矮通道（湿沙才能成型） */
export function tunnelSand(state: SurfaceState, options: BrushOptions): SurfaceState {
  const next = cloneSurfaceState(state);
  const data = next.height.data;
  const amount = 40 * Math.max(0.05, Math.min(1, options.strength));
  forEachInBrush(next.height, options, (index, _col, _row, weight) => {
    const current = data[index];
    // 只挖到基准面以下一点，形成"洞"而不是"坑底"
    const target = Math.max(SURFACE_BASE_LEVEL - 34, HEIGHT_MIN);
    if (current > target) {
      data[index] = clampByte(current - amount * weight * 1.6);
    }
  });
  // 隧道让局部变湿（能成型的关键）
  const wet = next.wetness;
  forEachInBrush(next.height, options, (index, _col, _row, weight) => {
    wet[index] = clampByte(wet[index] + 60 * weight);
  });
  next.state = 'wet';
  return next;
}

/* -------------------------------------------------------------------------- */
/*                                 物理松弛                                    */
/* -------------------------------------------------------------------------- */

/**
 * 休止角约束：松弛 1~2 次，得到"沙会流"的手感。
 *
 * 湿沙阈值更高（能立起来），干沙塌得更快；
 * 但**不做每帧模拟**，只在每次笔画后松弛一次，移动端才是毫秒级。
 */
export function imposeRestAngle(state: SurfaceState): SurfaceState {
  const wetRatio = estimateWetRatio(state);
  const next = cloneSurfaceState(state);
  next.height = relax(next.height, 1, 18, wetRatio > 0.4);
  return next;
}

/** 估算湿度比例（0~1） */
export function estimateWetRatio(state: SurfaceState): number {
  const total = state.wetness.length;
  if (total === 0) return 0;
  let wet = 0;
  // 采样以降低开销（每 16 个取 1 个）
  for (let i = 0; i < total; i += 16) {
    if (state.wetness[i] > 96) wet += 1;
  }
  return wet / Math.ceil(total / 16);
}

/* -------------------------------------------------------------------------- */
/*                                  工具分发                                   */
/* -------------------------------------------------------------------------- */

/** 按工具类型应用一次笔刷（纯函数） */
export function applyBrush(
  state: SurfaceState,
  tool: SurfaceTool,
  options: BrushOptions,
): SurfaceState {
  switch (tool) {
    case 'raise':
      return raiseSand(state, options);
    case 'dig':
      return digSand(state, options);
    case 'smooth':
      return smoothSand(state, options);
    case 'rake':
      return rakeSand(state, options);
    case 'water':
      return waterSand(state, options);
    case 'flatten':
      return flattenSand(state, false);
    case 'tunnel':
      return tunnelSand(state, options);
    default:
      return state;
  }
}

/** 沿一条笔画路径应用笔刷（自动插值，避免快速拖动断点） */
export function applyStroke(
  state: SurfaceState,
  tool: SurfaceTool,
  points: Array<{ x: number; y: number }>,
  radius: number,
  strength: number,
): SurfaceState {
  if (points.length === 0) return state;
  let current = state;
  const stepDistance = Math.max(radius * 0.35, 0.004);
  let phase = 0;

  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / stepDistance));
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      phase += stepDistance;
      current = applyBrush(current, tool, {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        radius,
        strength,
        phase,
      });
    }
  }
  return current;
}

/** 沙面统计（客观数字，不解释含义） */
export function surfaceStats(state: SurfaceState): {
  meanHeight: number;
  maxHeight: number;
  minHeight: number;
  movedRatio: number;
  wetRatio: number;
  dugToBottomRatio: number;
} {
  const { data } = state.height;
  const total = data.length;
  let sum = 0;
  let max = 0;
  let min = 255;
  let moved = 0;
  let bottom = 0;
  let wet = 0;

  for (let i = 0; i < total; i += 1) {
    const value = data[i];
    sum += value;
    if (value > max) max = value;
    if (value < min) min = value;
    if (Math.abs(value - SURFACE_BASE_LEVEL) > 6) moved += 1;
    if (value <= 8) bottom += 1;
    if (state.wetness[i] > 96) wet += 1;
  }

  return {
    meanHeight: total > 0 ? sum / total : 0,
    maxHeight: max,
    minHeight: min,
    movedRatio: total > 0 ? moved / total : 0,
    wetRatio: total > 0 ? wet / total : 0,
    dugToBottomRatio: total > 0 ? bottom / total : 0,
  };
}

/** 从空白沙面开始（初始状态） */
export function emptySurface(cols?: number, rows?: number): SurfaceState {
  return createSurfaceState(cols, rows);
}
