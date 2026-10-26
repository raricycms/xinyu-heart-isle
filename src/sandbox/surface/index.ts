/**
 * 沙面介质层（surface layer）统一出口。
 *
 * 页面只需一行：
 * ```tsx
 * import { SurfaceToolbar, SilenceToggle, useBrush, SURFACE_TOOL_LIST } from '@/sandbox/surface';
 * ```
 * 样式（`src/styles/sandbox-surface.css`）由 `SurfaceToolbar` / `SilenceToggle`
 * 自行 import，页面不需要再引一次。
 *
 * 目录职责：
 * | 文件 | 作用 | 依赖 DOM |
 * | --- | --- | --- |
 * | `useBrush.ts` | 指针 / 触摸 / 键盘 -> 一笔的归一化采样 | 否（纯逻辑可测） |
 * | `sandCells.ts` | 高度场 + 湿度 -> 768 格颜色 | 否（纯逻辑可测） |
 * | `SurfaceToolbar.tsx` | 7 种笔刷 + 半径/力度 + 重铺整盘沙 | 是 |
 * | `SilenceToggle.tsx` | 静默模式开关（Esc 退出、aria-live 播报） | 是 |
 */

export { useBrush } from './useBrush';
export type { BrushApi, BrushPoint, KeyboardKeyLike, PointerLike, UseBrushOptions } from './useBrush';
export {
  BRUSH_RADIUS_MAX,
  BRUSH_RADIUS_MIN,
  BRUSH_STRENGTH_MAX,
  BRUSH_STRENGTH_MIN,
  KEYBOARD_STEP,
  KEYBOARD_STEP_FAST,
  MAX_STROKE_POINTS,
  STROKE_STEP,
  appendSample,
  arrowDelta,
  clampRadius,
  clampStrength,
  clampUnit,
  finalizePath,
  moveKeyboardCursor,
  normalizeFromRect,
  shouldAppendSample,
  targetTagName,
} from './useBrush';

export { SurfaceToolbar, SURFACE_TOOL_LIST, useSurfaceCopy, resolveSurfaceCopy } from './SurfaceToolbar';
export type { SurfaceToolbarProps, SurfaceToolDescriptor } from './SurfaceToolbar';

export { SilenceToggle } from './SilenceToggle';
export type { SilenceToggleProps } from './SilenceToggle';

export {
  BASE_LEVEL,
  GLOSS_H_RATIO,
  GLOSS_INSET_X,
  GLOSS_INSET_Y,
  GLOSS_W_RATIO,
  GRID_CELLS,
  GRID_COLS,
  GRID_ROWS,
  LIFT_RATIO,
  WET_DARKEN_MIN,
  WET_THRESHOLD,
  computeSandCells,
  glossFill,
  liftFor,
  wetDarken,
  wetnessToUnit,
} from './sandCells';
export type { SandCell, Tray } from './sandCells';
